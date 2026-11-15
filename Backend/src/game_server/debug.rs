// Live debug stream for a game session (Studio "Server" panels): owner-only WebSocket
// GET /debug/{game_id}?lobby=CODE (default OPEN). On connect the server sends one snapshot frame
// `{"kind":"snapshot","t","players","version","state","logs"}` (logs = last 100 log/error events),
// then streams `{"kind":"join|leave|in|out|log|error|state|reload","t", ...}` as the session produces them.
// Auth: `?token=` or bearer (see `accounts::authenticate_request`); 401 no token, 403 not the game's owner.
//
// [provisional: needs-tien-review] design choices:
// - One global `DebugBus`; session.rs and script_host.rs publish into it, debug sockets subscribe.
// - Each subscriber has a bounded queue (QUEUE_CAP) that drops its oldest frame when full, and
//   publishing never awaits, so a slow Studio can never stall a game session.
// - Per-game state (players, version, `ctx.state`, recent logs) lives only while the game has a live
//   session or a subscriber; `end` clears it when the session's last player leaves.

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::ws::{rejection::WebSocketUpgradeRejection, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde_json::{json, Value};
use tokio::sync::Notify;

use crate::api::accounts;
use crate::api::games::valid_uuid;
use super::session::{normalize_lobby, session_key, OPEN_LOBBY};
use crate::db;
use crate::AppState;

const QUEUE_CAP: usize = 256;
const MAX_RECENT: usize = 100;
const MAX_MESSAGE_BYTES: usize = 4 * 1024;

/// Bounded per-subscriber frame queue: pushing never blocks and drops the oldest frame when full.
pub struct Queue {
    items: Mutex<VecDeque<String>>,
    notify: Notify,
}

impl Queue {
    fn push(&self, text: String) {
        let mut q = self.items.lock().unwrap_or_else(|p| p.into_inner());
        if q.len() >= QUEUE_CAP {
            q.pop_front();
        }
        q.push_back(text);
        drop(q);
        self.notify.notify_one();
    }

    fn pop(&self) -> Option<String> {
        self.items.lock().unwrap_or_else(|p| p.into_inner()).pop_front()
    }
}

#[derive(Default)]
struct GameDebug {
    players: BTreeSet<String>,
    version: Option<i32>,
    state: Value,
    recent: VecDeque<Value>,
    subs: Vec<(u64, Arc<Queue>)>,
}

/// Debug events and snapshots for every game with a live session or a subscriber.
#[derive(Default)]
pub struct DebugBus {
    games: Mutex<HashMap<String, GameDebug>>,
    next_sub: AtomicU64,
}

/// A debug subscriber; dropping it unsubscribes.
pub struct Subscription<'a> {
    bus: &'a DebugBus,
    game_id: String,
    id: u64,
    queue: Arc<Queue>,
}

