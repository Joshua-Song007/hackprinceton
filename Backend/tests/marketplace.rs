// Plugin registry against the in-memory store with a temp seed dir (what the server uses when DATABASE_URL is unset).
use omni_backend::api::marketplace::seed;
use omni_backend::app_with_studio;
use omni_backend::db::Db;
use omni_backend::memstore::MemStore;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// One request over a raw socket; returns (status code, JSON body or Null).
async fn call(addr: std::net::SocketAddr, method: &str, path: &str) -> (u16, Value) {
    let raw = format!("{method} {path} HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
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

fn write(root: &std::path::Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, bytes).unwrap();
}

#[tokio::test]
async fn seeded_plugin_is_listed_bundled_without_skipped_files_and_counts_installs() {
    let seed_dir = std::env::temp_dir().join(format!("omni-plugin-seed-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&seed_dir);
    let plugin = seed_dir.join("langchain-deepagents");
    let manifest = json!({"id": "langchain-deepagents", "name": "Deep Agents", "version": "0.1.0",
        "author": "Omni", "category": "agents", "description": "Agent panel"});
    write(&plugin, "omni-plugin.json", manifest.to_string().as_bytes());
    write(&plugin, "src/main.py", b"print('hi')");
    write(&plugin, ".venv/lib/site.py", b"skipped");
    write(&plugin, "src/__pycache__/main.pyc.txt", b"skipped");
    write(&plugin, "node_modules/x/index.js", b"skipped");
    write(&plugin, "binary.bin", &[0xff, 0xfe, 0x00]);
    write(&plugin, "big.txt", &vec![b'a'; 1024 * 1024 + 1]);
    write(&plugin, "uv.lock", &vec![b'a'; 400 * 1024]);
    write(&seed_dir.join("not-a-plugin"), "readme.txt", b"no manifest, no row");

    let db = Db::Mem(MemStore::default());
    seed(&db, &seed_dir).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app_with_studio(Some(db.clone()), None);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let (st, list) = call(addr, "GET", "/api/plugins").await;
    assert_eq!(st, 200, "{list}");
    assert_eq!(list.as_array().unwrap().len(), 1, "{list}");
    assert_eq!(list[0]["id"], "langchain-deepagents");
    assert_eq!(list[0]["name"], "Deep Agents");
    assert_eq!(list[0]["installs"], 0);

    let (st, got) = call(addr, "GET", "/api/plugins/langchain-deepagents").await;
    assert_eq!((st, &got), (200, &manifest));

    let (st, bundle) = call(addr, "GET", "/api/plugins/langchain-deepagents/bundle").await;
    assert_eq!(st, 200, "{bundle}");
    assert_eq!(bundle["manifest"], manifest);
    let files = bundle["files"].as_object().unwrap();
    let mut names: Vec<&str> = files.keys().map(String::as_str).collect();
    names.sort();
    assert_eq!(names, ["omni-plugin.json", "src/main.py", "uv.lock"], "{bundle}");
    assert_eq!(files["src/main.py"], "print('hi')");

    let (st, n) = call(addr, "POST", "/api/plugins/langchain-deepagents/installs").await;
    assert_eq!((st, &n["installs"]), (200, &json!(1)), "{n}");
    let (_, n) = call(addr, "POST", "/api/plugins/langchain-deepagents/installs").await;
    assert_eq!(n["installs"], 2);

    // Re-seeding updates content but keeps the install count.
    seed(&db, &seed_dir).await;
    let (_, list) = call(addr, "GET", "/api/plugins").await;
    assert_eq!(list[0]["installs"], 2, "{list}");

    for (method, path) in [
        ("GET", "/api/plugins/nope"),
        ("GET", "/api/plugins/nope/bundle"),
        ("POST", "/api/plugins/nope/installs"),
    ] {
        let (st, body) = call(addr, method, path).await;
        assert_eq!(st, 404, "{method} {path}: {body}");
        assert!(body["error"].is_string(), "{body}");
    }
    let _ = std::fs::remove_dir_all(&seed_dir);
}
