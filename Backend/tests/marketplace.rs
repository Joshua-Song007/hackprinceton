// Marketplace (Phase 10) end to end over HTTP: seed job, signed tarball bundles, authenticated publish
// with review, per-account installs, model keys and the hosted agent proxy. Runs against the in-memory
// store, then against Postgres when DATABASE_URL is set.
// One test fn on purpose: it sets env vars (PEAR_DEV_SIGNIN, reviewers, runtime URL), and set_var must
// not race other test threads.
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use futures_util::{SinkExt, StreamExt};
use pear_backend::api::marketplace::seed;
use pear_backend::app_with_studio;
use pear_backend::bundle::{build_tarball, read_tarball, Files};
use pear_backend::crypto::{secret_box, signed_message};
use pear_backend::db::{self, Db};
use pear_backend::memstore::MemStore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio_tungstenite::tungstenite::Message;

struct Api {
    base: String,
    http: reqwest::Client,
}

impl Api {
    async fn send(&self, method: &str, path: &str, token: Option<&str>, body: Option<Vec<u8>>) -> (u16, Vec<u8>) {
        let mut req = self.http.request(method.parse().unwrap(), format!("{}{path}", self.base));
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        if let Some(b) = body {
            // JSON bodies start with '{'; anything else here is a tarball.
            let ctype = if b.first() == Some(&b'{') { "application/json" } else { "application/gzip" };
            req = req.header("content-type", ctype).body(b);
        }
        let res = req.send().await.unwrap();
        (res.status().as_u16(), res.bytes().await.unwrap().to_vec())
    }

    async fn json(&self, method: &str, path: &str, token: Option<&str>, body: Option<Value>) -> (u16, Value) {
        let (st, b) = self.send(method, path, token, body.map(|b| b.to_string().into_bytes())).await;
        (st, serde_json::from_slice(&b).unwrap_or(Value::Null))
    }

    async fn sign_in(&self, name: &str) -> (String, String) {
        let body = json!({"provider": "dev", "subject": format!("{name}-{}", nonce()), "display_name": name});
        let (st, b) = self
            .send("POST", "/api/accounts/signin", None, Some(body.to_string().into_bytes()))
            .await;
        assert_eq!(st, 200, "{}", String::from_utf8_lossy(&b));
        let v: Value = serde_json::from_slice(&b).unwrap();
        (v["token"].as_str().unwrap().into(), v["account"]["id"].as_str().unwrap().into())
    }
}

fn nonce() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
}

fn plugin_files(id: &str, version: &str, extra: &str) -> Files {
    let manifest = json!({"id": id, "name": "Tool", "version": version, "author": "A", "category": "agents", "description": extra});
    [("pear-plugin.json".to_string(), manifest.to_string().into_bytes()), ("main.py".to_string(), extra.as_bytes().to_vec())]
        .into_iter()
        .collect()
}

async fn serve(db: Db) -> Api {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = app_with_studio(Some(db), None);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Api { base: format!("http://{addr}"), http: reqwest::Client::new() }
}

/// A stand-in runtime: records each connection's request headers and echoes text frames.
async fn fake_runtime() -> (String, tokio::sync::mpsc::UnboundedReceiver<Vec<(String, String)>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let tx = tx.clone();
            tokio::spawn(async move {
                let cb = |req: &tokio_tungstenite::tungstenite::handshake::server::Request, res| {
                    let h = req.headers().iter().map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string())).collect();
                    let _ = tx.send(h);
                    Ok(res)
                };
                let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(stream, cb).await else { return };
                while let Some(Ok(Message::Text(t))) = ws.next().await {
                    let _ = ws.send(Message::Text(format!("echo:{t}").into())).await;
                }
            });
        }
    });
    (format!("ws://{addr}/ws"), rx)
}

