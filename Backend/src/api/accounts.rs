// Sign-in and session tokens.
// [provisional: needs-tien-review] Sign-in method is not decided (Sign in with Apple preferred).
// Default here: dev sign-in by (provider, subject), enabled only when PEAR_DEV_SIGNIN=1, issuing an
// opaque random bearer token (sha256 kept in Postgres `sessions`, so it survives restarts; memory only without a database). Replace the
// `signin` handler with a real provider check (Apple identity token) later; `authenticate` stays.
// The passwordless path accepts only provider "dev". Provider "developer" is the team's password login
// (argon2id hash in accounts.password_hash, role "developer"); those accounts exist only through the
// `pear-backend create-developer` CLI and sign-in never creates one.
// Runtime sqlx via db.rs only. No new crates: token randomness comes from std's OS-seeded RandomState.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::db::{self, Account};
use crate::AppState;

const SESSION_TTL: Duration = Duration::from_secs(30 * 24 * 3600);
const MAX_FIELD_LEN: usize = 256;

struct Session {
    account: Account,
    expires: Instant,
}

type Cache = Mutex<HashMap<String, Session>>;

/// Keyed by sha256(token) hex. With a database an entry lives at most `CACHE_TTL`, then the next request
/// re-reads the row (which also picks up sign-out or account deletion from elsewhere and slides the expiry).
fn sessions() -> &'static Cache {
    static S: OnceLock<Cache> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

const CACHE_TTL: Duration = Duration::from_secs(3600);

static SESSION_POOL: OnceLock<PgPool> = OnceLock::new();

/// Called once at startup with the Postgres pool; without it sessions stay in memory only.
pub fn init_session_pool(pool: PgPool) {
    let _ = SESSION_POOL.set(pool);
}

/// Hourly delete of expired session rows.
pub fn spawn_session_cleanup(pool: PgPool) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(3600));
        loop {
            tick.tick().await;
            if let Err(e) = db::purge_expired_sessions(&pool).await {
                eprintln!("sessions: purge failed: {e}");
            }
        }
    });
}

fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// 256-bit opaque token (hex). std seeds `RandomState` keys from the OS once per thread and bumps
/// them per instance; four instances hash a counter and the clock. Not a CSPRNG: dev sign-in only.
/// Before any real sign-in uses this, switch to `getrandom`/`rand` (OS CSPRNG).
fn new_token() -> String {
    let mut bytes = [0u8; 32];
    // Fails closed: no fallback generator if the OS cannot supply randomness.
    getrandom::fill(&mut bytes).expect("OS randomness unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) async fn store_session(account: Account) -> String {
    store_in(sessions(), SESSION_POOL.get(), account).await
}

async fn store_in(cache: &Cache, pool: Option<&PgPool>, account: Account) -> String {
    let token = new_token();
    let hash = token_hash(&token);
    if let Some(pool) = pool {
        // On a database error the session still works from the cache until the next restart.
        if let Err(e) = db::insert_session(pool, &hash, &account.id, SESSION_TTL.as_secs() as i64).await {
            eprintln!("sessions: store failed: {e}");
        }
    }
    let now = Instant::now();
    let mut map = cache.lock().unwrap_or_else(|p| p.into_inner());
    map.retain(|_, s| s.expires > now);
    map.insert(
        hash,
        Session {
            account,
            expires: now + if pool.is_some() { CACHE_TTL } else { SESSION_TTL },
        },
    );
    token
}

async fn lookup_session(token: &str) -> Option<Account> {
    lookup_in(sessions(), SESSION_POOL.get(), token).await
}

async fn lookup_in(cache: &Cache, pool: Option<&PgPool>, token: &str) -> Option<Account> {
    let hash = token_hash(token);
    {
        let mut map = cache.lock().unwrap_or_else(|p| p.into_inner());
        match map.get(&hash) {
            Some(s) if s.expires > Instant::now() => return Some(s.account.clone()),
            Some(_) => {
                map.remove(&hash);
            }
            None => {}
        }
    }
    let account = match db::session_account(pool?, &hash, SESSION_TTL.as_secs() as i64).await {
        Ok(a) => a?,
        Err(e) => {
            eprintln!("sessions: lookup failed: {e}");
            return None;
        }
    };
    cache.lock().unwrap_or_else(|p| p.into_inner()).insert(
        hash,
        Session {
            account: account.clone(),
            expires: Instant::now() + CACHE_TTL,
        },
    );
    Some(account)
}

/// Puts a new display name into every live session of the account (the store holds a clone of the Account).
fn rename_in_sessions(id: &str, display_name: &str) {
    for s in sessions().lock().unwrap_or_else(|p| p.into_inner()).values_mut() {
        if s.account.id == id {
            s.account.display_name = display_name.to_string();
        }
    }
}

async fn revoke_session(token: &str) {
    revoke_in(sessions(), SESSION_POOL.get(), token).await
}

async fn revoke_in(cache: &Cache, pool: Option<&PgPool>, token: &str) {
    let hash = token_hash(token);
    cache.lock().unwrap_or_else(|p| p.into_inner()).remove(&hash);
    if let Some(pool) = pool {
        if let Err(e) = db::delete_session(pool, &hash).await {
            eprintln!("sessions: revoke failed: {e}");
        }
    }
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
pub async fn authenticate(headers: &HeaderMap) -> Option<Account> {
    lookup_session(bearer(headers)?).await
}

/// Value of `key` in a raw query string (no percent-decoding: tokens are hex, versions are digits).
pub fn query_param<'a>(query: Option<&'a str>, key: &str) -> Option<&'a str> {
    query?.split('&').find_map(|kv| kv.strip_prefix(key)?.strip_prefix('='))
}

/// Like `authenticate`, plus a `?token=` query fallback because browsers cannot set headers on a
/// WebSocket. The header wins when both are present (an invalid header does not fall back).
/// [provisional: needs-tien-review] A token in a URL can reach proxy logs; serve over TLS (Caddy) only.
pub async fn authenticate_request(headers: &HeaderMap, query: Option<&str>) -> Option<Account> {
    match bearer(headers) {
        Some(t) => lookup_session(t).await,
        None => lookup_session(query_param(query, "token").filter(|t| !t.is_empty())?).await,
    }
}

/// Test helper for other api modules: a live session token for a fake account with this id.
#[cfg(test)]
pub fn test_token(account_id: &str) -> String {
    let token = new_token();
    let account = Account {
        id: account_id.into(),
        provider: "dev".into(),
        subject: "s".into(),
        display_name: "n".into(),
        role: "player".into(),
        created_at: "t".into(),
    };
    sessions().lock().unwrap().insert(token_hash(&token), Session { account, expires: Instant::now() + SESSION_TTL });
    token
}

fn dev_signin_enabled(flag: Option<&str>) -> bool {
    flag == Some("1")
}

/// No `Debug`: `password` must never end up in a log line.
#[derive(Deserialize)]
pub struct SignInRequest {
    pub provider: String,
    pub subject: String,
    #[serde(default)]
    pub display_name: String,
    /// Only read for provider "developer".
    #[serde(default)]
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct SignInResponse {
    pub token: String,
    pub account: Account,
}

fn valid_field(s: &str) -> bool {
    !s.trim().is_empty() && s.len() <= MAX_FIELD_LEN
}

/// Failed developer sign-ins all take this long, so timing does not tell a wrong password from an unknown user.
const DEVELOPER_FAIL_DELAY: Duration = Duration::from_millis(400);
const MAX_PASSWORD_LEN: usize = 1024;

/// argon2id (the `argon2` crate default) PHC string with a fresh random salt.
pub fn hash_password(password: &str) -> Result<String, String> {
    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).map_err(|e| e.to_string())?;
    let salt = SaltString::encode_b64(&salt).map_err(|e| e.to_string())?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

pub fn verify_password(password: &str, phc: &str) -> bool {
    PasswordHash::new(phc).is_ok_and(|h| Argon2::default().verify_password(password.as_bytes(), &h).is_ok())
}

/// Username 3-32 chars of `[a-z0-9_-]`, password at least 12 chars.
pub fn check_developer_input(username: &str, password: &str) -> Result<(), &'static str> {
    if !(3..=32).contains(&username.len()) || !username.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-') {
        return Err("username must be 3-32 characters of a-z 0-9 _ -");
    }
    if password.chars().count() < 12 {
        return Err("password must be at least 12 characters");
    }
    Ok(())
}

