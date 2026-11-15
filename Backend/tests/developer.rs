// Developer accounts end to end against the in-memory store: password sign-in, the closed passwordless
// path, developer edit rights, the all-games listing, game metadata and covers, and the library fields.
// One test function on purpose: it sets PEAR_DEV_SIGNIN, and std::env::set_var must not race another test.
use pear_backend::api::accounts::create_developer;
use pear_backend::app_with_studio;
use pear_backend::db::Db;
use pear_backend::memstore::MemStore;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 1, 2, 3];
const JPG: &[u8] = &[0xFF, 0xD8, 0xFF, 9, 9];

/// One request over a raw socket; returns (status, headers text, body bytes).
async fn raw(addr: std::net::SocketAddr, method: &str, path: &str, token: Option<&str>, ctype: &str, body: &[u8]) -> (u16, String, Vec<u8>) {
    let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: x\r\n{auth}Content-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
    s.write_all(head.as_bytes()).await.unwrap();
    // The server may answer (413) and close before the whole body is sent; that write error is fine.
    let _ = s.write_all(body).await;
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf).await;
    let split = buf.windows(4).position(|w| w == b"\r\n\r\n").expect("response head");
    let headers = String::from_utf8_lossy(&buf[..split]).to_string();
    let status = headers.split_whitespace().nth(1).and_then(|c| c.parse().ok()).expect("status");
    (status, headers, buf[split + 4..].to_vec())
}

async fn call(addr: std::net::SocketAddr, method: &str, path: &str, token: Option<&str>, body: Option<Value>) -> (u16, Value) {
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let (st, _, b) = raw(addr, method, path, token, "application/json", payload.as_bytes()).await;
    (st, serde_json::from_slice(&b).unwrap_or(Value::Null))
}

async fn player(addr: std::net::SocketAddr, name: &str) -> String {
    let (st, b) = call(addr, "POST", "/api/accounts/signin", None, Some(json!({"provider": "dev", "subject": name, "display_name": name}))).await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(b["account"]["role"], "player");
    b["token"].as_str().unwrap().to_string()
}

fn version() -> Value {
    json!({"scene": {}, "client_scripts": {}, "server_scripts": {}, "assets": {}, "metadata": {}, "run_mode": "screen"})
}

