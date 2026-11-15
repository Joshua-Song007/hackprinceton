// Profile settings against the in-memory store: rename and profile pictures.
use pear_backend::app_with_studio;
use pear_backend::db::Db;
use pear_backend::memstore::MemStore;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

type Addr = std::net::SocketAddr;

/// One request over a raw socket with an arbitrary body; returns (status, content-type header, body bytes).
async fn raw(addr: Addr, method: &str, path: &str, token: Option<&str>, ctype: &str, body: &[u8]) -> (u16, String, Vec<u8>) {
    let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: x\r\n{auth}Content-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
    s.write_all(head.as_bytes()).await.unwrap();
    // The server may answer 413 and close before reading a large body; that is the result under test.
    let _ = s.write_all(body).await;
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf).await;
    let split = buf.windows(4).position(|w| w == b"\r\n\r\n").expect("response head");
    let head = String::from_utf8_lossy(&buf[..split]).to_string();
    let status = head.split_whitespace().nth(1).and_then(|c| c.parse().ok()).expect("status");
    let ct = head
        .lines()
        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-type:").map(|v| v.trim().to_string()))
        .unwrap_or_default();
    (status, ct, buf[split + 4..].to_vec())
}

async fn json_call(addr: Addr, method: &str, path: &str, token: Option<&str>, body: Option<&Value>) -> (u16, Value) {
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let (st, _, bytes) = raw(addr, method, path, token, "application/json", payload.as_bytes()).await;
    (st, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn sign_in(addr: Addr, name: &str) -> (String, String) {
    let (st, body) = json_call(
        addr,
        "POST",
        "/api/accounts/signin",
        None,
        Some(&json!({"provider": "test", "subject": name, "display_name": name})),
    )
    .await;
    assert_eq!(st, 200, "{body}");
    (body["token"].as_str().unwrap().into(), body["account"]["id"].as_str().unwrap().into())
}

async fn serve() -> Addr {
    std::env::set_var("PEAR_DEV_SIGNIN", "1");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app_with_studio(Some(Db::Mem(MemStore::default())), None);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    addr
}

const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4];
const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 1, 2, 3];

#[tokio::test]
async fn rename_shows_in_me_and_to_friends_and_rejects_bad_names() {
    let addr = serve().await;
    let (a, a_id) = sign_in(addr, "old-name").await;
    let (b, _) = sign_in(addr, "pal").await;
    // befriend: b requests a by code, a accepts
    let (_, me) = json_call(addr, "GET", "/api/accounts/me", Some(&a), None).await;
    json_call(addr, "POST", "/api/friends", Some(&b), Some(&json!({"code": me["friend_code"]}))).await;
    let (_, b_me) = json_call(addr, "GET", "/api/accounts/me", Some(&b), None).await;
    let b_id = b_me["id"].as_str().unwrap().to_string();
    assert_eq!(json_call(addr, "POST", &format!("/api/friends/{b_id}/accept"), Some(&a), None).await.0, 204);

    let (st, r) = json_call(addr, "PUT", "/api/accounts/me", Some(&a), Some(&json!({"display_name": "  New Name "}))).await;
    assert_eq!((st, &r["display_name"], &r["friend_code"]), (200, &json!("New Name"), &me["friend_code"]), "{r}");
    let (_, again) = json_call(addr, "GET", "/api/accounts/me", Some(&a), None).await;
    assert_eq!(again["display_name"], "New Name", "the cached session must follow the rename");
    let (_, list) = json_call(addr, "GET", "/api/friends", Some(&b), None).await;
    assert_eq!((&list[0]["id"], &list[0]["name"]), (&json!(a_id), &json!("New Name")));

    for bad in [json!({"display_name": "   "}), json!({"display_name": "x".repeat(257)})] {
        assert_eq!(json_call(addr, "PUT", "/api/accounts/me", Some(&a), Some(&bad)).await.0, 400);
    }
    assert_eq!(json_call(addr, "PUT", "/api/accounts/me", None, Some(&json!({"display_name": "x"}))).await.0, 401);
}

#[tokio::test]
async fn avatar_round_trip_replace_remove() {
    let addr = serve().await;
    let (a, id) = sign_in(addr, "pic").await;
    let url = format!("/api/avatars/{id}");
    assert_eq!(raw(addr, "GET", &url, None, "x", b"").await.0, 404, "none yet");

    assert_eq!(raw(addr, "PUT", "/api/accounts/me/avatar", Some(&a), "image/jpeg", JPEG).await.0, 204);
    let (st, ct, body) = raw(addr, "GET", &url, None, "x", b"").await;
    assert_eq!((st, ct.as_str(), body.as_slice()), (200, "image/jpeg", JPEG), "public GET, same bytes");

    assert_eq!(raw(addr, "PUT", "/api/accounts/me/avatar", Some(&a), "image/png", PNG).await.0, 204);
    let (_, ct, body) = raw(addr, "GET", &url, None, "x", b"").await;
    assert_eq!((ct.as_str(), body.as_slice()), ("image/png", PNG), "replaced");

    assert_eq!(raw(addr, "DELETE", "/api/accounts/me/avatar", Some(&a), "x", b"").await.0, 204);
    assert_eq!(raw(addr, "GET", &url, None, "x", b"").await.0, 404, "removed");
}

#[tokio::test]
async fn avatar_rejects_bad_uploads_and_unknown_ids() {
    let addr = serve().await;
    let (a, id) = sign_in(addr, "bad").await;
    let put = |ct: &'static str, body: Vec<u8>, tok: Option<String>| async move {
        raw(addr, "PUT", "/api/accounts/me/avatar", tok.as_deref(), ct, &body).await.0
    };
    assert_eq!(put("image/jpeg", JPEG.to_vec(), None).await, 401);
    assert_eq!(put("image/jpeg", b"not an image".to_vec(), Some(a.clone())).await, 415, "bytes are not a jpeg");
    assert_eq!(put("image/jpeg", PNG.to_vec(), Some(a.clone())).await, 415, "declared type must match the bytes");
    assert_eq!(put("text/plain", JPEG.to_vec(), Some(a.clone())).await, 415);
    let mut big = JPEG.to_vec();
    big.resize(512 * 1024 + 1, 0);
    assert_eq!(put("image/jpeg", big, Some(a.clone())).await, 413);
    assert_eq!(raw(addr, "GET", &format!("/api/avatars/{id}"), None, "x", b"").await.0, 404, "nothing was stored");
    assert_eq!(raw(addr, "GET", "/api/avatars/not-a-uuid", None, "x", b"").await.0, 404);
    assert_eq!(raw(addr, "GET", "/api/avatars/..%2Fsecret", None, "x", b"").await.0, 404);
}
