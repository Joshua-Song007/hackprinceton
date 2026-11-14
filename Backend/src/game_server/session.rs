// One WebSocket session per live game: players join and leave, remote events go into the script
// host, and the host's `fire` / `fireAll` come back out. Lobbies and matchmaking are game code.
// Route: GET /play/{game_id} (WebSocket). Text frames are JSON `{"name": "...", "data": ...}` both ways.
// Auth: `accounts::authenticate` runs before the upgrade; no valid bearer token = 401.
//
// [provisional: needs-tien-review] design choices:
// - `ScriptHost` is the seam; script_host.rs (next item) implements it. Until it registers a factory
//   via `Registry::new`, the global registry uses `NoopHost` (no server scripts: nothing is sent back).
// - Player id = the signed-in account id. A second connection by the same account replaces the first.
// - One `std::sync::Mutex` guards all sessions and host calls run under it (hosts must be quick and
//   never block); sessions are created on first join and dropped when the last player leaves.
// - Game ids are not checked against the database here; length-limited only.
// - Outbound queues are unbounded; inbound frames are limited to MAX_MESSAGE_BYTES; malformed
//   frames are ignored, not fatal.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use axum::extract::ws::{rejection::WebSocketUpgradeRejection, Message, WebSocket, WebSocketUpgrade};
use axum::extract::Path;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use crate::api::accounts;
use crate::AppState;

const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const MAX_GAME_ID_LEN: usize = 128;

/// An event a server script sends out.
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)] // constructed by script_host.rs (next 4.2 item)
pub enum Outgoing {
    /// `ctx.remote.fire(player, name, data)`
    Fire { player: String, name: String, data: Value },
    /// `ctx.remote.fireAll(name, data)`
    FireAll { name: String, data: Value },
}

/// The server-script engine for one game session (implemented by script_host.rs).
pub trait ScriptHost: Send {
    fn on_player_join(&mut self, player: &str) -> Vec<Outgoing>;
    fn on_player_leave(&mut self, player: &str) -> Vec<Outgoing>;
    fn on_remote(&mut self, player: &str, name: &str, data: &Value) -> Vec<Outgoing>;
}

/// Host used when a game has no server scripts: ignores everything.
pub struct NoopHost;

impl ScriptHost for NoopHost {
    fn on_player_join(&mut self, _: &str) -> Vec<Outgoing> {
        Vec::new()
    }
    fn on_player_leave(&mut self, _: &str) -> Vec<Outgoing> {
        Vec::new()
    }
    fn on_remote(&mut self, _: &str, _: &str, _: &Value) -> Vec<Outgoing> {
        Vec::new()
    }
}

/// Wire frame, both directions.
#[derive(Debug, Serialize, Deserialize)]
struct Frame {
    name: String,
    #[serde(default)]
    data: Value,
}

pub type HostFactory = Box<dyn Fn(&str) -> Box<dyn ScriptHost> + Send + Sync>;

struct Player {
    conn: u64,
    tx: UnboundedSender<String>,
}

struct Session {
    host: Box<dyn ScriptHost>,
    players: HashMap<String, Player>,
}

impl Session {
    fn deliver(&self, events: Vec<Outgoing>) {
        for ev in events {
            match ev {
                Outgoing::Fire { player, name, data } => {
                    if let (Some(p), Some(text)) = (self.players.get(&player), encode(name, data)) {
                        let _ = p.tx.send(text);
                    }
                }
                Outgoing::FireAll { name, data } => {
                    if let Some(text) = encode(name, data) {
                        for p in self.players.values() {
                            let _ = p.tx.send(text.clone());
                        }
                    }
                }
            }
        }
    }
}

fn encode(name: String, data: Value) -> Option<String> {
    serde_json::to_string(&Frame { name, data }).ok()
}

/// All live sessions, keyed by game id.
pub struct Registry {
    factory: HostFactory,
    sessions: Mutex<HashMap<String, Session>>,
    next_conn: AtomicU64,
}

