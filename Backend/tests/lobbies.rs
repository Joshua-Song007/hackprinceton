// Lobbies over /play: ?lobby= picks the session (missing = OPEN, invalid = 400), _welcome carries the
// lobby, and GET /api/games/{id}/lobbies lists live lobbies. In-memory store; no database needed.
use pear_backend::app_with_studio;
use pear_backend::db::Db;
use pear_backend::memstore::MemStore;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

type Addr = std::net::SocketAddr;

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
    let body = buf.split_once("\r\n\r\n").and_then(|(_, b)| serde_json::from_str(b.trim()).ok()).unwrap_or(Value::Null);
    (status, body)
}

async fn sign_in(addr: Addr, name: &str) -> String {
    let (st, body) = call(
        addr,
        "POST",
        "/api/accounts/signin",
        None,
        Some(&json!({"provider": "test", "subject": name, "display_name": name})),
    )
    .await;
    assert_eq!(st, 200, "{body}");
    body["token"].as_str().unwrap().to_string()
}

/// Opens /play with the given query; Ok = (socket, the `_welcome` frame's data), Err = handshake status.
async fn play(addr: Addr, game: &str, query: &str, token: &str) -> Result<(TcpStream, Value), u16> {
    let mut s = TcpStream::connect(addr).await.unwrap();
    let req = format!(
        "GET /play/{game}?token={token}{query} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
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
    let frame: Value = serde_json::from_slice(&payload).unwrap();
    assert_eq!(frame["name"], "_welcome");
    Ok((s, frame["data"].clone()))
}

#[tokio::test]
async fn lobby_param_selects_the_session_and_is_listed() {
    let addr = serve().await;
    let (a, b) = (sign_in(addr, "lobby-a").await, sign_in(addr, "lobby-b").await);
    let gid = "123e4567-e89b-12d3-a456-4266141740a1";

    let (_s1, w1) = play(addr, gid, "&lobby=ab12c", &a).await.unwrap();
    assert_eq!(w1["lobby"], "AB12C");
    let (_s2, w2) = play(addr, gid, "", &b).await.unwrap();
    assert_eq!(w2["lobby"], "OPEN");

    let (st, list) = call(addr, "GET", &format!("/api/games/{gid}/lobbies"), Some(&a), None).await;
    assert_eq!(st, 200, "{list}");
    let list = list.as_array().unwrap();
    assert_eq!(list.len(), 2);
    let ab = list.iter().find(|l| l["code"] == "AB12C").unwrap();
    assert_eq!(ab["players"].as_array().unwrap().len(), 1);
    assert_eq!(ab["players"][0]["name"], "lobby-a");
    assert!(list.iter().any(|l| l["code"] == "OPEN"));

    assert_eq!(call(addr, "GET", &format!("/api/games/{gid}/lobbies"), None, None).await.0, 401);
}

#[tokio::test]
async fn invalid_lobby_is_400() {
    let addr = serve().await;
    let a = sign_in(addr, "lobby-c").await;
    let gid = "123e4567-e89b-12d3-a456-4266141740a2";
    for q in ["&lobby=abc", "&lobby=abcdefghi", "&lobby=ab-12", "&lobby="] {
        assert_eq!(play(addr, gid, q, &a).await.err(), Some(400), "{q}");
    }
}
