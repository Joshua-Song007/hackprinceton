// Hosting ops against the in-memory store: /api/status (public vs developer), content-addressed game assets,
// publish validation of asset references, and live-instance ops (list / close / kick / limits).
// The instance test also sets the limit env vars, so it is the only test here that touches them.
use pear_backend::api::accounts::create_developer;
use pear_backend::app_with_studio;
use pear_backend::db::Db;
use pear_backend::memstore::MemStore;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

type Addr = std::net::SocketAddr;

async fn serve() -> Addr {
    std::env::set_var("PEAR_DEV_SIGNIN", "1");
    std::env::set_var("PEAR_DEV_SIGNIN_PREFIX", ""); // these tests use free-form subjects
    let mem = MemStore::default();
    create_developer(&Db::Mem(mem.clone()), "infra-dev", "Infra Dev", "a long password").await.unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app_with_studio(Some(Db::Mem(mem)), None);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    addr
}

/// One request; returns (status, header text lowercased, body bytes).
async fn raw(addr: Addr, method: &str, path: &str, token: Option<&str>, headers: &str, body: &[u8]) -> (u16, String, Vec<u8>) {
    let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
    let head = format!("{method} {path} HTTP/1.1\r\nHost: x\r\n{auth}{headers}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    let mut s = TcpStream::connect(addr).await.unwrap();
    s.write_all(head.as_bytes()).await.unwrap();
    let _ = s.write_all(body).await; // the server may answer 413 and close first
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf).await;
    let split = buf.windows(4).position(|w| w == b"\r\n\r\n").expect("response head");
    let h = String::from_utf8_lossy(&buf[..split]).to_ascii_lowercase();
    let status = h.split_whitespace().nth(1).and_then(|c| c.parse().ok()).expect("status");
    (status, h, buf[split + 4..].to_vec())
}

async fn call(addr: Addr, method: &str, path: &str, token: Option<&str>, body: Option<Value>) -> (u16, Value) {
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let (st, _, b) = raw(addr, method, path, token, "Content-Type: application/json\r\n", payload.as_bytes()).await;
    (st, serde_json::from_slice(&b).unwrap_or(Value::Null))
}

async fn player(addr: Addr, name: &str) -> String {
    let (st, b) = call(addr, "POST", "/api/accounts/signin", None, Some(json!({"provider": "dev", "subject": name, "display_name": name}))).await;
    assert_eq!(st, 200, "{b}");
    b["token"].as_str().unwrap().to_string()
}

