// Integration tests for live hosting: a published server script runs behind /play (token in the query),
// /debug (owner only) streams what happens, and publishing a newer version reloads the live session.
// Tests that need TigerData read DATABASE_URL and return early when it is unset, like tests/api.rs.
use std::time::Duration;

use omni_backend::{app, db};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const WAIT: Duration = Duration::from_secs(5);

async fn serve(pool: Option<sqlx::postgres::PgPool>) -> std::net::SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app(pool);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    addr
}

/// One HTTP request over a raw socket; returns (status code, JSON body or Null).
async fn call(addr: std::net::SocketAddr, method: &str, path: &str, token: Option<&str>, body: Option<&Value>) -> (u16, Value) {
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

/// Minimal WebSocket client (no client crate is a dependency): text frames only.
struct Ws(TcpStream);

/// Opens a WebSocket; `Err(status)` when the server answers the handshake with anything but 101.
async fn ws_connect(addr: std::net::SocketAddr, path: &str) -> Result<Ws, u16> {
    let mut s = TcpStream::connect(addr).await.unwrap();
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
    );
    s.write_all(req.as_bytes()).await.unwrap();
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        head.push(s.read_u8().await.expect("handshake response"));
    }
    let head = String::from_utf8_lossy(&head);
    let status: u16 = head.split_whitespace().nth(1).and_then(|c| c.parse().ok()).expect("status");
    if status == 101 {
        Ok(Ws(s))
    } else {
        Err(status)
    }
}

impl Ws {
    async fn send(&mut self, text: &str) {
        let payload = text.as_bytes();
        assert!(payload.len() < 126, "test frames are short");
        let key = [1u8, 2, 3, 4];
        let mut frame = vec![0x81, 0x80 | payload.len() as u8];
        frame.extend_from_slice(&key);
        frame.extend(payload.iter().enumerate().map(|(i, b)| b ^ key[i % 4]));
        self.0.write_all(&frame).await.unwrap();
    }

    /// Next text frame as JSON; panics after WAIT with no frame.
    async fn recv(&mut self) -> Value {
        tokio::time::timeout(WAIT, async {
            loop {
                let b0 = self.0.read_u8().await.expect("frame header");
                let len = match self.0.read_u8().await.unwrap() & 0x7f {
                    126 => self.0.read_u16().await.unwrap() as usize,
                    127 => self.0.read_u64().await.unwrap() as usize,
                    n => n as usize,
                };
                let mut payload = vec![0u8; len];
                self.0.read_exact(&mut payload).await.unwrap();
                match b0 & 0x0f {
                    1 => return serde_json::from_slice(&payload).expect("json frame"),
                    8 => panic!("socket closed by server"),
                    _ => {} // ping / pong / other
                }
            }
        })
        .await
        .expect("timed out waiting for a frame")
    }

    /// Reads frames until one has this `kind`; returns it.
    async fn recv_kind(&mut self, kind: &str) -> Value {
        for _ in 0..50 {
            let v = self.recv().await;
            if v["kind"] == kind {
                return v;
            }
        }
        panic!("no {kind} frame");
    }
}

fn unique(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{prefix}-{nanos}")
}

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

fn version(server_script: &str) -> Value {
    json!({
        "scene": {},
        "client_scripts": {},
        "server_scripts": {"game.js": server_script},
        "assets": {},
        "metadata": {},
        "run_mode": "screen"
    })
}

fn script(bump: u32) -> String {
    format!(
        r#"export default serverScript({{
          onPlayerJoin(ctx, player) {{ ctx.state.joined = (ctx.state.joined || 0) + 1; console.log("joined " + player.id); }},
          onRemote(ctx, player, name, data) {{ if (name === "ping") ctx.remote.fire(player.id, "pong", {{ n: data.n + {bump} }}); }},
        }});"#
    )
}