async fn scenario(db: Db) {
    let api = serve(db.clone()).await;
    let n = nonce();

    // 10.1 seed job: one plugin dir (with uv.lock-sized file, a dotfile and a skipped .venv); a second run changes nothing.
    let seeded = format!("seeded-{n}");
    let seed_dir = std::env::temp_dir().join(format!("pear-seed-{n}"));
    let pdir = seed_dir.join(&seeded);
    for (rel, data) in [
        ("pear-plugin.json", json!({"id": seeded, "name": "Seeded", "version": "0.1.0", "author": "Pear", "category": "agents", "description": "d"}).to_string().into_bytes()),
        ("uv.lock", vec![b'l'; 500 * 1024]),
        (".python-version", b"3.12\n".to_vec()),
        (".venv/lib/x.py", b"skip".to_vec()),
    ] {
        let p = pdir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, data).unwrap();
    }
    std::fs::create_dir_all(seed_dir.join("bad-plugin")).unwrap();
    std::fs::write(seed_dir.join("bad-plugin/pear-plugin.json"), json!({"id": "Bad_Id", "version": "1.0.0"}).to_string()).unwrap();
    assert_eq!(seed(&db, &seed_dir).await, (1, 0, 1));
    let before = db::latest_plugin_version(&db, &seeded, false).await.unwrap().unwrap();
    assert_eq!(seed(&db, &seed_dir).await, (0, 1, 1));
    assert_eq!(db::latest_plugin_version(&db, &seeded, false).await.unwrap().unwrap(), before);
    let _ = std::fs::remove_dir_all(&seed_dir);

    let (st, list) = api.json("GET", "/api/plugins", None, None).await;
    assert_eq!(st, 200);
    let row = list.as_array().unwrap().iter().find(|p| p["id"] == seeded.as_str()).unwrap_or_else(|| panic!("{list}"));
    assert_eq!((row["version"].as_str(), row["installs"].as_i64()), (Some("0.1.0"), Some(0)));

    // 10.2 release metadata + tarball: hash matches, signature verifies under the published key, files intact.
    let (_, rel) = api.json("GET", &format!("/api/plugins/{seeded}"), None, None).await;
    let (_, key) = api.json("GET", "/api/plugin-signing-key", None, None).await;
    let (st, tarball) = api.send("GET", &format!("/api/plugins/{seeded}/bundle"), None, None).await;
    assert_eq!(st, 200);
    let sha = hex::encode(Sha256::digest(&tarball));
    assert_eq!(rel["sha256"].as_str(), Some(sha.as_str()));
    let vk = VerifyingKey::from_bytes(&hex::decode(key["publicKey"].as_str().unwrap()).unwrap().try_into().unwrap()).unwrap();
    let sig = Signature::from_bytes(&hex::decode(rel["signature"].as_str().unwrap()).unwrap().try_into().unwrap());
    assert!(vk.verify(signed_message(&seeded, "0.1.0", &sha).as_bytes(), &sig).is_ok());
    let files = read_tarball(&tarball).unwrap();
    assert_eq!(files.keys().map(String::as_str).collect::<Vec<_>>(), [".python-version", "pear-plugin.json", "uv.lock"]);
    assert_eq!(files["uv.lock"].len(), 500 * 1024);

    // 10.4 installs per account: reinstall counts once, uninstall lowers the count; 10.5 /api/me/plugins.
    let (alice, alice_id) = api.sign_in("alice").await;
    let (bob, bob_id) = api.sign_in("bob").await;
    let inst = format!("/api/plugins/{seeded}/installs");
    assert_eq!(api.json("POST", &inst, None, None).await.0, 401);
    for (tok, method, want) in [(&alice, "POST", 1), (&alice, "POST", 1), (&bob, "POST", 2), (&alice, "DELETE", 1)] {
        let (st, b) = api.json(method, &inst, Some(tok), None).await;
        assert_eq!((st, b["installs"].as_i64()), (200, Some(want)), "{method}");
    }
    let mine = |tok: String| {
        let api = &api;
        async move { api.json("GET", "/api/me/plugins", Some(&tok), None).await.1 }
    };
    assert_eq!(mine(alice.clone()).await, json!([{"id": seeded, "version": "0.1.0", "installed": false}]));
    assert_eq!(mine(bob.clone()).await, json!([{"id": seeded, "version": "0.1.0", "installed": true}]));
    assert_eq!(api.json("GET", "/api/me/plugins", None, None).await.0, 401);

    // 10.3 publish: auth, ownership, increasing versions, unreviewed not listed, review lists it.
    let tool = format!("tool-{n}");
    let up = |tok: Option<String>, files: Files| {
        let api = &api;
        async move { api.send("POST", "/api/plugins", tok.as_deref(), Some(build_tarball(&files))).await.0 }
    };
    assert_eq!(up(None, plugin_files(&tool, "1.0.0", "a")).await, 401);
    assert_eq!(up(Some(alice.clone()), plugin_files(&tool, "1.0.0", "a")).await, 201);
    assert_eq!(up(Some(alice.clone()), plugin_files(&tool, "1.0.0", "a")).await, 409, "same version again");
    assert_eq!(up(Some(alice.clone()), plugin_files(&tool, "1.0.0", "b")).await, 409, "same version, new content");
    assert_eq!(up(Some(alice.clone()), plugin_files(&tool, "0.9.0", "b")).await, 409, "lower version");
    assert_eq!(up(Some(bob.clone()), plugin_files(&tool, "2.0.0", "b")).await, 403, "not the author");
    assert_eq!(up(Some(bob.clone()), plugin_files(&seeded, "9.0.0", "b")).await, 403, "seeded plugin");
    assert_eq!(api.send("POST", "/api/plugins", Some(&alice), Some(b"junk".to_vec())).await.0, 400);
    assert_eq!(up(Some(alice.clone()), plugin_files(&tool, "1.1.0", "c")).await, 201);
    let listed = |id: String| {
        let api = &api;
        async move {
            let (_, list) = api.json("GET", "/api/plugins", None, None).await;
            list.as_array().unwrap().iter().find(|p| p["id"] == id.as_str()).map(|p| p["version"].as_str().unwrap().to_string())
        }
    };
    assert_eq!(listed(tool.clone()).await, None, "pending is not listed");
    assert_eq!(api.json("GET", &format!("/api/plugins/{tool}/bundle"), None, None).await.0, 404);
    let review = |tok: String, v: &str, status: &str| {
        let api = &api;
        let path = format!("/api/plugins/{tool}/versions/{v}/review");
        let body = json!({ "status": status });
        async move { api.json("POST", &path, Some(&tok), Some(body)).await.0 }
    };
    assert_eq!(review(bob.clone(), "1.0.0", "approved").await, 403);
    std::env::set_var("PEAR_PLUGIN_REVIEWERS", format!("someone,{bob_id}"));
    assert_eq!(review(bob.clone(), "1.0.0", "maybe").await, 400);
    assert_eq!(review(bob.clone(), "3.0.0", "approved").await, 404);
    assert_eq!(review(bob.clone(), "1.0.0", "approved").await, 200);
    assert_eq!(listed(tool.clone()).await.as_deref(), Some("1.0.0"));
    assert_eq!(review(bob.clone(), "1.1.0", "approved").await, 200);
    assert_eq!(listed(tool.clone()).await.as_deref(), Some("1.1.0"), "update available");
    let (st, old) = api.send("GET", &format!("/api/plugins/{tool}/bundle?version=1.0.0"), None, None).await;
    assert_eq!((st, read_tarball(&old).unwrap()["main.py"].as_slice()), (200, &b"a"[..]));

    // 10.7 model keys: stored sealed, never returned, per account.
    assert_eq!(api.json("PUT", "/api/me/model-key", None, Some(json!({"provider": "anthropic", "key": "sk-ant-secret-1"}))).await.0, 401);
    assert_eq!(api.json("PUT", "/api/me/model-key", Some(&alice), Some(json!({"provider": "nope", "key": "sk-ant-secret-1"}))).await.0, 400);
    let (st, b) = api.json("PUT", "/api/me/model-key", Some(&alice), Some(json!({"provider": "anthropic", "key": "sk-ant-secret-1"}))).await;
    assert_eq!((st, b), (200, json!({"provider": "anthropic", "set": true})));
    let (_, raw) = api.send("GET", "/api/me/model-key", Some(&alice), None).await;
    assert!(!String::from_utf8_lossy(&raw).contains("secret"), "key leaked");
    assert_eq!(api.json("GET", "/api/me/model-key", Some(&bob), None).await.1["set"], false);
    let (_, sealed) = db::get_model_key(&db, &alice_id).await.unwrap().unwrap();
    assert!(!sealed.contains("sk-ant") && secret_box().open(&sealed).as_deref() == Some("sk-ant-secret-1"));

    // 10.6 hosted runtime proxy: auth required; the runtime sees the secret, account, project and only that account's key.
    let (runtime, mut seen) = fake_runtime().await;
    std::env::set_var("PEAR_AGENT_RUNTIME_URL", &runtime);
    std::env::set_var("PEAR_RUNTIME_SECRET", "runtime-secret");
    let ws_base = api.base.replacen("http", "ws", 1);
    assert!(tokio_tungstenite::connect_async(format!("{ws_base}/agent/ws?project=p1")).await.is_err(), "no token");
    for (tok, id, key) in [(&alice, &alice_id, Some("sk-ant-secret-1")), (&bob, &bob_id, None)] {
        let (mut ws, _) = tokio_tungstenite::connect_async(format!("{ws_base}/agent/ws?token={tok}&project=p1")).await.unwrap();
        ws.send(Message::Text("hi".into())).await.unwrap();
        let reply = ws.next().await.unwrap().unwrap();
        assert_eq!(reply.to_text().unwrap(), "echo:hi");
        let h = seen.recv().await.unwrap();
        let get = |k: &str| h.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        assert_eq!(get("authorization"), Some("Bearer runtime-secret"));
        assert_eq!(get("x-pear-account"), Some(id.as_str()));
        assert_eq!(get("x-pear-project"), Some("p1"));
        assert_eq!(get("x-pear-model-key"), key);
    }
    assert_eq!(api.send("GET", "/agent/ws?token=x&project=..", Some(&alice), None).await.0, 400);
    std::env::remove_var("PEAR_AGENT_RUNTIME_URL");

    for (method, path) in [("GET", "/api/plugins/nope"), ("GET", "/api/plugins/nope/bundle"), ("POST", "/api/plugins/nope/installs")] {
        let (st, body) = api.json(method, path, Some(&alice), None).await;
        assert_eq!(st, 404, "{method} {path}: {body}");
    }
}

#[tokio::test]
async fn marketplace_against_memory_then_postgres() {
    std::env::set_var("PEAR_DEV_SIGNIN", "1");
    scenario(Db::Mem(MemStore::default())).await;
    let Ok(url) = std::env::var("DATABASE_URL") else {
        eprintln!("DATABASE_URL unset: Postgres part skipped");
        return;
    };
    let pool = db::connect_lazy(&url).unwrap();
    db::migrate(&pool).await.unwrap();
    db::migrate(&pool).await.unwrap(); // the guard makes a second run a no-op
    scenario(Db::Pg(pool)).await;
}