impl Drop for Subscription<'_> {
    fn drop(&mut self) {
        let mut map = self.bus.lock();
        if let Some(g) = map.get_mut(&self.game_id) {
            g.subs.retain(|(id, _)| *id != self.id);
        }
        prune(&mut map, &self.game_id);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// A game with recent logs is kept even with no players/subscribers: a script load failure is published
// before the session's first `join`, and a later `/debug` connect must still see it. `end` clears them.
fn prune(map: &mut HashMap<String, GameDebug>, game_id: &str) {
    if map.get(game_id).is_some_and(|g| g.players.is_empty() && g.subs.is_empty() && g.recent.is_empty()) {
        map.remove(game_id);
    }
}

impl DebugBus {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, GameDebug>> {
        self.games.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Records one event for the game and fans it out. `fields` must be a JSON object; `kind` and
    /// `t` are added. Never blocks.
    pub fn publish(&self, game_id: &str, kind: &str, mut fields: Value) {
        fields["kind"] = json!(kind);
        fields["t"] = json!(now_ms());
        let mut map = self.lock();
        let g = map.entry(game_id.to_string()).or_default();
        match kind {
            "join" => {
                if let Some(p) = fields["player"].as_str() {
                    g.players.insert(p.to_string());
                }
            }
            "leave" => {
                if let Some(p) = fields["player"].as_str() {
                    g.players.remove(p);
                }
            }
            "reload" => {
                g.version = fields["version"].as_i64().map(|v| v as i32);
                g.state = json!({}); // the restarted host starts with empty ctx.state
            }
            "state" => g.state = fields["state"].clone(),
            "log" | "error" => {
                if g.recent.len() >= MAX_RECENT {
                    g.recent.pop_front();
                }
                g.recent.push_back(fields.clone());
            }
            _ => {}
        }
        let text = fields.to_string();
        for (_, q) in &g.subs {
            q.push(text.clone());
        }
        prune(&mut map, game_id);
    }

    /// Version of the script set the live session was built from.
    pub fn set_version(&self, game_id: &str, version: i32) {
        self.lock().entry(game_id.to_string()).or_default().version = Some(version);
    }

    /// The game's session ended (last player left): forget players, version and `ctx.state`.
    pub fn end(&self, game_id: &str) {
        let mut map = self.lock();
        if let Some(g) = map.get_mut(game_id) {
            g.players.clear();
            g.version = None;
            g.state = Value::Null;
            g.recent.clear();
        }
        prune(&mut map, game_id);
    }

    /// Subscribes to the game's events; returns the subscription and the snapshot frame, taken
    /// atomically so no event falls between them.
    pub fn subscribe(&self, game_id: &str) -> (Subscription<'_>, Value) {
        let id = self.next_sub.fetch_add(1, Ordering::Relaxed);
        let queue = Arc::new(Queue { items: Mutex::new(VecDeque::new()), notify: Notify::new() });
        let mut map = self.lock();
        let g = map.entry(game_id.to_string()).or_default();
        g.subs.push((id, queue.clone()));
        let snapshot = json!({
            "kind": "snapshot",
            "t": now_ms(),
            "players": g.players,
            "version": g.version,
            "state": if g.state.is_null() { json!({}) } else { g.state.clone() },
            "logs": g.recent,
        });
        drop(map);
        (Subscription { bus: self, game_id: game_id.to_string(), id, queue }, snapshot)
    }
}

/// The process-wide bus used by the game server.
pub fn bus() -> &'static DebugBus {
    static B: OnceLock<DebugBus> = OnceLock::new();
    B.get_or_init(DebugBus::default)
}

async fn debug(
    State(state): State<AppState>,
    Path(game_id): Path<String>,
    headers: HeaderMap,
    uri: Uri,
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response {
    let Some(account) = accounts::authenticate_request(&headers, uri.query()) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if !valid_uuid(&game_id) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Some(pool) = state.db.as_ref() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let lobby = match accounts::query_param(uri.query(), "lobby") {
        None => OPEN_LOBBY.to_string(),
        Some(l) => match normalize_lobby(l) {
            Some(l) => l,
            None => return StatusCode::BAD_REQUEST.into_response(),
        },
    };
    match db::game_owner(pool, &game_id).await {
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Ok(Some(owner)) if owner != account.id => return StatusCode::FORBIDDEN.into_response(),
        Ok(Some(_)) => {}
        Err(e) => {
            eprintln!("debug: owner: db error: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }
    match ws {
        Ok(ws) => ws
            .max_message_size(MAX_MESSAGE_BYTES)
            .on_upgrade(move |socket| run_socket(socket, session_key(&game_id, &lobby))),
        Err(rej) => rej.into_response(),
    }
}

async fn run_socket(mut socket: WebSocket, game_id: String) {
    let (sub, snapshot) = bus().subscribe(&game_id);
    if socket.send(Message::Text(snapshot.to_string().into())).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            _ = sub.queue.notify.notified() => {
                while let Some(text) = sub.queue.pop() {
                    if socket.send(Message::Text(text.into())).await.is_err() {
                        return;
                    }
                }
            }
            inc = socket.recv() => match inc {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
                Some(Ok(_)) => {} // the debug stream is one-way; client frames are ignored
            },
        }
    }
}

/// Route: GET /debug/{game_id} (WebSocket upgrade, owner only).
pub fn routes() -> Router<AppState> {
    Router::new().route("/debug/{game_id}", get(debug))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn drain(sub: &Subscription) -> Vec<Value> {
        std::iter::from_fn(|| sub.queue.pop()).map(|t| serde_json::from_str(&t).unwrap()).collect()
    }

    #[test]
    fn snapshot_then_events_in_order() {
        let bus = DebugBus::default();
        bus.publish("g", "join", json!({"player": "a"}));
        bus.set_version("g", 3);
        bus.publish("g", "state", json!({"state": {"n": 1}}));
        bus.publish("g", "log", json!({"level": "log", "msg": "hi"}));
        let (sub, snap) = bus.subscribe("g");
        assert_eq!(snap["kind"], "snapshot");
        assert_eq!(snap["players"], json!(["a"]));
        assert_eq!(snap["version"], 3);
        assert_eq!(snap["state"], json!({"n": 1}));
        assert_eq!(snap["logs"].as_array().unwrap().len(), 1);
        bus.publish("g", "in", json!({"player": "a", "name": "x", "data": null}));
        bus.publish("g", "leave", json!({"player": "a"}));
        let got = drain(&sub);
        assert_eq!(got.iter().map(|e| e["kind"].as_str().unwrap()).collect::<Vec<_>>(), ["in", "leave"]);
        assert!(got[0]["t"].as_u64().unwrap() > 0);
    }

    #[test]
    fn slow_subscriber_drops_oldest_and_recent_logs_are_capped() {
        let bus = DebugBus::default();
        let (sub, _) = bus.subscribe("g");
        for i in 0..(QUEUE_CAP + 10) {
            bus.publish("g", "log", json!({"level": "log", "msg": i.to_string()}));
        }
        let got = drain(&sub);
        assert_eq!(got.len(), QUEUE_CAP);
        assert_eq!(got[0]["msg"], "10"); // oldest 10 dropped
        let (_s2, snap) = bus.subscribe("g");
        assert_eq!(snap["logs"].as_array().unwrap().len(), MAX_RECENT);
    }

    #[test]
    fn entry_is_forgotten_after_session_end_and_unsubscribe() {
        let bus = DebugBus::default();
        bus.publish("g", "join", json!({"player": "a"}));
        let (sub, _) = bus.subscribe("g");
        bus.end("g");
        assert_eq!(bus.lock().len(), 1); // still subscribed
        drop(sub);
        assert!(bus.lock().is_empty());
        bus.publish("g", "leave", json!({"player": "a"})); // no players, no subscribers
        assert!(bus.lock().is_empty());
    }

    #[test]
    fn reload_resets_state_and_sets_version() {
        let bus = DebugBus::default();
        bus.publish("g", "join", json!({"player": "a"}));
        bus.publish("g", "state", json!({"state": {"n": 1}}));
        bus.publish("g", "reload", json!({"version": 2}));
        let (_s, snap) = bus.subscribe("g");
        assert_eq!(snap["version"], 2);
        assert_eq!(snap["state"], json!({}));
    }

    #[tokio::test]
    async fn debug_without_token_is_401() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = routes().with_state(AppState { db: None });
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(b"GET /debug/123e4567-e89b-12d3-a456-426614174000 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).await.unwrap();
        assert!(buf.starts_with("HTTP/1.1 401"), "{buf}");
    }
}