#[tokio::test]
async fn developer_login_permissions_metadata_and_covers() {
    std::env::remove_var("PEAR_DEV_SIGNIN"); // developer sign-in must work with the passwordless path off
    let mem = MemStore::default();
    let acct = create_developer(&Db::Mem(mem.clone()), "dev-ann", "Dev Ann", "a long password").await.unwrap();
    assert_eq!(acct.role, "developer");
    assert!(create_developer(&Db::Mem(mem.clone()), "dev-ann", "Dev Ann", "short").await.is_err());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app_with_studio(Some(Db::Mem(mem)), None);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let signin = |u: &'static str, p: &'static str| call(addr, "POST", "/api/accounts/signin", None, Some(json!({"provider": "developer", "subject": u, "password": p})));
    let (st, b) = signin("dev-ann", "a long password").await;
    assert_eq!(st, 200, "{b}");
    assert_eq!((b["account"]["role"].clone(), b["account"]["id"].clone()), (json!("developer"), json!(acct.id)));
    assert!(!b.to_string().contains("argon2") && b["account"].get("password_hash").is_none());
    let dev = b["token"].as_str().unwrap().to_string();
    let (st, me) = call(addr, "GET", "/api/accounts/me", Some(&dev), None).await;
    assert_eq!((st, me["role"].clone()), (200, json!("developer")));

    // Wrong password and unknown user: identical 401 and body, both delayed ~400 ms.
    let t = std::time::Instant::now();
    let wrong = signin("dev-ann", "not the password").await;
    assert!(t.elapsed() >= std::time::Duration::from_millis(390), "{:?}", t.elapsed());
    let t = std::time::Instant::now();
    let unknown = signin("nobody", "not the password").await;
    assert!(t.elapsed() >= std::time::Duration::from_millis(390), "{:?}", t.elapsed());
    assert_eq!((wrong.0, unknown.0), (401, 401));
    assert_eq!(wrong.1, unknown.1);
    // Sign-in never creates an account.
    assert_eq!(signin("nobody", "a long password").await.0, 401);

    // The passwordless path: provider "dev" only.
    std::env::set_var("PEAR_DEV_SIGNIN", "1");
    let ann = player(addr, "ann").await;
    for provider in ["developer-x", "apple", "test"] {
        let (st, _) = call(addr, "POST", "/api/accounts/signin", None, Some(json!({"provider": provider, "subject": "dev-ann"}))).await;
        assert_eq!(st, 400, "{provider}");
    }
    let (st, _) = call(addr, "POST", "/api/accounts/signin", None, Some(json!({"provider": "developer", "subject": "ann"}))).await;
    assert_eq!(st, 401, "a player is not a developer");

    // Developers edit other owners' games; players do not.
    let bob = player(addr, "bob").await;
    let (st, game) = call(addr, "POST", "/api/games", Some(&ann), Some(json!({"title": "Ann's game"}))).await;
    assert_eq!(st, 201);
    let gid = game["id"].as_str().unwrap().to_string();
    assert_eq!((game["owner_name"].clone(), game["description"].clone(), game["has_cover"].clone()), (json!("ann"), json!(""), json!(false)));
    let vpath = format!("/api/games/{gid}/versions");
    assert_eq!(call(addr, "POST", &vpath, Some(&bob), Some(version())).await.0, 403);
    assert_eq!(call(addr, "POST", &vpath, Some(&dev), Some(version())).await.0, 201);
    assert_eq!(call(addr, "PUT", &format!("/api/games/{gid}"), Some(&bob), Some(json!({"title": "x"}))).await.0, 403);

    // ?all=1: developers see every game, players 403, plain listing stays "mine".
    let (st, _) = call(addr, "POST", "/api/games", Some(&bob), Some(json!({"title": "Bob's game"}))).await;
    assert_eq!(st, 201);
    let (st, all) = call(addr, "GET", "/api/games?all=1", Some(&dev), None).await;
    assert_eq!((st, all.as_array().unwrap().len()), (200, 2), "{all}");
    assert_eq!(call(addr, "GET", "/api/games?all=1", Some(&ann), None).await.0, 403);
    let (_, mine) = call(addr, "GET", "/api/games", Some(&dev), None).await;
    assert!(mine.as_array().unwrap().is_empty());
    let (_, mine) = call(addr, "GET", "/api/games", Some(&ann), None).await;
    assert_eq!(mine.as_array().unwrap().len(), 1);

    // Metadata.
    let path = format!("/api/games/{gid}");
    let (st, g) = call(addr, "PUT", &path, Some(&dev), Some(json!({"title": "  Renamed ", "description": "About it"}))).await;
    assert_eq!((st, g["title"].clone(), g["description"].clone()), (200, json!("Renamed"), json!("About it")), "{g}");
    let (st, g) = call(addr, "PUT", &path, Some(&ann), Some(json!({"description": "Owner edit"}))).await;
    assert_eq!((st, g["title"].clone(), g["description"].clone()), (200, json!("Renamed"), json!("Owner edit")));
    for bad in [json!({}), json!({"title": "  "}), json!({"title": "x".repeat(257)}), json!({"description": "x".repeat(4001)})] {
        assert_eq!(call(addr, "PUT", &path, Some(&dev), Some(bad)).await.0, 400);
    }
    assert_eq!(call(addr, "PUT", "/api/games/123e4567-e89b-12d3-a456-426614174000", Some(&dev), Some(json!({"title": "x"}))).await.0, 404);

    // Covers: public GET, content-type and size rules, owner or developer.
    let cpath = format!("{path}/cover");
    assert_eq!(raw(addr, "GET", &cpath, None, "x", b"").await.0, 404);
    assert_eq!(raw(addr, "PUT", &cpath, Some(&ann), "image/png", PNG).await.0, 204);
    let (st, head, body) = raw(addr, "GET", &cpath, None, "x", b"").await;
    let head = head.to_lowercase();
    assert_eq!((st, body.as_slice()), (200, PNG));
    assert!(head.contains("content-type: image/png") && head.contains("cache-control: no-cache"), "{head}");
    assert_eq!(raw(addr, "PUT", &cpath, Some(&dev), "image/jpeg", JPG).await.0, 204);
    assert_eq!(raw(addr, "GET", &cpath, None, "x", b"").await.2, JPG);
    assert_eq!(raw(addr, "PUT", &cpath, Some(&bob), "image/png", PNG).await.0, 403);
    assert_eq!(raw(addr, "PUT", &cpath, Some(&ann), "image/gif", PNG).await.0, 415);
    assert_eq!(raw(addr, "PUT", &cpath, Some(&ann), "image/png", JPG).await.0, 415, "bytes must match the declared type");
    assert_eq!(raw(addr, "PUT", &cpath, None, "image/png", PNG).await.0, 401);
    let mut big = PNG.to_vec();
    big.resize(2 * 1024 * 1024 + 1, 0);
    assert_eq!(raw(addr, "PUT", &cpath, Some(&ann), "image/png", &big).await.0, 413);
    let (_, one) = call(addr, "GET", "/api/games", Some(&ann), None).await;
    assert_eq!(one[0]["has_cover"], true);

    // Library: description and coverUrl.
    let (st, lib) = call(addr, "GET", "/api/library", Some(&bob), None).await;
    assert_eq!(st, 200);
    assert_eq!(lib[0]["description"], "Owner edit");
    let url = lib[0]["coverUrl"].as_str().unwrap();
    assert!(url.starts_with(&format!("/api/games/{gid}/cover?v=")), "{url}");
    assert_eq!(raw(addr, "DELETE", &cpath, Some(&bob), "x", b"").await.0, 403);
    assert_eq!(raw(addr, "DELETE", &cpath, Some(&dev), "x", b"").await.0, 204);
    assert_eq!(raw(addr, "GET", &cpath, None, "x", b"").await.0, 404);
    let (_, lib) = call(addr, "GET", "/api/library", Some(&bob), None).await;
    assert_eq!(lib[0]["coverUrl"], Value::Null);

    // Delete another owner's game as a developer (players get 403).
    assert_eq!(call(addr, "DELETE", &path, Some(&bob), None).await.0, 403);
    assert_eq!(call(addr, "DELETE", &path, Some(&dev), None).await.0, 204);
    assert_eq!(raw(addr, "GET", &cpath, None, "x", b"").await.0, 404);
}
