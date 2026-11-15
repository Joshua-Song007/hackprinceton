// Plugin bundle object storage: S3-compatible (Vultr Object Storage) when PEAR_S3_BUCKET is set,
// else an in-memory map (dev; lost on restart, the startup seed refills it).
// Env: PEAR_S3_ENDPOINT (e.g. https://ewr1.vultrobjects.com), PEAR_S3_BUCKET, PEAR_S3_REGION
// (default us-east-1), PEAR_S3_ACCESS_KEY, PEAR_S3_SECRET_KEY, optional PEAR_S3_PREFIX (e.g. `prod/`,
// prepended to every key so several environments can share a bucket). Path-style URLs, SigV4 signed by hand
// (hmac + sha2) so no AWS SDK is pulled in. Empty env values count as unset.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

#[derive(Clone)]
pub enum Blobs {
    Mem(Arc<Mutex<HashMap<String, Vec<u8>>>>),
    S3(Arc<S3>),
}

pub struct S3 {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    pub access_key: String,
    pub secret_key: String,
    /// Prepended to every object key; empty or ending in `/`.
    pub prefix: String,
    client: reqwest::Client,
}

/// The process-wide store, from the environment on first use.
pub fn blobs() -> &'static Blobs {
    static B: OnceLock<Blobs> = OnceLock::new();
    B.get_or_init(Blobs::from_env)
}

impl Blobs {
    pub fn from_env() -> Blobs {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        match (var("PEAR_S3_BUCKET"), var("PEAR_S3_ENDPOINT"), var("PEAR_S3_ACCESS_KEY"), var("PEAR_S3_SECRET_KEY")) {
            (Some(bucket), Some(endpoint), Some(access_key), Some(secret_key)) => Blobs::S3(Arc::new(S3 {
                endpoint: endpoint.trim_end_matches('/').to_string(),
                bucket,
                region: var("PEAR_S3_REGION").unwrap_or_else(|| "us-east-1".into()),
                access_key,
                secret_key,
                prefix: normalize_prefix(&var("PEAR_S3_PREFIX").unwrap_or_default()),
                client: reqwest::Client::new(),
            })),
            (Some(_), ..) => {
                eprintln!("blobs: PEAR_S3_BUCKET set without PEAR_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY; using memory");
                Blobs::Mem(Arc::default())
            }
            _ => Blobs::Mem(Arc::default()),
        }
    }

    pub async fn put(&self, key: &str, bytes: Vec<u8>) -> Result<(), String> {
        match self {
            Blobs::Mem(m) => {
                m.lock().unwrap_or_else(|p| p.into_inner()).insert(key.into(), bytes);
                Ok(())
            }
            Blobs::S3(s3) => s3.request(reqwest::Method::PUT, key, bytes).await.map(|_| ()),
        }
    }

    /// None when the object does not exist.
    pub async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        match self {
            Blobs::Mem(m) => Ok(m.lock().unwrap_or_else(|p| p.into_inner()).get(key).cloned()),
            Blobs::S3(s3) => s3.request(reqwest::Method::GET, key, Vec::new()).await,
        }
    }

    /// Removes the object; a missing object is not an error.
    pub async fn delete(&self, key: &str) -> Result<(), String> {
        match self {
            Blobs::Mem(m) => {
                m.lock().unwrap_or_else(|p| p.into_inner()).remove(key);
                Ok(())
            }
            Blobs::S3(s3) => s3.request(reqwest::Method::DELETE, key, Vec::new()).await.map(|_| ()),
        }
    }

    /// Whether the object exists (S3: a HEAD, no body is downloaded).
    pub async fn exists(&self, key: &str) -> Result<bool, String> {
        match self {
            Blobs::Mem(m) => Ok(m.lock().unwrap_or_else(|p| p.into_inner()).contains_key(key)),
            Blobs::S3(s3) => s3.request(reqwest::Method::HEAD, key, Vec::new()).await.map(|o| o.is_some()),
        }
    }

    /// `s3 <bucket> @ <endpoint>` or `memory`; never a key.
    pub fn describe(&self) -> String {
        match self {
            Blobs::Mem(_) => "memory".into(),
            Blobs::S3(s3) => format!("s3 {} @ {}", s3.bucket, s3.endpoint),
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Blobs::Mem(_) => "memory",
            Blobs::S3(_) => "s3",
        }
    }

    /// Writes `health/probe-<random>`, reads it back, deletes it. The error is a short reason without secrets.
    pub async fn probe(&self) -> Result<(), String> {
        let mut r = [0u8; 8];
        getrandom::fill(&mut r).map_err(|e| e.to_string())?;
        let key = format!("health/probe-{}", hex::encode(r));
        let payload = format!("pear probe {}", hex::encode(r)).into_bytes();
        self.put(&key, payload.clone()).await.map_err(|e| format!("write: {e}"))?;
        let back = self.get(&key).await.map_err(|e| format!("read: {e}"))?;
        self.delete(&key).await.map_err(|e| format!("delete: {e}"))?;
        if back.as_deref() != Some(payload.as_slice()) {
            return Err("read back differs from what was written".into());
        }
        Ok(())
    }

    /// S3: HEAD bucket, PUT bucket when it is missing (404). Memory: nothing to do.
    pub async fn ensure_bucket(&self) -> Result<(), String> {
        match self {
            Blobs::Mem(_) => Ok(()),
            Blobs::S3(s3) => s3.ensure_bucket().await,
        }
    }
}