async fn developer(addr: Addr) -> String {
    let (st, b) = call(addr, "POST", "/api/accounts/signin", None, Some(json!({"provider": "developer", "subject": "infra-dev", "password": "a long password"}))).await;
    assert_eq!(st, 200, "{b}");
    b["token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn status_is_public_and_developers_get_detail() {
    let addr = serve().await;
    let (st, b) = call(addr, "GET", "/api/status", None, None).await;
    assert_eq!(st, 200);
    assert_eq!((b["ok"].clone(), b["storage"].clone(), b["database"].clone()), (json!(true), json!("memory"), json!("memory")));
    assert!(b["version"].as_str().unwrap().starts_with(env!("CARGO_PKG_VERSION")));
    for k in ["storage_detail", "instances", "players", "uptime_s", "limits"] {
        assert!(b.get(k).is_none(), "public status must not show {k}");
    }
    let p = player(addr, "status-player").await;
    assert!(call(addr, "GET", "/api/status", Some(&p), None).await.1.get("limits").is_none());

    let dev = developer(addr).await;
    let (_, b) = call(addr, "GET", "/api/status?probe=1", Some(&dev), None).await;
    assert_eq!(b["storage_detail"]["description"], "memory");
    assert_eq!(b["storage_detail"]["probe"]["ok"], true);
    assert!(b["storage_detail"]["probe"]["at"].as_str().unwrap().ends_with('Z'));
    assert!(b["instances"].is_u64() && b["players"].is_u64() && b["uptime_s"].is_u64());
    assert_eq!((b["limits"]["max_instances"].clone(), b["limits"]["max_players_per_instance"].clone()), (json!(200), json!(16)));
    // The cached probe is shown without ?probe=1.
    let (_, b) = call(addr, "GET", "/api/status", Some(&dev), None).await;
    assert_eq!(b["storage_detail"]["probe"]["ok"], true);
}

async fn put_asset(addr: Addr, gid: String, name: String, tok: Option<String>, ty: String, body: Vec<u8>) -> (u16, String, Vec<u8>) {
    let path = format!("/api/games/{gid}/assets/{name}");
    raw(addr, "PUT", &path, tok.as_deref(), &format!("Content-Type: {ty}\r\n"), &body).await
}

async fn publish(addr: Addr, gid: String, tok: String, assets: Value) -> (u16, Value) {
    call(addr, "POST", &format!("/api/games/{gid}/versions"), Some(&tok), Some(version(assets))).await
}

fn version(assets: Value) -> Value {
    json!({"scene": {}, "client_scripts": {}, "server_scripts": {}, "assets": assets, "metadata": {}, "run_mode": "screen"})
}

#[tokio::test]
async fn assets_put_get_dedup_limits_permissions_and_publish_validation() {
    let addr = serve().await;
    let (ann, bob, dev) = (player(addr, "asset-ann").await, player(addr, "asset-bob").await, developer(addr).await);
    let (_, game) = call(addr, "POST", "/api/games", Some(&ann), Some(json!({"title": "G"}))).await;
    let gid = game["id"].as_str().unwrap().to_string();
    let put = |name: &str, tok: Option<&String>, ty: &str, body: Vec<u8>| put_asset(addr, gid.clone(), name.to_string(), tok.cloned(), ty.to_string(), body);
    let (ann_t, bob_t, dev_t) = (Some(&ann), Some(&bob), Some(&dev));

    let png = vec![0x89, b'P', b'N', b'G', 1, 2, 3];
    let sha = {
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(&png))
    };
    let (st, _, b) = put("a.png", ann_t, "image/png", png.clone()).await;
    assert_eq!(st, 200);
    let j: Value = serde_json::from_slice(&b).unwrap();
    assert_eq!((j["name"].clone(), j["sha256"].clone(), j["size"].clone(), j["content_type"].clone()), (json!("a.png"), json!(sha), json!(7), json!("image/png")));
    // Same bytes under another name and by a developer: same address (dedup).
    let (st, _, b) = put("b.png", dev_t, "image/png; x=y", png.clone()).await;
    assert_eq!(st, 200);
    assert_eq!(serde_json::from_slice::<Value>(&b).unwrap()["sha256"], json!(sha));

    // Public GET with type and cache headers; conditional GET.
    let (st, h, body) = raw(addr, "GET", &format!("/api/assets/{sha}"), None, "", b"").await;
    assert_eq!((st, body), (200, png.clone()));
    assert!(h.contains("content-type: image/png"), "{h}");
    assert!(h.contains("cache-control: public, max-age=31536000, immutable"), "{h}");
    assert!(h.contains(&format!("etag: \"{sha}\"")) && h.contains("x-content-type-options: nosniff"), "{h}");
    assert!(!h.contains("content-disposition"), "{h}");
    let (st, _, _) = raw(addr, "GET", &format!("/api/assets/{sha}"), None, &format!("If-None-Match: \"{sha}\"\r\n"), b"").await;
    assert_eq!(st, 304);
    assert_eq!(raw(addr, "GET", &format!("/api/assets/{}", "0".repeat(64)), None, "", b"").await.0, 404);
    assert_eq!(raw(addr, "GET", "/api/assets/not-a-sha", None, "", b"").await.0, 404);

    // HTML is inline + nosniff.
    let (_, _, b) = put("page.html", ann_t, "text/html", b"<p>hi</p>".to_vec()).await;
    let hsha = serde_json::from_slice::<Value>(&b).unwrap()["sha256"].as_str().unwrap().to_string();
    let (_, h, _) = raw(addr, "GET", &format!("/api/assets/{hsha}"), None, "", b"").await;
    assert!(h.contains("content-type: text/html") && h.contains("content-disposition: inline") && h.contains("x-content-type-options: nosniff"), "{h}");

    // Validation and permissions.
    assert_eq!(put("a.png", None, "image/png", png.clone()).await.0, 401);
    assert_eq!(put("a.png", bob_t, "image/png", png.clone()).await.0, 403);
    assert_eq!(put("a b.png", ann_t, "image/png", png.clone()).await.0, 400);
    assert_eq!(put(&"x".repeat(129), ann_t, "image/png", png.clone()).await.0, 400);
    assert_eq!(put("a.svg", ann_t, "image/svg+xml", png.clone()).await.0, 415);
    assert_eq!(put("a.bin", ann_t, "application/octet-stream", png.clone()).await.0, 415);
    assert_eq!(put("big.png", ann_t, "image/png", vec![1u8; 10 * 1024 * 1024 + 1]).await.0, 413);
    assert_eq!(put("max.png", ann_t, "image/png", vec![2u8; 10 * 1024 * 1024]).await.0, 200);
    let missing = "/api/games/123e4567-e89b-12d3-a456-426614174000/assets/a.png";
    assert_eq!(raw(addr, "PUT", missing, Some(&ann), "Content-Type: image/png\r\n", &png).await.0, 404);

    // Publish: unknown sha 400, malformed 400, stored sha and legacy entries OK.
    let v = |assets: Value| publish(addr, gid.clone(), ann.clone(), assets);
    assert_eq!(v(json!({"a.png": {"sha256": "1".repeat(64), "size": 1, "content_type": "image/png"}})).await.0, 400);
    assert_eq!(v(json!({"a.png": {"sha256": "nope"}})).await.0, 400);
    assert_eq!(v(json!({"a.png": {"sha256": sha, "size": 7, "content_type": "image/png"}, "legacy": "x"})).await.0, 201);
    assert_eq!(v(json!({})).await.0, 201);
}

