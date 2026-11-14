// Sign-in and session tokens.
// [provisional: needs-tien-review] Sign-in method is not decided (Sign in with Apple preferred).
// Default here: dev sign-in by (provider, subject), enabled only when OMNI_DEV_SIGNIN=1, issuing an
// opaque random bearer token kept in server memory (lost on restart, single instance). Replace the
// `signin` handler with a real provider check (Apple identity token) later; `authenticate` stays.
// Runtime sqlx via db.rs only. No new crates: token randomness comes from std's OS-seeded RandomState.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::db::{self, Account};
use crate::AppState;

const SESSION_TTL: Duration = Duration::from_secs(30 * 24 * 3600);
const MAX_FIELD_LEN: usize = 256;

struct Session {
    account: Account,
    expires: Instant,
}

fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static S: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 256-bit opaque token (hex). std seeds `RandomState` keys from the OS once per thread and bumps
/// them per instance; four instances hash a counter and the clock. Not a CSPRNG: dev sign-in only.
/// Before any real sign-in uses this, switch to `getrandom`/`rand` (OS CSPRNG).
fn new_token() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let mut out = String::with_capacity(64);
    for i in 0..4u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(n);
        h.write_u64(nanos);
        h.write_u64(i);
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

fn store_session(account: Account) -> String {
    let token = new_token();
    let mut map = sessions().lock().unwrap_or_else(|p| p.into_inner());
    let now = Instant::now();
    map.retain(|_, s| s.expires > now);
    map.insert(
        token.clone(),
        Session {
            account,
            expires: now + SESSION_TTL,
        },
    );
    token
}

fn lookup_session(token: &str) -> Option<Account> {
    let mut map = sessions().lock().unwrap_or_else(|p| p.into_inner());
    match map.get(token) {
        Some(s) if s.expires > Instant::now() => Some(s.account.clone()),
        Some(_) => {
            map.remove(token);
            None
        }
        None => None,
    }
}

fn revoke_session(token: &str) {
    sessions()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(token);
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    let v = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let t = v.strip_prefix("Bearer ")?.trim();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

/// The signed-in account for a request's `Authorization: Bearer <token>`, or None.
pub fn authenticate(headers: &HeaderMap) -> Option<Account> {
    lookup_session(bearer(headers)?)
}

/// Value of `key` in a raw query string (no percent-decoding: tokens are hex, versions are digits).
pub fn query_param<'a>(query: Option<&'a str>, key: &str) -> Option<&'a str> {
    query?.split('&').find_map(|kv| kv.strip_prefix(key)?.strip_prefix('='))
}

/// Like `authenticate`, plus a `?token=` query fallback because browsers cannot set headers on a
/// WebSocket. The header wins when both are present (an invalid header does not fall back).
/// [provisional: needs-tien-review] A token in a URL can reach proxy logs; serve over TLS (Caddy) only.
pub fn authenticate_request(headers: &HeaderMap, query: Option<&str>) -> Option<Account> {
    match bearer(headers) {
        Some(t) => lookup_session(t),
        None => lookup_session(query_param(query, "token").filter(|t| !t.is_empty())?),
    }
}

/// Test helper for other api modules: a live session token for a fake account with this id.
#[cfg(test)]
pub fn test_token(account_id: &str) -> String {
    store_session(Account {
        id: account_id.into(),
        provider: "dev".into(),
        subject: "s".into(),
        display_name: "n".into(),
        created_at: "t".into(),
    })
}

fn dev_signin_enabled(flag: Option<&str>) -> bool {
    flag == Some("1")
}

#[derive(Debug, Deserialize)]
pub struct SignInRequest {
    pub provider: String,
    pub subject: String,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Debug, Serialize)]
pub struct SignInResponse {
    pub token: String,
    pub account: Account,
}

fn valid_field(s: &str) -> bool {
    !s.trim().is_empty() && s.len() <= MAX_FIELD_LEN
}