/// `""` stays empty; anything else loses leading slashes and ends in exactly one `/`.
fn normalize_prefix(p: &str) -> String {
    let p = p.trim().trim_matches('/');
    if p.is_empty() {
        String::new()
    } else {
        format!("{p}/")
    }
}

impl S3 {
    /// Path-style request path of an object key, prefix included. Keys are built from [a-z0-9-./] only
    /// (see marketplace object_key), so no URI escaping is needed.
    fn object_path(&self, key: &str) -> String {
        format!("/{}/{}{}", self.bucket, self.prefix, key)
    }

    /// The signed request for `path` (the bucket path for bucket operations); nothing is sent.
    fn build(&self, method: reqwest::Method, path: &str, body: Vec<u8>, amz_date: &str) -> reqwest::RequestBuilder {
        let host = self.endpoint.split("://").nth(1).unwrap_or(&self.endpoint).to_string();
        let payload = hex::encode(Sha256::digest(&body));
        let headers = vec![
            ("host".to_string(), host),
            ("x-amz-content-sha256".to_string(), payload.clone()),
            ("x-amz-date".to_string(), amz_date.to_string()),
        ];
        let auth = sigv4_authorization(method.as_str(), path, &headers, &payload, amz_date, &self.region, &self.access_key, &self.secret_key);
        self.client
            .request(method, format!("{}{path}", self.endpoint))
            .header("x-amz-content-sha256", payload)
            .header("x-amz-date", amz_date)
            .header("authorization", auth)
            .body(body)
    }

    async fn send(&self, method: reqwest::Method, path: &str, body: Vec<u8>) -> Result<(reqwest::StatusCode, Vec<u8>), String> {
        let what = format!("s3 {method} {path}");
        let res = self.build(method, path, body, &amz_date_now()).send().await.map_err(|e| format!("{what}: {e}"))?;
        let status = res.status();
        let bytes = res.bytes().await.map_err(|e| format!("{what}: {e}"))?;
        Ok((status, bytes.to_vec()))
    }

    async fn request(&self, method: reqwest::Method, key: &str, body: Vec<u8>) -> Result<Option<Vec<u8>>, String> {
        let path = self.object_path(key);
        let (status, bytes) = self.send(method.clone(), &path, body).await?;
        let missing_ok = matches!(method, reqwest::Method::GET | reqwest::Method::HEAD | reqwest::Method::DELETE);
        if missing_ok && status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(format!("s3 {method} {key}: {status}: {}", String::from_utf8_lossy(&bytes).chars().take(300).collect::<String>()));
        }
        Ok(Some(bytes))
    }

    async fn ensure_bucket(&self) -> Result<(), String> {
        let path = format!("/{}", self.bucket);
        let (status, _) = self.send(reqwest::Method::HEAD, &path, Vec::new()).await?;
        if status.is_success() {
            return Ok(());
        }
        if status != reqwest::StatusCode::NOT_FOUND {
            return Err(format!("s3 HEAD bucket {}: {status}", self.bucket));
        }
        let (status, bytes) = self.send(reqwest::Method::PUT, &path, Vec::new()).await?;
        if !status.is_success() {
            return Err(format!("s3 PUT bucket {}: {status}: {}", self.bucket, String::from_utf8_lossy(&bytes).chars().take(300).collect::<String>()));
        }
        Ok(())
    }
}

/// `YYYYMMDDTHHMMSSZ` from the RFC3339 clock the in-memory store already uses.
fn amz_date_now() -> String {
    let t = crate::memstore::now_rfc3339(); // 2024-01-02T03:04:05.123456Z
    format!("{}Z", t[..19].replace(['-', ':'], ""))
}

fn hmac(key: &[u8], data: &str) -> Vec<u8> {
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("hmac takes any key length");
    m.update(data.as_bytes());
    m.finalize().into_bytes().to_vec()
}

