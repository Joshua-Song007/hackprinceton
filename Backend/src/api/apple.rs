// Sign in with Apple: POST /api/accounts/apple {identityToken, displayName?} -> {token, account}.
// The identity token is an RS256 JWT signed by Apple. It is verified against Apple's published keys
// (issuer, audience, expiry, sub); the account is (provider "apple", subject = sub). The session token
// comes from the same `store_session` as dev sign-in, so `authenticate` works for both.
// Order per request: body shape, field limits (400), db (503), audiences configured (503), verify (401,
// or 502 when Apple's keys cannot be fetched), upsert (500).
// [provisional: needs-tien-review] Audiences (the app bundle ids) come from env PEAR_APPLE_AUDIENCES,
// comma-separated; unset means the route answers 503 and never accepts a token. No nonce check: a stolen
// identity token can be replayed until it expires (about 10 minutes). No rate limit on this route.
// The key source is a trait so tests inject keys and never touch the network.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Extension, Json, Router};
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;

use crate::api::accounts::{store_session, SignInResponse};
use crate::db;
use crate::AppState;

const APPLE_ISSUER: &str = "https://appleid.apple.com";
const APPLE_KEYS_URL: &str = "https://appleid.apple.com/auth/keys";
const MAX_TOKEN_LEN: usize = 8192;
const MAX_NAME_LEN: usize = 256;
const KEY_CACHE_TTL: Duration = Duration::from_secs(3600);
const KEY_REFETCH_MIN: Duration = Duration::from_secs(60);

/// Apple's keys could not be fetched or parsed (not the same as "no such key").
#[derive(Debug)]
pub struct KeyError(pub String);

pub type KeyFuture<'a> = Pin<Box<dyn Future<Output = Result<Option<DecodingKey>, KeyError>> + Send + 'a>>;

/// Where signing keys come from. `Ok(None)` = the key id is unknown; `Err` = the source is unavailable.
pub trait AppleKeys: Send + Sync {
    fn key<'a>(&'a self, kid: &'a str) -> KeyFuture<'a>;
}

#[derive(Default)]
struct Cache {
    set: Option<JwkSet>,
    fetched: Option<Instant>,
    attempted: Option<Instant>,
}

enum Lookup {
    Hit(DecodingKey),
    /// Fresh cache without this key id.
    Miss,
    /// Nothing cached, or the cache is older than the TTL.
    Stale,
}

/// Apple's real key source: GET the key set, cache it for an hour, and refetch for an unknown key id
/// at most once a minute (failed attempts count, so an outage cannot turn every request into a fetch).
pub struct HttpAppleKeys {
    client: Option<reqwest::Client>,
    url: String,
    cache: Mutex<Cache>,
}

impl HttpAppleKeys {
    pub fn new() -> Self {
        Self::with_url(APPLE_KEYS_URL)
    }

