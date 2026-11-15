// Friends against the in-memory store: request by code, accept, decline / cancel / remove, and the
// "playing" field, which follows a live /play socket (ws handshake only; no frames are needed).
use std::time::Duration;

use pear_backend::app_with_studio;
use pear_backend::db::Db;
use pear_backend::memstore::MemStore;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

type Addr = std::net::SocketAddr;

async fn call(addr: Addr, method: &str, path: &str, token: Option<&str>, body: Option<&Value>) -> (u16, Value) {
    let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let raw = format!(
        "{method} {path} HTTP/1.1\r\nHost: x\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    let mut s = TcpStream::connect(addr).await.unwrap();
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

struct User {
    token: String,
    id: String,
    code: String,
}

async fn sign_in(addr: Addr, name: &str) -> User {
    let (st, body) = call(
        addr,
        "POST",
        "/api/accounts/signin",
        None,
        Some(&json!({"provider": "dev", "subject": name, "display_name": name})),
    )
    .await;
    assert_eq!(st, 200, "signin: {body}");
    let token = body["token"].as_str().unwrap().to_string();
    let (st, me) = call(addr, "GET", "/api/accounts/me", Some(&token), None).await;
    assert_eq!(st, 200, "{me}");
    User { token, id: me["id"].as_str().unwrap().into(), code: me["friend_code"].as_str().unwrap().into() }
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

async fn request(addr: Addr, from: &User, to: &User) -> (u16, Value) {
    call(addr, "POST", "/api/friends", Some(&from.token), Some(&json!({"code": to.code}))).await
}

async fn friends(addr: Addr, u: &User) -> Value {
    let (st, v) = call(addr, "GET", "/api/friends", Some(&u.token), None).await;
    assert_eq!(st, 200, "{v}");
    v
}

async fn requests(addr: Addr, u: &User) -> Value {
    let (st, v) = call(addr, "GET", "/api/friends/requests", Some(&u.token), None).await;
    assert_eq!(st, 200, "{v}");
    v
}

async fn befriend(addr: Addr, a: &User, b: &User) {
    request(addr, a, b).await;
    let (st, _) = call(addr, "POST", &format!("/api/friends/{}/accept", a.id), Some(&b.token), None).await;
    assert_eq!(st, 204);
}

/// Opens /play/{game} and returns the socket; dropping it ends the connection.
async fn join(addr: Addr, game: &str, u: &User) -> TcpStream {
    let mut s = TcpStream::connect(addr).await.unwrap();
    let req = format!(
        "GET /play/{game}?token={} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
        u.token
    );
    s.write_all(req.as_bytes()).await.unwrap();
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        head.push(s.read_u8().await.expect("handshake response"));
    }
    assert!(String::from_utf8_lossy(&head).contains(" 101 "), "ws upgrade");
    s
}

#[tokio::test]
async fn needs_auth() {
    let addr = serve().await;
    assert_eq!(call(addr, "GET", "/api/friends", None, None).await.0, 401);
    assert_eq!(call(addr, "GET", "/api/friends/requests", None, None).await.0, 401);
    assert_eq!(call(addr, "POST", "/api/friends", None, Some(&json!({"code": "ABCDEF"}))).await.0, 401);
}

#[tokio::test]
async fn request_codes_and_errors() {
    let addr = serve().await;
    let (a, b) = (sign_in(addr, "ann").await, sign_in(addr, "bo").await);
    assert_eq!(request(addr, &a, &a).await.0, 400, "own code");
    let (st, _) = call(addr, "POST", "/api/friends", Some(&a.token), Some(&json!({"code": "zzzzzz"}))).await;
    assert_eq!(st, 404, "not hex");
    let (st, _) = call(addr, "POST", "/api/friends", Some(&a.token), Some(&json!({"code": "123"}))).await;
    assert_eq!(st, 404, "wrong length");
    let (st, r) = request(addr, &a, &b).await;
    assert_eq!((st, &r["status"]), (200, &json!("pending")));
    let (st, r) = request(addr, &a, &b).await;
    assert_eq!((st, &r["status"]), (200, &json!("pending")), "repeat is idempotent");
    assert_eq!(requests(addr, &a).await["outgoing"].as_array().unwrap().len(), 1);
    assert_eq!(requests(addr, &b).await["incoming"][0]["id"], json!(a.id));
    assert_eq!(friends(addr, &a).await, json!([]), "pending is not a friend");
    assert_eq!(friends(addr, &b).await, json!([]));
}

#[tokio::test]
async fn accept_lists_both_sides_and_needs_a_request() {
    let addr = serve().await;
    let (a, b) = (sign_in(addr, "cy").await, sign_in(addr, "di").await);
    let (st, _) = call(addr, "POST", &format!("/api/friends/{}/accept", a.id), Some(&b.token), None).await;
    assert_eq!(st, 404, "nothing to accept");
    request(addr, &a, &b).await;
    let (st, _) = call(addr, "POST", &format!("/api/friends/{}/accept", b.id), Some(&a.token), None).await;
    assert_eq!(st, 404, "the requester cannot accept their own request");
    befriend(addr, &a, &b).await;
    assert_eq!(friends(addr, &a).await[0]["id"], json!(b.id));
    assert_eq!(friends(addr, &b).await[0]["id"], json!(a.id));
    assert_eq!(requests(addr, &b).await, json!({"incoming": [], "outgoing": []}));
    let (st, r) = request(addr, &b, &a).await;
    assert_eq!((st, &r["status"]), (200, &json!("accepted")), "already friends");
}

#[tokio::test]
async fn cross_request_auto_accepts() {
    let addr = serve().await;
    let (a, b) = (sign_in(addr, "ed").await, sign_in(addr, "fy").await);
    request(addr, &a, &b).await;
    let (st, r) = request(addr, &b, &a).await;
    assert_eq!((st, &r["status"]), (200, &json!("accepted")));
    assert_eq!(friends(addr, &a).await.as_array().unwrap().len(), 1);
    assert_eq!(friends(addr, &b).await.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn decline_cancel_and_remove_then_request_again() {
    let addr = serve().await;
    let (a, b) = (sign_in(addr, "gus").await, sign_in(addr, "hal").await);
    // decline (addressee) and cancel (requester) both delete the pending row
    request(addr, &a, &b).await;
    assert_eq!(call(addr, "DELETE", &format!("/api/friends/{}", a.id), Some(&b.token), None).await.0, 204);
    assert_eq!(requests(addr, &a).await["outgoing"], json!([]));
    request(addr, &a, &b).await;
    assert_eq!(call(addr, "DELETE", &format!("/api/friends/{}", b.id), Some(&a.token), None).await.0, 204);
    assert_eq!(requests(addr, &b).await["incoming"], json!([]));
    assert_eq!(call(addr, "DELETE", &format!("/api/friends/{}", b.id), Some(&a.token), None).await.0, 404);
    // removing an accepted friend drops both sides
    befriend(addr, &a, &b).await;
    assert_eq!(call(addr, "DELETE", &format!("/api/friends/{}", a.id), Some(&b.token), None).await.0, 204);
    assert_eq!(friends(addr, &a).await, json!([]));
    assert_eq!(friends(addr, &b).await, json!([]));
    // and a new request between them works again
    let (st, r) = request(addr, &b, &a).await;
    assert_eq!((st, &r["status"]), (200, &json!("pending")));
}

#[tokio::test]
async fn playing_follows_a_live_socket_and_only_for_accepted_friends() {
    let addr = serve().await;
    let (a, b) = (sign_in(addr, "ivy").await, sign_in(addr, "jo").await);
    let (st, game) = call(addr, "POST", "/api/games", Some(&b.token), Some(&json!({"title": "Neon Drift"}))).await;
    assert_eq!(st, 201, "{game}");
    let gid = game["id"].as_str().unwrap().to_string();
    let v = json!({"scene": {}, "client_scripts": {}, "server_scripts": {}, "assets": {}, "metadata": {"title": "Neon Drift", "manifest": {"format": "pear-game/1", "name": "Neon Drift"}, "check": {"ok": true}}, "run_mode": "screen", "listed": true});
    assert_eq!(call(addr, "POST", &format!("/api/games/{gid}/versions"), Some(&b.token), Some(&v)).await.0, 201);

    let sock = join(addr, &gid, &b).await;
    request(addr, &b, &a).await;
    assert_eq!(friends(addr, &a).await, json!([]), "a pending requester is not listed, so not exposed");
    let (st, _) = call(addr, "POST", &format!("/api/friends/{}/accept", b.id), Some(&a.token), None).await;
    assert_eq!(st, 204);
    let playing = friends(addr, &a).await[0]["playing"].clone();
    assert_eq!(playing, json!({"gameId": gid, "title": "Neon Drift", "lobby": "OPEN"}));

    // removing the friend takes the game away from the ex-friend's view
    call(addr, "DELETE", &format!("/api/friends/{}", b.id), Some(&a.token), None).await;
    assert_eq!(friends(addr, &a).await, json!([]));
    befriend(addr, &b, &a).await;

    drop(sock);
    for _ in 0..50 {
        if friends(addr, &a).await[0]["playing"].is_null() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("playing stayed set after the socket closed");
}