async fn pool_or_skip() -> Option<sqlx::postgres::PgPool> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect_lazy(&url).expect("DATABASE_URL invalid");
    db::migrate(&pool).await.expect("migrate");
    // Only this test binary touches the variable; the dev sign-in route is gated on it.
    std::env::set_var("OMNI_DEV_SIGNIN", "1");
    Some(pool)
}

#[tokio::test]
async fn debug_and_play_require_a_token() {
    let addr = serve(None).await;
    let gid = "123e4567-e89b-12d3-a456-426614174000";
    assert_eq!(ws_connect(addr, &format!("/debug/{gid}")).await.err(), Some(401));
    assert_eq!(ws_connect(addr, &format!("/play/{gid}")).await.err(), Some(401));
    assert_eq!(ws_connect(addr, &format!("/play/{gid}?token=nope")).await.err(), Some(401));
}

#[tokio::test]
async fn published_script_runs_live_and_debug_sees_it() {
    let Some(pool) = pool_or_skip().await else {
        return;
    };
    let addr = serve(Some(pool)).await;
    let owner = sign_in(addr, "owner").await;
    let other = sign_in(addr, "intruder").await;

    let (st, game) = call(addr, "POST", "/api/games", Some(&owner), Some(&json!({"title": "Live"}))).await;
    assert_eq!(st, 201, "{game}");
    let gid = game["id"].as_str().expect("game id").to_string();
    let (st, v1) = call(addr, "POST", &format!("/api/games/{gid}/versions"), Some(&owner), Some(&version(&script(1)))).await;
    assert_eq!(st, 201, "{v1}");

    // Only the owner may watch the session.
    assert_eq!(ws_connect(addr, &format!("/debug/{gid}?token={other}")).await.err(), Some(403));
    assert_eq!(ws_connect(addr, &format!("/debug/{gid}")).await.err(), Some(401));
    // A version that was never published cannot be played.
    assert_eq!(ws_connect(addr, &format!("/play/{gid}?token={owner}&version=99")).await.err(), Some(404));

    let mut debug = ws_connect(addr, &format!("/debug/{gid}?token={owner}")).await.expect("debug upgrade");
    let snapshot = debug.recv().await;
    assert_eq!(snapshot["kind"], "snapshot");
    assert_eq!(snapshot["players"], json!([]));

    let mut play = ws_connect(addr, &format!("/play/{gid}?token={owner}")).await.expect("play upgrade");
    assert!(debug.recv_kind("join").await["player"].is_string());
    let log = debug.recv_kind("log").await;
    assert!(log["msg"].as_str().unwrap().starts_with("joined "), "{log}");
    assert_eq!(debug.recv_kind("state").await["state"], json!({"joined": 1}));

    play.send(r#"{"name":"ping","data":{"n":1}}"#).await;
    assert_eq!(play.recv().await, json!({"name": "pong", "data": {"n": 2}}));
    let inbound = debug.recv_kind("in").await;
    assert_eq!((inbound["name"].clone(), inbound["data"].clone()), (json!("ping"), json!({"n": 1})));
    assert_eq!(debug.recv_kind("out").await["name"], "pong");

    // Publishing a newer version restarts the live session's host.
    let (st, v2) = call(addr, "POST", &format!("/api/games/{gid}/versions"), Some(&owner), Some(&version(&script(100)))).await;
    assert_eq!(st, 201, "{v2}");
    assert_eq!(play.recv().await, json!({"name": "_reload", "data": {"version": 2}}));
    assert_eq!(debug.recv_kind("reload").await["version"], 2);
    play.send(r#"{"name":"ping","data":{"n":1}}"#).await;
    assert_eq!(play.recv().await, json!({"name": "pong", "data": {"n": 101}}));

    // A late debug connection gets the current picture in its snapshot.
    let mut late = ws_connect(addr, &format!("/debug/{gid}?token={owner}")).await.expect("debug upgrade");
    let snap = late.recv().await;
    assert_eq!(snap["version"], 2);
    assert_eq!(snap["players"].as_array().unwrap().len(), 1);
    assert_eq!(snap["state"], json!({"joined": 1}));
}