/// Opens /play and returns the socket once the `_welcome` frame has been read; Err = handshake status.
async fn play(addr: Addr, game: &str, lobby: &str, token: &str) -> Result<TcpStream, u16> {
    let mut s = TcpStream::connect(addr).await.unwrap();
    let req = format!(
        "GET /play/{game}?token={token}&lobby={lobby} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
    );
    s.write_all(req.as_bytes()).await.unwrap();
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        head.push(s.read_u8().await.unwrap());
    }
    let status: u16 = String::from_utf8_lossy(&head).split_whitespace().nth(1).unwrap().parse().unwrap();
    if status != 101 {
        return Err(status);
    }
    let _b0 = s.read_u8().await.unwrap();
    let len = match s.read_u8().await.unwrap() & 0x7f {
        126 => s.read_u16().await.unwrap() as usize,
        n => n as usize,
    };
    let mut payload = vec![0u8; len];
    s.read_exact(&mut payload).await.unwrap();
    Ok(s)
}

/// True when the server ends this socket (EOF, possibly after a few frames) within 3 s.
async fn ends(mut s: TcpStream) -> bool {
    let mut sink = Vec::new();
    tokio::time::timeout(std::time::Duration::from_secs(3), s.read_to_end(&mut sink)).await.is_ok()
}