    /// The same key source reading another key-set URL (tests point it at a local server).
    pub fn with_url(url: &str) -> Self {
        HttpAppleKeys {
            client: reqwest::Client::builder().timeout(Duration::from_secs(5)).build().ok(),
            url: url.to_string(),
            cache: Mutex::new(Cache::default()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Cache> {
        self.cache.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn lookup(&self, kid: &str) -> Lookup {
        let c = self.lock();
        match (&c.set, c.fetched) {
            (Some(set), Some(at)) if at.elapsed() < KEY_CACHE_TTL => {
                match set.find(kid).and_then(|j| DecodingKey::from_jwk(j).ok()) {
                    Some(k) => Lookup::Hit(k),
                    None => Lookup::Miss,
                }
            }
            _ => Lookup::Stale,
        }
    }

    /// True when a fetch may start now; records the attempt either way it ends.
    fn take_fetch_slot(&self) -> bool {
        let mut c = self.lock();
        if c.attempted.is_some_and(|at| at.elapsed() < KEY_REFETCH_MIN) {
            return false;
        }
        c.attempted = Some(Instant::now());
        true
    }

    async fn fetch(&self) -> Result<JwkSet, KeyError> {
        let client = self.client.as_ref().ok_or_else(|| KeyError("http client unavailable".into()))?;
        let resp = client
            .get(&self.url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| KeyError(format!("fetch: {e}")))?;
        resp.json::<JwkSet>().await.map_err(|e| KeyError(format!("parse: {e}")))
    }
}

impl Default for HttpAppleKeys {
    fn default() -> Self {
        Self::new()
    }
}

impl AppleKeys for HttpAppleKeys {
    fn key<'a>(&'a self, kid: &'a str) -> KeyFuture<'a> {
        Box::pin(async move {
            let stale = match self.lookup(kid) {
                Lookup::Hit(k) => return Ok(Some(k)),
                Lookup::Miss => false,
                Lookup::Stale => true,
            };
            if !self.take_fetch_slot() {
                return if stale { Err(KeyError("keys unavailable".into())) } else { Ok(None) };
            }
            let set = self.fetch().await?;
            let key = set.find(kid).and_then(|j| DecodingKey::from_jwk(j).ok());
            let mut c = self.lock();
            c.set = Some(set);
            c.fetched = Some(Instant::now());
            Ok(key)
        })
    }
}

/// What the route needs to check a token: a key source and the accepted audiences.
#[derive(Clone)]
pub struct AppleVerifier {
    keys: Arc<dyn AppleKeys>,
    audiences: Arc<Vec<String>>,
}

impl AppleVerifier {
    pub fn new(keys: Arc<dyn AppleKeys>, audiences: Vec<String>) -> Self {
        AppleVerifier { keys, audiences: Arc::new(audiences) }
    }

    /// Apple's real keys, audiences from env PEAR_APPLE_AUDIENCES (read once, when the router is built).
    pub fn from_env() -> Self {
        let raw = std::env::var("PEAR_APPLE_AUDIENCES").unwrap_or_default();
        AppleVerifier::new(Arc::new(HttpAppleKeys::new()), parse_audiences(&raw))
    }
}

/// "a, b,,c" -> ["a", "b", "c"].
pub fn parse_audiences(raw: &str) -> Vec<String> {
    raw.split(',').map(str::trim).filter(|s| !s.is_empty()).map(String::from).collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleSignInRequest {
    pub identity_token: String,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
}

enum VerifyError {
    /// The token is not acceptable; the reason is for the log only.
    Rejected(&'static str),
    /// Apple's keys could not be fetched.
    Keys(String),
}

/// Returns the token's `sub` when it is a valid Apple identity token for one of the audiences.
async fn verify(v: &AppleVerifier, token: &str) -> Result<String, VerifyError> {
    let header = decode_header(token).map_err(|_| VerifyError::Rejected("malformed header"))?;
    if header.alg != Algorithm::RS256 {
        return Err(VerifyError::Rejected("algorithm is not RS256"));
    }
    let kid = header.kid.ok_or(VerifyError::Rejected("no key id"))?;
    let key = v
        .keys
        .key(&kid)
        .await
        .map_err(|e| VerifyError::Keys(e.0))?
        .ok_or(VerifyError::Rejected("unknown key id"))?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[APPLE_ISSUER]);
    validation.set_audience(v.audiences.as_slice());
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    let data = decode::<Claims>(token, &key, &validation).map_err(|e| {
        VerifyError::Rejected(match e.kind() {
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => "expired",
            jsonwebtoken::errors::ErrorKind::InvalidAudience => "wrong audience",
            jsonwebtoken::errors::ErrorKind::InvalidIssuer => "wrong issuer",
            jsonwebtoken::errors::ErrorKind::InvalidSignature => "bad signature",
            _ => "invalid claims or signature",
        })
    })?;
    if data.claims.sub.trim().is_empty() {
        return Err(VerifyError::Rejected("empty sub"));
    }
    Ok(data.claims.sub)
}

async fn apple_signin(
    State(state): State<AppState>,
    Extension(verifier): Extension<AppleVerifier>,
    Json(req): Json<AppleSignInRequest>,
) -> Result<Json<SignInResponse>, StatusCode> {
    if req.identity_token.is_empty()
        || req.identity_token.len() > MAX_TOKEN_LEN
        || req.display_name.len() > MAX_NAME_LEN
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    if verifier.audiences.is_empty() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    let sub = verify(&verifier, &req.identity_token).await.map_err(|e| match e {
        VerifyError::Rejected(why) => {
            eprintln!("apple signin: rejected: {why}");
            StatusCode::UNAUTHORIZED
        }
        VerifyError::Keys(why) => {
            eprintln!("apple signin: keys unavailable: {why}");
            StatusCode::BAD_GATEWAY
        }
    })?;
    let account = db::upsert_account(pool, "apple", &sub, req.display_name.trim())
        .await
        .map_err(|e| {
            eprintln!("apple signin: db error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    let token = store_session(account.clone());
    Ok(Json(SignInResponse { token, account }))
}

/// Route: POST /api/accounts/apple, with Apple's real keys and audiences from the environment.
pub fn routes() -> Router<AppState> {
    routes_with(AppleVerifier::from_env())
}

/// Same route with a chosen verifier (tests inject keys and audiences).
pub fn routes_with(verifier: AppleVerifier) -> Router<AppState> {
    Router::new()
        .route("/api/accounts/apple", post(apple_signin))
        .layer(Extension(verifier))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::memstore::MemStore;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// A key source that must never be asked: proves a request was refused before any key lookup.
    struct NoKeys;
    impl AppleKeys for NoKeys {
        fn key<'a>(&'a self, _kid: &'a str) -> KeyFuture<'a> {
            panic!("the key source must not be called");
        }
    }

    fn verifier(audiences: &[&str]) -> AppleVerifier {
        AppleVerifier::new(Arc::new(NoKeys), audiences.iter().map(|s| s.to_string()).collect())
    }

    async fn post_apple(v: AppleVerifier, db: Option<Db>, body: &str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = routes_with(v).with_state(AppState { db });
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let raw = format!(
            "POST /api/accounts/apple HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(raw.as_bytes()).await.unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).await.unwrap();
        buf
    }

    fn mem() -> Option<Db> {
        Some(Db::Mem(MemStore::default()))
    }

    #[test]
    fn audiences_are_split_trimmed_and_non_empty() {
        assert_eq!(parse_audiences("a, b,,c"), vec!["a", "b", "c"]);
        assert!(parse_audiences("").is_empty());
        assert!(parse_audiences(" , ").is_empty());
    }

    #[tokio::test]
    async fn bad_input_is_400_before_anything_else() {
        let v = verifier(&["com.pear.player"]);
        let r = post_apple(v.clone(), None, r#"{"identityToken":""}"#).await;
        assert!(r.starts_with("HTTP/1.1 400"), "{r}");
        let big = "x".repeat(MAX_NAME_LEN + 1);
        let r = post_apple(v, None, &format!(r#"{{"identityToken":"a.b.c","displayName":"{big}"}}"#)).await;
        assert!(r.starts_with("HTTP/1.1 400"), "{r}");
    }

    #[tokio::test]
    async fn no_database_is_503() {
        let r = post_apple(verifier(&["com.pear.player"]), None, r#"{"identityToken":"a.b.c"}"#).await;
        assert!(r.starts_with("HTTP/1.1 503"), "{r}");
    }

    #[tokio::test]
    async fn no_audiences_configured_is_503_not_accepted() {
        let r = post_apple(verifier(&[]), mem(), r#"{"identityToken":"a.b.c"}"#).await;
        assert!(r.starts_with("HTTP/1.1 503"), "{r}");
    }

    #[tokio::test]
    async fn undecodable_token_is_401_without_a_key_lookup() {
        let r = post_apple(verifier(&["com.pear.player"]), mem(), r#"{"identityToken":"not.a.jwt"}"#).await;
        assert!(r.starts_with("HTTP/1.1 401"), "{r}");
    }
}