/// The `create-developer` CLI: creates the developer account or resets its password and display name.
pub async fn create_developer(db: &db::Db, username: &str, display_name: &str, password: &str) -> Result<Account, String> {
    check_developer_input(username, password).map_err(String::from)?;
    if !valid_field(display_name) {
        return Err("display name must be 1-256 characters".into());
    }
    let hash = hash_password(password)?;
    db::upsert_developer(db, username, display_name.trim(), &hash).await.map_err(|e| e.to_string())
}

async fn developer_signin(state: AppState, req: SignInRequest) -> Result<Json<SignInResponse>, StatusCode> {
    let started = Instant::now();
    if !valid_field(&req.subject) || req.password.len() > MAX_PASSWORD_LEN {
        return Err(StatusCode::BAD_REQUEST);
    }
    let Some(pool) = state.db.as_ref() else {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    };
    let creds = db::developer_credentials(pool, &req.subject).await.map_err(|e| {
        eprintln!("signin: db error: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let account = match creds {
        Some((account, hash)) => {
            let password = req.password;
            let ok = tokio::task::spawn_blocking(move || verify_password(&password, &hash)).await.unwrap_or(false);
            ok.then_some(account)
        }
        None => None,
    };
    match account {
        Some(account) => {
            let token = store_session(account.clone()).await;
            Ok(Json(SignInResponse { token, account }))
        }
        None => {
            tokio::time::sleep_until((started + DEVELOPER_FAIL_DELAY).into()).await;
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

async fn signin(
    State(state): State<AppState>,
    Json(req): Json<SignInRequest>,
) -> Result<Json<SignInResponse>, StatusCode> {
    if req.provider == "developer" {
        return developer_signin(state, req).await;
    }
    if !dev_signin_enabled(std::env::var("PEAR_DEV_SIGNIN").ok().as_deref()) {
        return Err(StatusCode::FORBIDDEN);
    }
    if req.provider != "dev" {
        return Err(StatusCode::BAD_REQUEST);
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
    let token = store_session(account.clone()).await;
    Ok(Json(SignInResponse { token, account }))
}

/// `me` adds the friend code to the account fields so the app can show it.
#[derive(Debug, Serialize)]
struct MeResponse {
    #[serde(flatten)]
    account: Account,
    friend_code: String,
}

async fn me(headers: HeaderMap) -> Result<Json<MeResponse>, StatusCode> {
    authenticate(&headers)
        .await
        .map(|account| Json(MeResponse { friend_code: db::friend_code(&account.id), account }))
        .ok_or(StatusCode::UNAUTHORIZED)
}

#[derive(Debug, Deserialize)]
struct RenameRequest {
    display_name: String,
}

async fn rename(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RenameRequest>,
) -> Result<Json<MeResponse>, StatusCode> {
    let me = authenticate(&headers).await.ok_or(StatusCode::UNAUTHORIZED)?;
    let name = req.display_name.trim();
    if !valid_field(name) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let account = db::update_display_name(pool, &me.id, name)
        .await
        .map_err(|e| {
            eprintln!("rename: db error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or(StatusCode::NOT_FOUND)?;
    rename_in_sessions(&account.id, &account.display_name);
    Ok(Json(MeResponse { friend_code: db::friend_code(&account.id), account }))
}

async fn signout(headers: HeaderMap) -> StatusCode {
    if let Some(t) = bearer(&headers) {
        revoke_session(t).await;
    }
    StatusCode::NO_CONTENT
}

/// Routes: POST /api/accounts/signin, GET /api/accounts/me, POST /api/accounts/signout.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/accounts/signin", post(signin))
        .route("/api/accounts/me", get(me).put(rename))
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
            role: "player".into(),
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

    #[tokio::test]
    async fn session_round_trip_and_revoke() {
        let t = store_session(acct("a1")).await;
        assert_eq!(authenticate(&headers_with(&t)).await.unwrap().id, "a1");
        revoke_session(&t).await;
        assert!(authenticate(&headers_with(&t)).await.is_none());
    }

    #[tokio::test]
    async fn unknown_or_malformed_auth_rejected() {
        assert!(authenticate(&HeaderMap::new()).await.is_none());
        assert!(authenticate(&headers_with("nope")).await.is_none());
        let mut h = HeaderMap::new();
        h.insert(header::AUTHORIZATION, HeaderValue::from_static("Basic abc"));
        assert!(authenticate(&h).await.is_none());
        h.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer "));
        assert!(authenticate(&h).await.is_none());
    }

    #[tokio::test]
    async fn query_token_works_and_header_wins() {
        let t = store_session(acct("q1")).await;
        let other = store_session(acct("q2")).await;
        let q = format!("version=2&token={t}");
        assert_eq!(authenticate_request(&HeaderMap::new(), Some(&q)).await.unwrap().id, "q1");
        assert_eq!(authenticate_request(&headers_with(&other), Some(&q)).await.unwrap().id, "q2");
        assert!(authenticate_request(&headers_with("nope"), Some(&q)).await.is_none());
        assert!(authenticate_request(&HeaderMap::new(), Some("token=")).await.is_none());
        assert!(authenticate_request(&HeaderMap::new(), None).await.is_none());
        assert_eq!(query_param(Some("a=1&xtoken=2"), "token"), None);
    }

    #[tokio::test]
    async fn expired_session_rejected() {
        let cache: Cache = Mutex::new(HashMap::new());
        let t = new_token();
        cache.lock().unwrap().insert(
            token_hash(&t),
            Session {
                account: acct("a2"),
                expires: Instant::now() - Duration::from_secs(1),
            },
        );
        assert!(lookup_in(&cache, None, &t).await.is_none());
        assert!(cache.lock().unwrap().is_empty());
    }

    #[test]
    fn token_hash_is_sha256_hex() {
        assert_eq!(token_hash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[tokio::test]
    async fn memory_mode_round_trip_and_signout() {
        let cache: Cache = Mutex::new(HashMap::new());
        let t = store_in(&cache, None, acct("m1")).await;
        assert!(cache.lock().unwrap().contains_key(&token_hash(&t)));
        assert!(!cache.lock().unwrap().contains_key(&t));
        assert_eq!(lookup_in(&cache, None, &t).await.unwrap().id, "m1");
        revoke_in(&cache, None, &t).await;
        assert!(lookup_in(&cache, None, &t).await.is_none());
    }

    // Runs only with DATABASE_URL set. A fresh cache stands in for a restarted server.
    #[tokio::test]
    async fn sessions_survive_restart_in_postgres() {
        let Ok(url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let pool = db::connect_lazy(&url).unwrap();
        // db_round_trip migrates the same fresh database in parallel; migrate is idempotent, so retry a lost race.
        for i in 0..5 {
            if db::migrate(&pool).await.is_ok() {
                break;
            }
            assert!(i < 4, "migrate kept failing");
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        let subject = format!("sess-{}", std::process::id());
        let a = db::upsert_account(&db::Db::Pg(pool.clone()), "test", &subject, "S").await.unwrap();
        let before: Cache = Mutex::new(HashMap::new());
        let t = store_in(&before, Some(&pool), a.clone()).await;
        let after: Cache = Mutex::new(HashMap::new());
        assert_eq!(lookup_in(&after, Some(&pool), &t).await.unwrap(), a);
        assert!(after.lock().unwrap().contains_key(&token_hash(&t)));
        let raw: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions WHERE token_hash = $1")
            .bind(&t)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(raw, 0);
        // sliding: a row idle for over an hour is pushed out on the next lookup
        sqlx::query("UPDATE sessions SET last_used_at = now() - interval '1 day', expires_at = now() + interval '1 day' WHERE token_hash = $1")
            .bind(token_hash(&t))
            .execute(&pool)
            .await
            .unwrap();
        let c3: Cache = Mutex::new(HashMap::new());
        assert!(lookup_in(&c3, Some(&pool), &t).await.is_some());
        let days: f64 = sqlx::query_scalar("SELECT (extract(epoch FROM expires_at - now()) / 86400)::float8 FROM sessions WHERE token_hash = $1")
            .bind(token_hash(&t))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(days > 29.0, "{days}");
        // expired row: rejected and deleted
        sqlx::query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1")
            .bind(token_hash(&t))
            .execute(&pool)
            .await
            .unwrap();
        let c4: Cache = Mutex::new(HashMap::new());
        assert!(lookup_in(&c4, Some(&pool), &t).await.is_none());
        assert!(db::purge_expired_sessions(&pool).await.is_ok());
        // signout removes the row
        let t2 = store_in(&before, Some(&pool), a.clone()).await;
        revoke_in(&before, Some(&pool), &t2).await;
        assert!(lookup_in(&Mutex::new(HashMap::new()), Some(&pool), &t2).await.is_none());
        // deleting the account cascades
        let t3 = store_in(&before, Some(&pool), a.clone()).await;
        sqlx::query("DELETE FROM accounts WHERE id = $1::uuid").bind(&a.id).execute(&pool).await.unwrap();
        assert!(lookup_in(&Mutex::new(HashMap::new()), Some(&pool), &t3).await.is_none());
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

    #[test]
    fn password_hash_round_trip() {
        let h = hash_password("correct horse battery").unwrap();
        assert!(h.starts_with("$argon2id$"), "{h}");
        assert!(verify_password("correct horse battery", &h));
        assert!(!verify_password("correct horse batterz", &h));
        assert!(!verify_password("x", "not a phc string"));
        assert_ne!(h, hash_password("correct horse battery").unwrap()); // fresh salt each time
    }

    #[test]
    fn developer_input_rules() {
        assert!(check_developer_input("ann_b-2", "twelve chars!").is_ok());
        assert!(check_developer_input("ab", "twelve chars!").is_err());
        assert!(check_developer_input(&"a".repeat(33), "twelve chars!").is_err());
        assert!(check_developer_input("Ann", "twelve chars!").is_err());
        assert!(check_developer_input("ann.b", "twelve chars!").is_err());
        assert!(check_developer_input("ann", "short").is_err());
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
        let t = store_session(acct("a3")).await;
        let r = request(&format!(
            "GET /api/accounts/me HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {t}\r\nConnection: close\r\n\r\n"
        ))
        .await;
        assert!(r.starts_with("HTTP/1.1 200"), "{r}");
        assert!(r.contains("\"id\":\"a3\""), "{r}");
    }

    #[tokio::test]
    async fn signout_revokes_token() {
        let t = store_session(acct("a4")).await;
        let r = request(&format!(
            "POST /api/accounts/signout HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {t}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ))
        .await;
        assert!(r.starts_with("HTTP/1.1 204"), "{r}");
        assert!(lookup_session(&t).await.is_none());
    }
}
