// Publish -> fetch round trip against the in-memory store (what the server uses when DATABASE_URL is unset).
use pear_backend::db::Db;
use pear_backend::memstore::MemStore;
use pear_backend::app_with_studio;
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

async fn sign_in(addr: std::net::SocketAddr, subject: &str) -> String {
    let (st, body) = call(
        addr,
        "POST",
        "/api/accounts/signin",
        None,
        Some(&json!({"provider": "test", "subject": subject, "display_name": subject})),
    )
    .await;
    assert_eq!(st, 200, "signin: {body}");
    body["token"].as_str().expect("token").to_string()
}

#[tokio::test]
async fn memory_mode_publish_then_fetch_round_trip() {
    // Only this test binary touches the variable; the dev sign-in route is gated on it.
    std::env::set_var("PEAR_DEV_SIGNIN", "1");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app_with_studio(Some(Db::Mem(MemStore::default())), None);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let owner = sign_in(addr, "owner").await;
    let other = sign_in(addr, "intruder").await;
    let (st, game) = call(addr, "POST", "/api/games", Some(&owner), Some(&json!({"title": "Mem"}))).await;
    assert_eq!(st, 201, "{game}");
    let gid = game["id"].as_str().expect("game id").to_string();

    let v = json!({
        "scene": {"title": "one"},
        "client_scripts": {"player.js": "x"},
        "server_scripts": {"game.js": "y"},
        "assets": {},
        "metadata": {"title": "one"},
        "run_mode": "screen"
    });
    let path = format!("/api/games/{gid}/versions");
    let (st, _) = call(addr, "POST", &path, Some(&other), Some(&v)).await;
    assert_eq!(st, 403);
    let (st, p1) = call(addr, "POST", &path, Some(&owner), Some(&v)).await;
    assert_eq!((st, &p1["version"]), (201, &json!(1)), "{p1}");
    let (st, p2) = call(addr, "POST", &path, Some(&owner), Some(&v)).await;
    assert_eq!((st, &p2["version"]), (201, &json!(2)), "{p2}");

    let (st, latest) = call(addr, "GET", &format!("{path}/latest"), Some(&owner), None).await;
    assert_eq!(st, 200, "{latest}");
    assert_eq!(latest["version"], 2);
    assert_eq!(latest["server_scripts"], v["server_scripts"]);
    let (st, first) = call(addr, "GET", &format!("{path}/1"), Some(&owner), None).await;
    assert_eq!((st, &first["id"]), (200, &p1["id"]));
    let (st, _) = call(addr, "GET", &format!("{path}/99"), Some(&owner), None).await;
    assert_eq!(st, 404);
    let (st, listed) = call(addr, "GET", "/api/games", Some(&owner), None).await;
    assert_eq!(st, 200);
    assert!(listed.as_array().unwrap().iter().any(|g| g["id"] == gid), "{listed}");
}
