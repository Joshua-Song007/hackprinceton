// Integration tests for the HTTP API: publish -> fetch round-trip, non-owner publish rejected.
// Tests that need the database read DATABASE_URL and return early when it is unset.
use pear_backend::{app, db};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const MISSING_GAME: &str = "123e4567-e89b-12d3-a456-426614174000";

/// Serves `app(pool)` on a loopback port and returns its address.
async fn serve(pool: Option<sqlx::postgres::PgPool>) -> std::net::SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app(pool);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    addr
}

/// One request over a raw socket; returns (status code, JSON body or Null).
async fn call(
    addr: std::net::SocketAddr,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<&Value>,
) -> (u16, Value) {
    let auth = token
        .map(|t| format!("Authorization: Bearer {t}\r\n"))
        .unwrap_or_default();
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let raw = format!(
        "{method} {path} HTTP/1.1\r\nHost: x\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
    s.write_all(raw.as_bytes()).await.unwrap();
    let mut buf = String::new();
    s.read_to_string(&mut buf).await.unwrap();
    let status = buf
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse::<u16>().ok())
        .unwrap_or_else(|| panic!("bad response: {buf}"));
    let body = buf
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.trim())
        .and_then(|b| serde_json::from_str(b).ok())
        .unwrap_or(Value::Null);
    (status, body)
}

fn unique(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{prefix}-{nanos}")
}

/// Dev sign-in for a fresh account; returns its bearer token.
async fn sign_in(addr: std::net::SocketAddr, name: &str) -> String {
    let (st, body) = call(
        addr,
        "POST",
        "/api/accounts/signin",
        None,
        Some(&json!({"provider": "test", "subject": unique(name), "display_name": name})),
    )
    .await;
    assert_eq!(st, 200, "signin: {body}");
    body["token"].as_str().expect("token").to_string()
}

fn version(title: &str) -> Value {
    json!({
        "scene": {"title": title},
        "client_scripts": {"player.js": "export default script({});"},
        "server_scripts": {"game.js": "export default serverScript({});"},
        "assets": {},
        "metadata": {"title": title},
        "run_mode": "screen"
    })
}

/// A pool on DATABASE_URL with the schema applied, or None when the variable is unset.
async fn pool_or_skip() -> Option<sqlx::postgres::PgPool> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect_lazy(&url).expect("DATABASE_URL invalid");
    db::migrate(&pool).await.expect("migrate");
    // Only this test binary touches the variable; the dev sign-in route is gated on it.
    std::env::set_var("PEAR_DEV_SIGNIN", "1");
    Some(pool)
}

#[tokio::test]
async fn games_api_requires_auth() {
    let addr = serve(None).await;
    let (st, _) = call(addr, "GET", "/api/games", None, None).await;
    assert_eq!(st, 401);
    let (st, _) = call(addr, "POST", "/api/games", None, Some(&json!({"title": "t"}))).await;
    assert_eq!(st, 401);
    let (st, _) = call(
        addr,
        "POST",
        &format!("/api/games/{MISSING_GAME}/versions"),
        None,
        Some(&version("t")),
    )
    .await;
    assert_eq!(st, 401);
    let (st, _) = call(
        addr,
        "GET",
        &format!("/api/games/{MISSING_GAME}/versions/latest"),
        None,
        None,
    )
    .await;
    assert_eq!(st, 401);
}

#[tokio::test]
async fn publish_then_fetch_round_trip() {
    let Some(pool) = pool_or_skip().await else {
        return;
    };
    let addr = serve(Some(pool)).await;
    let tok = sign_in(addr, "owner").await;

    let (st, game) = call(addr, "POST", "/api/games", Some(&tok), Some(&json!({"title": "Round trip"}))).await;
    assert_eq!(st, 201, "{game}");
    let gid = game["id"].as_str().expect("game id").to_string();

    let (st, listed) = call(addr, "GET", "/api/games", Some(&tok), None).await;
    assert_eq!(st, 200);
    assert!(listed.as_array().unwrap().iter().any(|g| g["id"] == gid), "{listed}");

    let v1 = version("one");
    let (st, pub1) = call(addr, "POST", &format!("/api/games/{gid}/versions"), Some(&tok), Some(&v1)).await;
    assert_eq!(st, 201, "{pub1}");
    assert_eq!(pub1["version"], 1);
    let v2 = version("two");
    let (st, pub2) = call(addr, "POST", &format!("/api/games/{gid}/versions"), Some(&tok), Some(&v2)).await;
    assert_eq!(st, 201, "{pub2}");
    assert_eq!(pub2["version"], 2);

    let (st, got) = call(addr, "GET", &format!("/api/games/{gid}/versions/1"), Some(&tok), None).await;
    assert_eq!(st, 200, "{got}");
    for k in ["scene", "client_scripts", "server_scripts", "assets", "metadata", "run_mode"] {
        assert_eq!(got[k], v1[k], "field {k}");
    }
    let (st, latest) = call(addr, "GET", &format!("/api/games/{gid}/versions/latest"), Some(&tok), None).await;
    assert_eq!(st, 200, "{latest}");
    assert_eq!(latest["version"], 2);
    assert_eq!(latest["scene"], v2["scene"]);

    let (st, _) = call(addr, "GET", &format!("/api/games/{gid}/versions/99"), Some(&tok), None).await;
    assert_eq!(st, 404);
}

#[tokio::test]
async fn non_owner_publish_is_rejected() {
    let Some(pool) = pool_or_skip().await else {
        return;
    };
    let addr = serve(Some(pool)).await;
    let owner = sign_in(addr, "owner").await;
    let other = sign_in(addr, "intruder").await;

    let (st, game) = call(addr, "POST", "/api/games", Some(&owner), Some(&json!({"title": "Mine"}))).await;
    assert_eq!(st, 201, "{game}");
    let gid = game["id"].as_str().expect("game id").to_string();

    let (st, _) = call(addr, "POST", &format!("/api/games/{gid}/versions"), Some(&other), Some(&version("x"))).await;
    assert_eq!(st, 403);
    // Nothing was stored by the rejected publish.
    let (st, _) = call(addr, "GET", &format!("/api/games/{gid}/versions/latest"), Some(&owner), None).await;
    assert_eq!(st, 404);
    // The owner can still publish.
    let (st, _) = call(addr, "POST", &format!("/api/games/{gid}/versions"), Some(&owner), Some(&version("ok"))).await;
    assert_eq!(st, 201);
    // Unknown game id is 404, not 403.
    let (st, _) = call(addr, "POST", &format!("/api/games/{MISSING_GAME}/versions"), Some(&owner), Some(&version("x"))).await;
    assert_eq!(st, 404);
}