/// AWS Signature V4 `Authorization` header for an S3 request with no query string. `headers` are
/// (lowercase name, value), all of them signed.
#[allow(clippy::too_many_arguments)]
pub fn sigv4_authorization(
    method: &str,
    path: &str,
    headers: &[(String, String)],
    payload_sha256: &str,
    amz_date: &str,
    region: &str,
    access_key: &str,
    secret_key: &str,
) -> String {
    let mut sorted: Vec<&(String, String)> = headers.iter().collect();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    let canonical_headers: String = sorted.iter().map(|(k, v)| format!("{k}:{}\n", v.trim())).collect();
    let signed: Vec<&str> = sorted.iter().map(|(k, _)| k.as_str()).collect();
    let signed = signed.join(";");
    let canonical = format!("{method}\n{path}\n\n{canonical_headers}\n{signed}\n{payload_sha256}");
    let date = &amz_date[..8];
    let scope = format!("{date}/{region}/s3/aws4_request");
    let to_sign = format!("AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}", hex::encode(Sha256::digest(canonical.as_bytes())));
    let mut key = hmac(format!("AWS4{secret_key}").as_bytes(), date);
    for part in [region, "s3", "aws4_request"] {
        key = hmac(&key, part);
    }
    let signature = hex::encode(hmac(&key, &to_sign));
    format!("AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={signed}, Signature={signature}")
}

#[cfg(test)]
mod tests {
    use super::*;

    // The "GET Object" example from the AWS SigV4 S3 documentation (sig-v4-header-based-auth).
    #[test]
    fn sigv4_matches_aws_documentation_example() {
        let empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let h = |k: &str, v: &str| (k.to_string(), v.to_string());
        let headers = [
            h("host", "examplebucket.s3.amazonaws.com"),
            h("range", "bytes=0-9"),
            h("x-amz-content-sha256", empty),
            h("x-amz-date", "20130524T000000Z"),
        ];
        let auth = sigv4_authorization("GET", "/test.txt", &headers, empty, "20130524T000000Z", "us-east-1",
            "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
        assert_eq!(auth, "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, \
            SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, \
            Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    }

    #[test]
    fn amz_date_shape() {
        let d = amz_date_now();
        assert_eq!(d.len(), 16, "{d}");
        assert!(d.as_bytes()[8] == b'T' && d.ends_with('Z'), "{d}");
    }

    fn test_s3(prefix: &str) -> S3 {
        S3 {
            endpoint: "https://atl2.vultrobjects.com".into(),
            bucket: "pear-test".into(),
            region: "us-east-1".into(),
            access_key: "AKTEST".into(),
            secret_key: "not-a-real-secret".into(),
            prefix: normalize_prefix(prefix),
            client: reqwest::Client::new(),
        }
    }

    #[test]
    fn prefix_is_normalized_and_prepended_to_every_key() {
        assert_eq!(normalize_prefix(""), "");
        assert_eq!(normalize_prefix("  "), "");
        assert_eq!(normalize_prefix("prod"), "prod/");
        assert_eq!(normalize_prefix("/prod/"), "prod/");
        assert_eq!(test_s3("prod/").object_path("assets/ab"), "/pear-test/prod/assets/ab");
        assert_eq!(test_s3("").object_path("assets/ab"), "/pear-test/assets/ab");
    }

    #[test]
    fn bucket_head_and_put_requests_are_signed_without_a_network() {
        let s3 = test_s3("prod/");
        for m in [reqwest::Method::HEAD, reqwest::Method::PUT] {
            let req = s3.build(m.clone(), "/pear-test", Vec::new(), "20260102T030405Z").build().unwrap();
            assert_eq!(req.method(), m);
            assert_eq!(req.url().as_str(), "https://atl2.vultrobjects.com/pear-test");
            let auth = req.headers()["authorization"].to_str().unwrap();
            assert!(auth.starts_with("AWS4-HMAC-SHA256 Credential=AKTEST/20260102/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature="), "{auth}");
            assert!(!auth.contains("not-a-real-secret"));
            assert_eq!(req.headers()["x-amz-date"], "20260102T030405Z");
        }
        // The signature depends on the method.
        let sig = |m| s3.build(m, "/pear-test", Vec::new(), "20260102T030405Z").build().unwrap().headers()["authorization"].clone();
        assert_ne!(sig(reqwest::Method::HEAD), sig(reqwest::Method::PUT));
    }

    #[tokio::test]
    async fn memory_probe_delete_exists_describe() {
        let b = Blobs::Mem(Arc::default());
        b.probe().await.unwrap();
        b.ensure_bucket().await.unwrap();
        assert_eq!(b.describe(), "memory");
        b.put("k", vec![1]).await.unwrap();
        assert!(b.exists("k").await.unwrap());
        b.delete("k").await.unwrap();
        b.delete("k").await.unwrap();
        assert!(!b.exists("k").await.unwrap());
        assert_eq!(b.get("k").await.unwrap(), None);
        let Blobs::Mem(m) = &b else { unreachable!() };
        assert!(m.lock().unwrap().is_empty(), "probe leaves nothing behind");
        assert_eq!(Blobs::S3(Arc::new(test_s3(""))).describe(), "s3 pear-test @ https://atl2.vultrobjects.com");
    }

    #[tokio::test]
    async fn memory_put_get() {
        let b = Blobs::Mem(Arc::default());
        assert_eq!(b.get("k").await.unwrap(), None);
        b.put("k", vec![1, 2]).await.unwrap();
        assert_eq!(b.get("k").await.unwrap(), Some(vec![1, 2]));
    }
}