async fn signin(
    State(state): State<AppState>,
    Json(req): Json<SignInRequest>,
) -> Result<Json<SignInResponse>, StatusCode> {
    if !dev_signin_enabled(std::env::var("OMNI_DEV_SIGNIN").ok().as_deref()) {
        return Err(StatusCode::FORBIDDEN);
    }
    if !valid_field(&req.provider)
        || !valid_field(&req.subject)
        || req.display_name.len() > MAX_FIELD_LEN
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let Some(pool) = state.db.as_ref() else {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    };
    let account = db::upsert_account(pool, &req.provider, &req.subject, &req.display_name)
        .await
        .map_err(|e| {
            eprintln!("signin: db error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    let token = store_session(account.clone());
    Ok(Json(SignInResponse { token, account }))
}

async fn me(headers: HeaderMap) -> Result<Json<Account>, StatusCode> {
    authenticate(&headers)
        .map(Json)
        .ok_or(StatusCode::UNAUTHORIZED)
}

async fn signout(headers: HeaderMap) -> StatusCode {
    if let Some(t) = bearer(&headers) {
        revoke_session(t);
    }
    StatusCode::NO_CONTENT
}

/// Routes: POST /api/accounts/signin, GET /api/accounts/me, POST /api/accounts/signout.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/accounts/signin", post(signin))
        .route("/api/accounts/me", get(me))
        .route("/api/accounts/signout", post(signout))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn acct(id: &str) -> Account {
        Account {
            id: id.into(),
            provider: "dev".into(),
            subject: "s".into(),
            display_name: "n".into(),
            created_at: "t".into(),
        }
    }

    fn headers_with(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
        );
        h
    }

    #[test]
    fn tokens_are_distinct_64_hex() {
        let a = new_token();
        let b = new_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn session_round_trip_and_revoke() {
        let t = store_session(acct("a1"));
        assert_eq!(authenticate(&headers_with(&t)).unwrap().id, "a1");
        revoke_session(&t);
        assert!(authenticate(&headers_with(&t)).is_none());
    }

    #[test]
    fn unknown_or_malformed_auth_rejected() {
        assert!(authenticate(&HeaderMap::new()).is_none());
        assert!(authenticate(&headers_with("nope")).is_none());
        let mut h = HeaderMap::new();
        h.insert(header::AUTHORIZATION, HeaderValue::from_static("Basic abc"));
        assert!(authenticate(&h).is_none());
        h.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer "));
        assert!(authenticate(&h).is_none());
    }

    #[test]
    fn query_token_works_and_header_wins() {
        let t = store_session(acct("q1"));
        let other = store_session(acct("q2"));
        let q = format!("version=2&token={t}");
        assert_eq!(authenticate_request(&HeaderMap::new(), Some(&q)).unwrap().id, "q1");
        assert_eq!(authenticate_request(&headers_with(&other), Some(&q)).unwrap().id, "q2");
        assert!(authenticate_request(&headers_with("nope"), Some(&q)).is_none());
        assert!(authenticate_request(&HeaderMap::new(), Some("token=")).is_none());
        assert!(authenticate_request(&HeaderMap::new(), None).is_none());
        assert_eq!(query_param(Some("a=1&xtoken=2"), "token"), None);
    }

    #[test]
    fn expired_session_rejected() {
        let t = new_token();
        sessions().lock().unwrap().insert(
            t.clone(),
            Session {
                account: acct("a2"),
                expires: Instant::now() - Duration::from_secs(1),
            },
        );
        assert!(lookup_session(&t).is_none());
    }

    #[test]
    fn dev_signin_gate_and_field_validation() {
        assert!(!dev_signin_enabled(None));
        assert!(!dev_signin_enabled(Some("0")));
        assert!(dev_signin_enabled(Some("1")));
        assert!(!valid_field("  "));
        assert!(!valid_field(&"x".repeat(MAX_FIELD_LEN + 1)));
        assert!(valid_field("apple"));
    }

    async fn request(raw: &str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = routes().with_state(AppState { db: None });
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(raw.as_bytes()).await.unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).await.unwrap();
        buf
    }

    #[tokio::test]
    async fn me_without_token_is_401() {
        let r = request("GET /api/accounts/me HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").await;
        assert!(r.starts_with("HTTP/1.1 401"), "{r}");
    }

    #[tokio::test]
    async fn me_with_valid_token_returns_account() {
        let t = store_session(acct("a3"));
        let r = request(&format!(
            "GET /api/accounts/me HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {t}\r\nConnection: close\r\n\r\n"
        ))
        .await;
        assert!(r.starts_with("HTTP/1.1 200"), "{r}");
        assert!(r.contains("\"id\":\"a3\""), "{r}");
    }

    #[tokio::test]
    async fn signout_revokes_token() {
        let t = store_session(acct("a4"));
        let r = request(&format!(
            "POST /api/accounts/signout HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {t}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ))
        .await;
        assert!(r.starts_with("HTTP/1.1 204"), "{r}");
        assert!(lookup_session(&t).is_none());
    }
}
