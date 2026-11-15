// Self-service signup and the dev sign-in prefix, against the in-memory store. One test function on
// purpose: it sets PEAR_DEV_SIGNIN*, and std::env::set_var must not race another test.
use pear_backend::app_with_studio;
use pear_backend::db::Db;
use pear_backend::memstore::MemStore;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn call(addr: std::net::SocketAddr, path: &str, token: Option<&str>, body: Value) -> (u16, Value) {
    call_with(addr, "POST", path, token, Some(body)).await
}

async fn call_with(addr: std::net::SocketAddr, method: &str, path: &str, token: Option<&str>, body: Option<Value>) -> (u16, Value) {
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: x\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
    s.write_all(head.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf).await;
    let split = buf.windows(4).position(|w| w == b"\r\n\r\n").expect("response head");
    let head = String::from_utf8_lossy(&buf[..split]).to_string();
    let status = head.split_whitespace().nth(1).and_then(|c| c.parse().ok()).expect("status");
    (status, serde_json::from_slice(&buf[split + 4..]).unwrap_or(Value::Null))
}

#[tokio::test]
async fn signup_signin_and_dev_prefix() {
    std::env::remove_var("PEAR_DEV_SIGNIN");
    std::env::remove_var("PEAR_DEV_SIGNIN_PREFIX");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app_with_studio(Some(Db::Mem(MemStore::default())), None);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    // Signup works with the passwordless path off, returns the signin body, role player.
    let (st, b) = call(addr, "/api/accounts/signup", None, json!({"username": "ann_b-2", "password": "ten chars!!", "display_name": "Ann"})).await;
    assert_eq!(st, 200, "{b}");
    assert_eq!((b["account"]["role"].clone(), b["account"]["display_name"].clone()), (json!("player"), json!("Ann")));
    assert!(!b.to_string().contains("argon2") && b["account"].get("password_hash").is_none());
    let (st, me) = call_with(addr, "GET", "/api/accounts/me", b["token"].as_str(), None).await;
    assert_eq!((st, me["subject"].clone()), (200, json!("ann_b-2")));

    // Duplicate: 409. Weak password and bad usernames: 400.
    assert_eq!(call(addr, "/api/accounts/signup", None, json!({"username": "ann_b-2", "password": "another long one"})).await.0, 409);
    assert_eq!(call(addr, "/api/accounts/signup", None, json!({"username": "bob", "password": "short"})).await.0, 400);
    for u in ["ab", "Bob", "bob.x", &"a".repeat(33)] {
        assert_eq!(call(addr, "/api/accounts/signup", None, json!({"username": u, "password": "ten chars!!"})).await.0, 400, "{u}");
    }

    // Sign-in via provider "password": right password 200, wrong and unknown identical delayed 401.
    let signin = |u: &'static str, p: &'static str| call(addr, "/api/accounts/signin", None, json!({"provider": "password", "subject": u, "password": p}));
    let (st, b) = signin("ann_b-2", "ten chars!!").await;
    assert_eq!((st, b["account"]["role"].clone()), (200, json!("player")));
    let t = std::time::Instant::now();
    let wrong = signin("ann_b-2", "not the password").await;
    let unknown = signin("nobody", "not the password").await;
    assert!(t.elapsed() >= std::time::Duration::from_millis(780), "{:?}", t.elapsed());
    assert_eq!((wrong.0, unknown.0), (401, 401));
    assert_eq!(wrong.1, unknown.1);
    // A password account is not reachable as "developer", nor a signup username via the dev path.
    let dev = call(addr, "/api/accounts/signin", None, json!({"provider": "developer", "subject": "ann_b-2", "password": "ten chars!!"})).await;
    assert_eq!(dev.0, 401);

    // Dev path: off without the flag; with it, the subject must start with the prefix (default "sim-").
    let dev = |s: &'static str| call(addr, "/api/accounts/signin", None, json!({"provider": "dev", "subject": s, "display_name": "x"}));
    assert_eq!(dev("sim-a").await.0, 403);
    std::env::set_var("PEAR_DEV_SIGNIN", "1");
    assert_eq!(dev("sim-a").await.0, 200);
    assert_eq!(dev("alice").await.0, 403);
    std::env::set_var("PEAR_DEV_SIGNIN_PREFIX", "bot-");
    assert_eq!((dev("bot-1").await.0, dev("sim-a").await.0), (200, 403));
    std::env::remove_var("PEAR_DEV_SIGNIN");
    std::env::remove_var("PEAR_DEV_SIGNIN_PREFIX");
}