#[tokio::test]
async fn instances_list_close_kick_and_limits() {
    let addr = serve().await;
    let dev = developer(addr).await;
    let (a, b) = (player(addr, "inst-a").await, player(addr, "inst-b").await);
    let gid = "123e4567-e89b-12d3-a456-4266141740b1";
    let s_a = play(addr, gid, "KICK1", &a).await.unwrap();
    let s_b = play(addr, gid, "KICK1", &b).await.unwrap();
    let d = player(addr, "inst-d").await;
    let s_c = play(addr, gid, "CLOSE1", &d).await.unwrap();

    // Developer only.
    assert_eq!(call(addr, "GET", "/api/instances", None, None).await.0, 401);
    assert_eq!(call(addr, "GET", "/api/instances", Some(&a), None).await.0, 403);
    assert_eq!(call(addr, "DELETE", &format!("/api/instances/{gid}/KICK1"), Some(&a), None).await.0, 403);
    assert_eq!(call(addr, "DELETE", &format!("/api/instances/{gid}/KICK1/players/x"), Some(&a), None).await.0, 403);

    let (st, list) = call(addr, "GET", "/api/instances", Some(&dev), None).await;
    assert_eq!(st, 200, "{list}");
    let mine: Vec<&Value> = list.as_array().unwrap().iter().filter(|i| i["game_id"] == gid).collect();
    assert_eq!(mine.len(), 2, "{list}");
    let kick1 = mine.iter().find(|i| i["lobby"] == "KICK1").unwrap();
    assert_eq!(kick1["players"].as_array().unwrap().len(), 2);
    assert!(kick1["players"].as_array().unwrap().iter().any(|p| p["name"] == "inst-a" && p["id"].is_string()));
    assert!(kick1["started_at"].as_str().unwrap().ends_with('Z') && kick1["last_activity_at"].as_str().unwrap().ends_with('Z'));
    assert!(kick1.get("title").is_none() && kick1["version"].is_null());

    // Limits: players per instance 409, instances 503, a reconnect is still let in.
    let total = list.as_array().unwrap().len();
    std::env::set_var("PEAR_MAX_PLAYERS_PER_INSTANCE", "2");
    std::env::set_var("PEAR_MAX_INSTANCES", total.to_string());
    let third = player(addr, "inst-c").await;
    assert_eq!(play(addr, gid, "KICK1", &third).await.err(), Some(409));
    assert_eq!(play(addr, gid, "NEWL1", &third).await.err(), Some(503));
    let s_a2 = play(addr, gid, "KICK1", &a).await.unwrap();
    std::env::remove_var("PEAR_MAX_PLAYERS_PER_INSTANCE");
    std::env::remove_var("PEAR_MAX_INSTANCES");
    assert!(ends(s_a).await, "the replaced connection ends");

    // Kick one player: only that socket ends.
    let a_id = call(addr, "GET", "/api/accounts/me", Some(&a), None).await.1["id"].as_str().unwrap().to_string();
    assert_eq!(call(addr, "DELETE", &format!("/api/instances/{gid}/KICK1/players/nobody"), Some(&dev), None).await.0, 404);
    assert_eq!(call(addr, "DELETE", &format!("/api/instances/{gid}/KICK1/players/{a_id}"), Some(&dev), None).await.0, 204);
    assert!(ends(s_a2).await);
    assert_eq!(call(addr, "DELETE", &format!("/api/instances/{gid}/KICK1/players/{a_id}"), Some(&dev), None).await.0, 404);

    // Close the lobby: the remaining player's socket ends and the session is gone.
    assert_eq!(call(addr, "DELETE", &format!("/api/instances/{gid}/KICK1"), Some(&dev), None).await.0, 204);
    assert!(ends(s_b).await);
    assert_eq!(call(addr, "DELETE", &format!("/api/instances/{gid}/KICK1"), Some(&dev), None).await.0, 404);
    assert_eq!(call(addr, "DELETE", &format!("/api/instances/{gid}/no"), Some(&dev), None).await.0, 400);
    let (_, list) = call(addr, "GET", "/api/instances", Some(&dev), None).await;
    assert!(!list.as_array().unwrap().iter().any(|i| i["game_id"] == gid && i["lobby"] == "KICK1"));
    drop(s_c);
}

#[tokio::test]
async fn ghost_kick_needs_owner_or_developer_and_a_silent_player() {
    let addr = serve().await;
    let dev = developer(addr).await;
    let a = player(addr, "ghost-a").await;
    let gid = "123e4567-e89b-12d3-a456-4266141740b2";
    let s_a = play(addr, gid, "GHOST1", &a).await.unwrap();
    let a_id = call(addr, "GET", "/api/accounts/me", Some(&a), None).await.1["id"].as_str().unwrap().to_string();
    let path = format!("/api/instances/{gid}/GHOST1/ghosts/{a_id}");

    assert_eq!(call(addr, "DELETE", &path, None, None).await.0, 401);
    // a plain player who does not own the game is refused (no db in this harness: 503, with one: 403/404)
    assert!(matches!(call(addr, "DELETE", &path, Some(&a), None).await.0, 403 | 404 | 503));
    // a live player is refused, an unknown one is 404
    assert_eq!(call(addr, "DELETE", &path, Some(&dev), None).await.0, 409);
    assert_eq!(call(addr, "DELETE", &format!("/api/instances/{gid}/GHOST1/ghosts/nobody"), Some(&dev), None).await.0, 404);
    assert_eq!(call(addr, "DELETE", &format!("/api/instances/{gid}/no/ghosts/x"), Some(&dev), None).await.0, 400);

    // silent past PEAR_GHOST_SECS: kicked, socket ends
    std::env::set_var("PEAR_GHOST_SECS", "1");
    tokio::time::sleep(std::time::Duration::from_millis(1300)).await;
    let st = call(addr, "DELETE", &path, Some(&dev), None).await.0;
    std::env::remove_var("PEAR_GHOST_SECS");
    assert_eq!(st, 204);
    assert!(ends(s_a).await);
    assert_eq!(call(addr, "DELETE", &path, Some(&dev), None).await.0, 404);
}