impl Registry {
    pub fn new(factory: HostFactory) -> Self {
        Registry {
            factory,
            sessions: Mutex::new(HashMap::new()),
            next_conn: AtomicU64::new(1),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
        self.sessions.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Adds a player; frames for them arrive on `tx`. Returns the connection id to pass to
    /// `remote` / `leave`. A repeat join by the same player replaces the old connection (its
    /// sender is dropped, which ends that socket).
    pub fn join(&self, game_id: &str, player: &str, tx: UnboundedSender<String>) -> u64 {
        let conn = self.next_conn.fetch_add(1, Ordering::Relaxed);
        let mut map = self.lock();
        let session = map.entry(game_id.to_string()).or_insert_with(|| Session {
            host: (self.factory)(game_id),
            players: HashMap::new(),
        });
        let replaced = session
            .players
            .insert(player.to_string(), Player { conn, tx })
            .is_some();
        if !replaced {
            let out = session.host.on_player_join(player);
            session.deliver(out);
        }
        conn
    }

    /// Removes the player if `conn` is still their current connection; drops an empty session.
    pub fn leave(&self, game_id: &str, player: &str, conn: u64) {
        let mut map = self.lock();
        let Some(session) = map.get_mut(game_id) else { return };
        if session.players.get(player).map(|p| p.conn) != Some(conn) {
            return;
        }
        session.players.remove(player);
        let out = session.host.on_player_leave(player);
        session.deliver(out);
        if session.players.is_empty() {
            map.remove(game_id);
        }
    }

    /// Handles one inbound text frame from a player. Malformed frames and stale connections are ignored.
    pub fn remote(&self, game_id: &str, player: &str, conn: u64, text: &str) {
        let Ok(frame) = serde_json::from_str::<Frame>(text) else { return };
        let mut map = self.lock();
        let Some(session) = map.get_mut(game_id) else { return };
        if session.players.get(player).map(|p| p.conn) != Some(conn) {
            return;
        }
        let out = session.host.on_remote(player, &frame.name, &frame.data);
        session.deliver(out);
    }

    #[cfg(test)]
    fn player_count(&self, game_id: &str) -> usize {
        self.lock().get(game_id).map_or(0, |s| s.players.len())
    }
}

fn registry() -> &'static Registry {
    static R: OnceLock<Registry> = OnceLock::new();
    R.get_or_init(|| Registry::new(super::script_host::factory()))
}

async fn play(
    Path(game_id): Path<String>,
    headers: HeaderMap,
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response {
    let Some(account) = accounts::authenticate(&headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if game_id.is_empty() || game_id.len() > MAX_GAME_ID_LEN {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match ws {
        Ok(ws) => ws
            .max_message_size(MAX_MESSAGE_BYTES)
            .on_upgrade(move |socket| run_socket(socket, game_id, account.id)),
        Err(rej) => rej.into_response(),
    }
}

async fn run_socket(mut socket: WebSocket, game_id: String, player: String) {
    let reg = registry();
    let (tx, mut rx) = unbounded_channel::<String>();
    let conn = reg.join(&game_id, &player, tx);
    loop {
        tokio::select! {
            out = rx.recv() => match out {
                Some(text) => {
                    if socket.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                None => break, // replaced by a newer connection
            },
            inc = socket.recv() => match inc {
                Some(Ok(Message::Text(t))) => reg.remote(&game_id, &player, conn, t.as_str()),
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {} // binary / ping / pong ignored
            },
        }
    }
    reg.leave(&game_id, &player, conn);
}

/// Route: GET /play/{game_id} (WebSocket upgrade).
pub fn routes() -> Router<AppState> {
    Router::new().route("/play/{game_id}", get(play))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::mpsc::UnboundedReceiver;

    /// Records calls into `log`; replies to remote "ping" with Fire back to sender, "all" with FireAll,
    /// "to:<id>" with Fire to that player. Join announces via FireAll "joined".
    struct FakeHost {
        log: Arc<Mutex<Vec<String>>>,
    }

    impl ScriptHost for FakeHost {
        fn on_player_join(&mut self, player: &str) -> Vec<Outgoing> {
            self.log.lock().unwrap().push(format!("join:{player}"));
            vec![Outgoing::FireAll { name: "joined".into(), data: json!({ "id": player }) }]
        }
        fn on_player_leave(&mut self, player: &str) -> Vec<Outgoing> {
            self.log.lock().unwrap().push(format!("leave:{player}"));
            Vec::new()
        }
        fn on_remote(&mut self, player: &str, name: &str, data: &Value) -> Vec<Outgoing> {
            self.log.lock().unwrap().push(format!("remote:{player}:{name}"));
            if name == "all" {
                vec![Outgoing::FireAll { name: "hit".into(), data: data.clone() }]
            } else if let Some(target) = name.strip_prefix("to:") {
                vec![Outgoing::Fire { player: target.into(), name: "dm".into(), data: data.clone() }]
            } else {
                vec![Outgoing::Fire { player: player.into(), name: "pong".into(), data: data.clone() }]
            }
        }
    }

    fn reg() -> (Registry, Arc<Mutex<Vec<String>>>) {
        let log = Arc::new(Mutex::new(Vec::new()));
        let l = log.clone();
        let r = Registry::new(Box::new(move |_| Box::new(FakeHost { log: l.clone() })));
        (r, log)
    }

    fn player(r: &Registry, game: &str, id: &str) -> (u64, UnboundedReceiver<String>) {
        let (tx, rx) = unbounded_channel();
        (r.join(game, id, tx), rx)
    }

    fn drain(rx: &mut UnboundedReceiver<String>) -> Vec<Value> {
        let mut v = Vec::new();
        while let Ok(t) = rx.try_recv() {
            v.push(serde_json::from_str(&t).unwrap());
        }
        v
    }

    #[test]
    fn join_and_leave_call_host_and_drop_empty_session() {
        let (r, log) = reg();
        let (ca, mut a) = player(&r, "g", "a");
        assert_eq!(r.player_count("g"), 1);
        assert_eq!(drain(&mut a), vec![json!({"name":"joined","data":{"id":"a"}})]);
        let (cb, mut b) = player(&r, "g", "b");
        assert_eq!(drain(&mut a), vec![json!({"name":"joined","data":{"id":"b"}})]);
        assert_eq!(drain(&mut b).len(), 1);
        r.leave("g", "b", cb);
        r.leave("g", "a", ca);
        assert_eq!(r.player_count("g"), 0);
        assert_eq!(*log.lock().unwrap(), ["join:a", "join:b", "leave:b", "leave:a"]);
    }

    #[test]
    fn fire_goes_to_one_player_only() {
        let (r, _) = reg();
        let (ca, mut a) = player(&r, "g", "a");
        let (_cb, mut b) = player(&r, "g", "b");
        drain(&mut a);
        drain(&mut b);
        r.remote("g", "a", ca, r#"{"name":"to:b","data":{"x":1}}"#);
        assert!(drain(&mut a).is_empty());
        assert_eq!(drain(&mut b), vec![json!({"name":"dm","data":{"x":1}})]);
        r.remote("g", "a", ca, r#"{"name":"ping"}"#); // missing data defaults to null
        assert_eq!(drain(&mut a), vec![json!({"name":"pong","data":null})]);
        assert!(drain(&mut b).is_empty());
    }

    #[test]
    fn fire_all_reaches_every_player() {
        let (r, _) = reg();
        let (ca, mut a) = player(&r, "g", "a");
        let (_cb, mut b) = player(&r, "g", "b");
        drain(&mut a);
        drain(&mut b);
        r.remote("g", "a", ca, r#"{"name":"all","data":"p"}"#);
        let want = vec![json!({"name":"hit","data":"p"})];
        assert_eq!(drain(&mut a), want);
        assert_eq!(drain(&mut b), want);
    }

    #[test]
    fn games_are_isolated() {
        let (r, log) = reg();
        let (ca, mut a) = player(&r, "g1", "a");
        let (_cb, mut b) = player(&r, "g2", "b");
        drain(&mut a);
        drain(&mut b);
        r.remote("g1", "a", ca, r#"{"name":"all","data":1}"#);
        assert_eq!(drain(&mut a).len(), 1);
        assert!(drain(&mut b).is_empty());
        // a player id from g1 is not addressable from g2
        let (cb2, _) = player(&r, "g2", "c");
        r.remote("g2", "c", cb2, r#"{"name":"to:a"}"#);
        assert!(drain(&mut a).is_empty());
        assert!(log.lock().unwrap().contains(&"remote:c:to:a".to_string()));
    }

    #[test]
    fn malformed_and_stale_frames_ignored_and_rejoin_replaces() {
        let (r, log) = reg();
        let (c1, mut a1) = player(&r, "g", "a");
        drain(&mut a1);
        r.remote("g", "a", c1, "not json");
        r.remote("g", "a", c1, r#"{"data":1}"#);
        r.remote("g", "nobody", c1, r#"{"name":"ping"}"#);
        r.remote("nogame", "a", c1, r#"{"name":"ping"}"#);
        assert!(!log.lock().unwrap().iter().any(|l| l.starts_with("remote:")));
        let (c2, mut a2) = player(&r, "g", "a");
        assert_eq!(r.player_count("g"), 1);
        assert!(a1.try_recv().is_err()); // old sender dropped
        r.remote("g", "a", c1, r#"{"name":"ping"}"#); // stale connection
        r.leave("g", "a", c1); // stale leave must not remove the new connection
        assert_eq!(r.player_count("g"), 1);
        r.remote("g", "a", c2, r#"{"name":"ping"}"#);
        assert_eq!(drain(&mut a2).last(), Some(&json!({"name":"pong","data":null})));
        // replacing join does not re-run on_player_join
        assert_eq!(log.lock().unwrap().iter().filter(|l| *l == "join:a").count(), 1);
    }

    #[tokio::test]
    async fn play_without_token_is_401() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = routes().with_state(AppState { db: None });
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(b"GET /play/g1 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).await.unwrap();
        assert!(buf.starts_with("HTTP/1.1 401"), "{buf}");
    }
}
