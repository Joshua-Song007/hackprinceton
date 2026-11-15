// GET /api/library over HTTP against the in-memory store (what the server uses when DATABASE_URL is unset).
// One test function on purpose: it sets PEAR_DEV_SIGNIN, and std::env::set_var must not race another
// test thread reading the environment (signin, and cors_layer reads PEAR_CORS_ORIGINS on every app build).
use pear_backend::app_with_studio;
use pear_backend::db::Db;
use pear_backend::memstore::MemStore;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// One request over a raw socket; returns (status code, JSON body or Null).
async fn call(addr: std::net::SocketAddr, method: &str, path: &str, token: Option<&str>, body: Option<&Value>) -> (u16, Value) {
    let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let raw = format!(
        "{method} {path} HTTP/1.1\r\nHost: x\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
    s.write_all(raw.as_bytes()).await.unwrap();
    let mut buf = String::new();
    s.read_to_string(&mut buf).await.unwrap();
    let status = buf.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or_else(|| panic!("bad response: {buf}"));
    let body = buf
        .split_once("\r\n\r\n")
        .and_then(|(_, b)| serde_json::from_str(b.trim()).ok())
        .unwrap_or(Value::Null);
    (status, body)
}

async fn sign_in(addr: std::net::SocketAddr, subject: &str, name: &str) -> String {
    let (st, body) = call(
        addr,
        "POST",
        "/api/accounts/signin",
        None,
        Some(&json!({"provider": "dev", "subject": subject, "display_name": name})),
    )
    .await;
    assert_eq!(st, 200, "signin: {body}");
    body["token"].as_str().expect("token").to_string()
}

async fn create_game(addr: std::net::SocketAddr, token: &str, title: &str) -> String {
    let (st, game) = call(addr, "POST", "/api/games", Some(token), Some(&json!({"title": title}))).await;
    assert_eq!(st, 201, "{game}");
    game["id"].as_str().expect("game id").to_string()
}

async fn publish(addr: std::net::SocketAddr, token: &str, game: &str, scene: Value, run_mode: &str) {
    let v = json!({
        "scene": scene,
        "client_scripts": {},
        "server_scripts": {},
        "assets": {},
        "metadata": {},
        "run_mode": run_mode
    });
    let (st, body) = call(addr, "POST", &format!("/api/games/{game}/versions"), Some(token), Some(&v)).await;
    assert_eq!(st, 201, "{body}");
}

async fn library(addr: std::net::SocketAddr, token: &str) -> Vec<Value> {
    let (st, rows) = call(addr, "GET", "/api/library", Some(token), None).await;
    assert_eq!(st, 200, "{rows}");
    rows.as_array().expect("array").clone()
}

#[tokio::test]
async fn library_lists_published_games_for_any_signed_in_account() {
    std::env::set_var("PEAR_DEV_SIGNIN", "1");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app_with_studio(Some(Db::Mem(MemStore::default())), None);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    // Signed out: no token and an unknown token are both refused.
    let (st, _) = call(addr, "GET", "/api/library", None, None).await;
    assert_eq!(st, 401);
    let (st, _) = call(addr, "GET", "/api/library", Some("not-a-session"), None).await;
    assert_eq!(st, 401);

    // Catalog fields: a different account (not the owner) sees the newest version's details, and only those.
    let ann = sign_in(addr, "ann", "Ann").await;
    let bob = sign_in(addr, "bob", "Bob").await;
    assert!(library(addr, &bob).await.is_empty());
    let g1 = create_game(addr, &ann, "Haunted house").await;
    publish(addr, &ann, &g1, json!({"requiredTier": 1}), "screen").await;
    publish(addr, &ann, &g1, json!({"requiredTier": 2}), "device").await;
    let draft = create_game(addr, &ann, "Draft").await;
    let rows = library(addr, &bob).await;
    assert_eq!(rows.len(), 1, "{rows:?}");
    assert_eq!(
        rows[0],
        json!({"id": g1, "title": "Haunted house", "author": "Ann", "latestVersion": 2, "runMode": "device", "requiredTier": 2, "description": "", "coverUrl": null})
    );
    assert!(rows.iter().all(|r| r["id"] != draft), "an unpublished game must not be listed");

    // Newest wins, and the most recently published game comes first.
    let g2 = create_game(addr, &bob, "Maze").await;
    publish(addr, &bob, &g2, json!({}), "screen").await;
    let ids = |rows: &[Value]| rows.iter().map(|r| r["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();
    let rows = library(addr, &ann).await;
    assert_eq!(ids(&rows), vec![g2.clone(), g1.clone()]);
    assert_eq!((rows[0]["requiredTier"].clone(), rows[0]["author"].clone()), (json!(1), json!("Bob")));
    publish(addr, &ann, &g1, json!({"requiredTier": 1}), "screen").await;
    let rows = library(addr, &ann).await;
    assert_eq!(ids(&rows), vec![g1.clone(), g2.clone()]);
    assert_eq!(
        (rows[0]["latestVersion"].clone(), rows[0]["runMode"].clone(), rows[0]["requiredTier"].clone()),
        (json!(3), json!("screen"), json!(1))
    );
}
