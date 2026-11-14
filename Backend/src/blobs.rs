// Plugin bundle object storage: S3-compatible (Vultr Object Storage) when OMNI_S3_BUCKET is set,
// else an in-memory map (dev; lost on restart, the startup seed refills it).
// Env: OMNI_S3_ENDPOINT (e.g. https://ewr1.vultrobjects.com), OMNI_S3_BUCKET, OMNI_S3_REGION
// (default us-east-1), OMNI_S3_ACCESS_KEY, OMNI_S3_SECRET_KEY. Path-style URLs, SigV4 signed by hand
// (hmac + sha2) so no AWS SDK is pulled in.
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
        match (var("OMNI_S3_BUCKET"), var("OMNI_S3_ENDPOINT"), var("OMNI_S3_ACCESS_KEY"), var("OMNI_S3_SECRET_KEY")) {
            (Some(bucket), Some(endpoint), Some(access_key), Some(secret_key)) => Blobs::S3(Arc::new(S3 {
                endpoint: endpoint.trim_end_matches('/').to_string(),
                bucket,
                region: var("OMNI_S3_REGION").unwrap_or_else(|| "us-east-1".into()),
                access_key,
                secret_key,
                client: reqwest::Client::new(),
            })),
            (Some(_), ..) => {
                eprintln!("blobs: OMNI_S3_BUCKET set without OMNI_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY; using memory");
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
}

impl S3 {
    async fn request(&self, method: reqwest::Method, key: &str, body: Vec<u8>) -> Result<Option<Vec<u8>>, String> {
        // Keys are built from [a-z0-9-./] only (see marketplace object_key), so no URI escaping is needed.
        let path = format!("/{}/{}", self.bucket, key);
        let host = self.endpoint.split("://").nth(1).unwrap_or(&self.endpoint).to_string();
        let payload = hex::encode(Sha256::digest(&body));
        let amz_date = amz_date_now();
        let headers = vec![
            ("host".to_string(), host),
            ("x-amz-content-sha256".to_string(), payload.clone()),
            ("x-amz-date".to_string(), amz_date.clone()),
        ];
        let auth = sigv4_authorization(method.as_str(), &path, &headers, &payload, &amz_date, &self.region, &self.access_key, &self.secret_key);
        let res = self
            .client
            .request(method.clone(), format!("{}{path}", self.endpoint))
            .header("x-amz-content-sha256", payload)
            .header("x-amz-date", amz_date)
            .header("authorization", auth)
            .body(body)
            .send()
            .await
            .map_err(|e| format!("s3 {method} {key}: {e}"))?;
        let status = res.status();
        if method == reqwest::Method::GET && status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let bytes = res.bytes().await.map_err(|e| format!("s3 {method} {key}: {e}"))?;
        if !status.is_success() {
            return Err(format!("s3 {method} {key}: {status}: {}", String::from_utf8_lossy(&bytes).chars().take(300).collect::<String>()));
        }
        Ok(Some(bytes.to_vec()))
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

    #[tokio::test]
    async fn memory_put_get() {
        let b = Blobs::Mem(Arc::default());
        assert_eq!(b.get("k").await.unwrap(), None);
        b.put("k", vec![1, 2]).await.unwrap();
        assert_eq!(b.get("k").await.unwrap(), Some(vec![1, 2]));
    }
}
