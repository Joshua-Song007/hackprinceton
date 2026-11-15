// One WebSocket session per live (game, lobby): players join and leave, remote events go into the script
// host, and the host's `fire` / `fireAll` come back out. Lobbies and matchmaking are game code.
// Route: GET /play/{game_id}?lobby=CODE (WebSocket); `lobby` is 4-8 chars [A-Z0-9], case-insensitive, default "OPEN". Text frames are JSON `{"name": "...", "data": ...}` both ways.
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
// - 8.1: before a session starts, `play` fetches the game's latest published version (or `?version=n`)
//   from the database and builds the host from its `server_scripts`; a game id that is not a uuid, or a
//   game with no versions, runs without scripts. Publishing a newer version restarts a live session's
//   host (`reload`): players get `{"name":"_reload","data":{"version":n}}`, then the new host gets
//   `on_player_join` for everyone already connected (its `ctx.state` starts empty). A player joining
//   an already-live session joins that session whatever version they asked for.
//   Every join, leave, inbound and outbound frame is also published to the debug bus (debug.rs).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::ws::{rejection::WebSocketUpgradeRejection, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use super::debug::bus;
use super::script_host::sources_of;
use crate::api::accounts;
use crate::api::games::valid_uuid;
use crate::db::{self, GameVersion};
use crate::AppState;

const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const MAX_GAME_ID_LEN: usize = 128;
/// The shared lobby a /play link without `?lobby=` lands in (keeps older phone links working).
pub const OPEN_LOBBY: &str = "OPEN";
/// A socket is pinged every `ping`; if no frame at all arrives for `idle` it is dropped, which runs `leave`.
#[derive(Clone, Copy)]
struct Heartbeat {
    ping: Duration,
    idle: Duration,
}
const HEARTBEAT: Heartbeat = Heartbeat { ping: Duration::from_secs(10), idle: Duration::from_secs(30) };
/// `ctx.after` limits: delay clamped to this range, at most this many pending timers per session.
const MIN_TIMER_MS: u64 = 50;
const MAX_TIMER_MS: u64 = 3_600_000;
const MAX_TIMERS: usize = 64;
/// How often a connected socket asks its session to run due timers.
const TICK: Duration = Duration::from_millis(50);

/// An event a server script sends out.
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)] // constructed by script_host.rs (next 4.2 item)
pub enum Outgoing {
    /// `ctx.remote.fire(player, name, data)`
    Fire { player: String, name: String, data: Value },
    /// `ctx.remote.fireAll(name, data)`
    FireAll { name: String, data: Value },
    /// `ctx.after(ms, tag, data)`: run `onTimer(ctx, tag, data)` after `ms` (id chosen by the script host)
    After { id: u64, ms: u64, tag: String, data: Value },
    /// `ctx.cancel(id)`
    Cancel { id: u64 },
}

/// The server-script engine for one game session (implemented by script_host.rs).
pub trait ScriptHost: Send {
    fn on_player_join(&mut self, player: &str) -> Vec<Outgoing>;
    fn on_player_leave(&mut self, player: &str) -> Vec<Outgoing>;
    fn on_remote(&mut self, player: &str, name: &str, data: &Value) -> Vec<Outgoing>;
    /// A `ctx.after` timer came due.
    fn on_timer(&mut self, _tag: &str, _data: &Value) -> Vec<Outgoing> {
        Vec::new()
    }
    /// Called on every tick: finished async work (`ctx.agent.run`) settles and its sends come out.
    fn poll(&mut self) -> Vec<Outgoing> {
        Vec::new()
    }
    /// Display name for a player id, called before that player's `on_player_join`.
    fn set_player_name(&mut self, _player: &str, _name: &str) {}
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

/// Builds a host from (game id, server-script sources).
pub type HostFactory = Box<dyn Fn(&str, &[String]) -> Box<dyn ScriptHost> + Send + Sync>;

/// The published version a session's host is built from.
pub struct Release {
    pub version: i32,
    pub sources: Vec<String>,
}

impl From<&GameVersion> for Release {
    fn from(v: &GameVersion) -> Self {
        Release { version: v.version, sources: sources_of(&v.server_scripts) }
    }
}

struct Player {
    conn: u64,
    name: String,
    tx: UnboundedSender<String>,
}

struct Timer {
    id: u64,
    due: Instant,
    tag: String,
    data: Value,
}

struct Session {
    game: String,
    lobby: String,
    host: Box<dyn ScriptHost>,
    players: HashMap<String, Player>,
    timers: Vec<Timer>,
}

impl Session {
    fn deliver(&mut self, game_id: &str, events: Vec<Outgoing>) {
        for ev in events {
            match ev {
                Outgoing::After { id, ms, tag, data } => {
                    if self.timers.len() < MAX_TIMERS {
                        let due = Instant::now() + Duration::from_millis(ms.clamp(MIN_TIMER_MS, MAX_TIMER_MS));
                        self.timers.push(Timer { id, due, tag, data });
                    }
                }
                Outgoing::Cancel { id } => self.timers.retain(|t| t.id != id),
                Outgoing::Fire { player, name, data } => {
                    bus().publish(game_id, "out", json!({ "player": player, "name": name, "data": data }));
                    if let (Some(p), Some(text)) = (self.players.get(&player), encode(name, data)) {
                        let _ = p.tx.send(text);
                    }
                }
                Outgoing::FireAll { name, data } => {
                    bus().publish(game_id, "out", json!({ "player": null, "name": name, "data": data }));
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

/// Registry / debug-bus key of one lobby of a game; the host factory and the debug bus see this string.
pub fn session_key(game_id: &str, lobby: &str) -> String {
    format!("{game_id}/{lobby}")
}

fn split_key(key: &str) -> (String, String) {
    match key.rsplit_once('/') {
        Some((g, l)) => (g.to_string(), l.to_string()),
        None => (key.to_string(), OPEN_LOBBY.to_string()),
    }
}

/// 4-8 chars of [A-Za-z0-9], uppercased; None if invalid.
pub fn normalize_lobby(s: &str) -> Option<String> {
    ((4..=8).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric())).then(|| s.to_ascii_uppercase())
}

fn encode(name: String, data: Value) -> Option<String> {
    serde_json::to_string(&Frame { name, data }).ok()
}

/// All live sessions, keyed by `session_key(game id, lobby)`.
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

    /// Adds a player to the session `key`; frames for them arrive on `tx`. Returns the connection id to pass to
    /// `remote` / `leave`. A repeat join by the same player replaces the old connection (its
    /// sender is dropped, which ends that socket). `release` builds the host when this join starts
    /// the session; None (no published version) means no server scripts.
    pub fn join(&self, game_id: &str, player: &str, tx: UnboundedSender<String>, release: Option<Release>) -> u64 {
        self.join_inner(game_id, player, None, tx, release)
    }

    /// Like `join`, for a real connection: records the display name for scripts and sends the joiner a
    /// `_welcome` frame `{"id", "name", "lobby"}` (also on a reconnect) so a client script knows its own player id.
    pub fn join_named(&self, game_id: &str, player: &str, name: &str, tx: UnboundedSender<String>, release: Option<Release>) -> u64 {
        self.join_inner(game_id, player, Some(name), tx, release)
    }

    fn join_inner(&self, game_id: &str, player: &str, name: Option<&str>, tx: UnboundedSender<String>, release: Option<Release>) -> u64 {
        let conn = self.next_conn.fetch_add(1, Ordering::Relaxed);
        let mut map = self.lock();
        let created = !map.contains_key(game_id);
        let session = map.entry(game_id.to_string()).or_insert_with(|| Session {
            game: split_key(game_id).0,
            lobby: split_key(game_id).1,
            host: (self.factory)(game_id, release.as_ref().map_or(&[][..], |r| r.sources.as_slice())),
            players: HashMap::new(),
            timers: Vec::new(),
        });
        if let Some(name) = name {
            session.host.set_player_name(player, name);
            if let Some(text) = encode("_welcome".into(), json!({ "id": player, "name": name, "lobby": session.lobby })) {
                let _ = tx.send(text);
            }
        }
        let replaced = session
            .players
            .insert(player.to_string(), Player { conn, name: name.unwrap_or_default().to_string(), tx })
            .is_some();
        if !replaced {
            bus().publish(game_id, "join", json!({ "player": player }));
            if let (true, Some(r)) = (created, &release) {
                bus().set_version(game_id, r.version);
            }
            let out = session.host.on_player_join(player);
            session.deliver(game_id, out);
        }
        conn
    }

    /// Restarts every live lobby of a game onto a newly published version. Players get a `_reload` frame,
    /// then the new host sees every connected player join. No live session: nothing to do.
    pub fn reload(&self, game_id: &str, release: Release) {
        let mut map = self.lock();
        let keys: Vec<String> = map.iter().filter(|(_, s)| s.game == game_id).map(|(k, _)| k.clone()).collect();
        for key in keys {
            Self::reload_one(&mut map, &self.factory, &key, &release);
        }
    }

    fn reload_one(map: &mut HashMap<String, Session>, factory: &HostFactory, game_id: &str, release: &Release) {
        let Some(session) = map.get_mut(game_id) else { return };
        bus().publish(game_id, "reload", json!({ "version": release.version }));
        session.host = factory(game_id, &release.sources);
        session.timers.clear(); // the old host's timers belong to the old scripts
        session.deliver(
            game_id,
            vec![Outgoing::FireAll { name: "_reload".into(), data: json!({ "version": release.version }) }],
        );
        let players: Vec<String> = session.players.keys().cloned().collect();
        for player in players {
            let out = session.host.on_player_join(&player);
            session.deliver(game_id, out);
        }
    }

    /// Removes the player if `conn` is still their current connection; drops an empty session.
    pub fn leave(&self, game_id: &str, player: &str, conn: u64) {
        let mut map = self.lock();
        let Some(session) = map.get_mut(game_id) else { return };
        if session.players.get(player).map(|p| p.conn) != Some(conn) {
            return;
        }
        session.players.remove(player);
        bus().publish(game_id, "leave", json!({ "player": player }));
        let out = session.host.on_player_leave(player);
        session.deliver(game_id, out);
        if session.players.is_empty() {
            map.remove(game_id);
            bus().end(game_id);
        }
    }

    /// Ends every live lobby of a game (its game was deleted): the players' senders drop, which ends their
    /// sockets. No live session: nothing to do.
    pub fn close(&self, game_id: &str) {
        let mut map = self.lock();
        let keys: Vec<String> = map.iter().filter(|(_, s)| s.game == game_id).map(|(k, _)| k.clone()).collect();
        for key in keys {
            map.remove(&key);
            bus().end(&key);
        }
    }

    /// Live lobbies of a game with their players `(id, name)`, sorted by code. Nothing is stored.
    pub fn lobbies(&self, game_id: &str) -> Vec<(String, Vec<(String, String)>)> {
        let map = self.lock();
        let mut out: Vec<_> = map
            .values()
            .filter(|s| s.game == game_id)
            .map(|s| {
                let mut ps: Vec<_> = s.players.iter().map(|(id, p)| (id.clone(), p.name.clone())).collect();
                ps.sort();
                (s.lobby.clone(), ps)
            })
            .collect();
        out.sort();
        out
    }

    /// Handles one inbound text frame from a player. Malformed frames and stale connections are ignored.
    pub fn remote(&self, game_id: &str, player: &str, conn: u64, text: &str) {
        let Ok(frame) = serde_json::from_str::<Frame>(text) else { return };
        let mut map = self.lock();
        let Some(session) = map.get_mut(game_id) else { return };
        if session.players.get(player).map(|p| p.conn) != Some(conn) {
            return;
        }
        bus().publish(game_id, "in", json!({ "player": player, "name": frame.name, "data": frame.data }));
        let out = session.host.on_remote(player, &frame.name, &frame.data);
        session.deliver(game_id, out);
    }

    /// Runs the session's timers that are due at `now`, oldest first. Timers a handler schedules while
    /// running wait for a later tick, so a script cannot spin the loop with `ctx.after(0)`.
    pub fn tick(&self, game_id: &str, now: Instant) {
        let mut map = self.lock();
        let Some(session) = map.get_mut(game_id) else { return };
        let mut due: Vec<Timer> = Vec::new();
        let mut i = 0;
        while i < session.timers.len() {
            if session.timers[i].due <= now {
                due.push(session.timers.remove(i));
            } else {
                i += 1;
            }
        }
        due.sort_by_key(|t| t.due);
        for t in due {
            let out = session.host.on_timer(&t.tag, &t.data);
            session.deliver(game_id, out);
        }
        let out = session.host.poll();
        session.deliver(game_id, out);
    }

    /// The `(game id, lobby)` this player is connected to right now, if any (live sockets only; nothing is stored).
    pub fn game_of(&self, player: &str) -> Option<(String, String)> {
        self.lock().values().find(|s| s.players.contains_key(player)).map(|s| (s.game.clone(), s.lobby.clone()))
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

/// The `(game id, lobby)` this player is connected to right now, if any.
pub fn game_of(player: &str) -> Option<(String, String)> {
    registry().game_of(player)
}

/// Live lobbies of a game with their players (called by games.rs).
pub fn lobbies(game_id: &str) -> Vec<(String, Vec<(String, String)>)> {
    registry().lobbies(game_id)
}

/// Reloads every live lobby of the game onto a freshly published version (called by games.rs).
pub fn reload(game_id: &str, version: &GameVersion) {
    registry().reload(game_id, Release::from(version));
}

/// Ends every live lobby of a game that was just deleted (called by games.rs).
pub fn close(game_id: &str) {
    registry().close(game_id);
}

async fn play(
    State(state): State<AppState>,
    Path(game_id): Path<String>,
    uri: Uri,
    headers: HeaderMap,
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response {
    let Some(account) = accounts::authenticate_request(&headers, uri.query()) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if game_id.is_empty() || game_id.len() > MAX_GAME_ID_LEN {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let lobby = match accounts::query_param(uri.query(), "lobby") {
        None => OPEN_LOBBY.to_string(),
        Some(l) => match normalize_lobby(l) {
            Some(l) => l,
            None => return StatusCode::BAD_REQUEST.into_response(),
        },
    };
    let version = match accounts::query_param(uri.query(), "version") {
        None => None,
        Some(v) => match v.parse::<i32>() {
            Ok(n) if n >= 1 => Some(n),
            _ => return StatusCode::BAD_REQUEST.into_response(),
        },
    };
    let release = match &state.db {
        Some(pool) if valid_uuid(&game_id) => match db::fetch_game_version(pool, &game_id, version).await {
            Ok(found) => found.as_ref().map(Release::from),
            Err(e) => {
                eprintln!("play: fetch version: db error: {e}");
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
        },
        _ => None,
    };
    if version.is_some() && release.is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    match ws {
        Ok(ws) => ws
            .max_message_size(MAX_MESSAGE_BYTES)
            .on_upgrade(move |socket| run_socket(socket, session_key(&game_id, &lobby), account.id, account.display_name, release, HEARTBEAT)),
        Err(rej) => rej.into_response(),
    }
}

async fn run_socket(mut socket: WebSocket, game_id: String, player: String, name: String, release: Option<Release>, hb: Heartbeat) {
    let reg = registry();
    let (tx, mut rx) = unbounded_channel::<String>();
    let conn = reg.join_named(&game_id, &player, &name, tx, release);
    let mut ticker = tokio::time::interval(TICK);
    let mut pinger = tokio::time::interval(hb.ping);
    let mut last_seen = Instant::now();
    loop {
        tokio::select! {
            _ = ticker.tick() => reg.tick(&game_id, Instant::now()),
            _ = pinger.tick() => {
                if last_seen.elapsed() >= hb.idle || socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break; // silent socket (locked / backgrounded phone): free the slot
                }
            }
            out = rx.recv() => match out {
                Some(text) => {
                    if socket.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                None => break, // replaced by a newer connection
            },
            inc = socket.recv() => {
                last_seen = Instant::now();
                match inc {
                    Some(Ok(Message::Text(t))) => reg.remote(&game_id, &player, conn, t.as_str()),
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => {} // binary / ping / pong only refresh last_seen
                }
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
        fn on_timer(&mut self, tag: &str, data: &Value) -> Vec<Outgoing> {
            self.log.lock().unwrap().push(format!("timer:{tag}"));
            vec![Outgoing::FireAll { name: "fired".into(), data: data.clone() }]
        }
        fn set_player_name(&mut self, player: &str, name: &str) {
            self.log.lock().unwrap().push(format!("name:{player}:{name}"));
        }
        fn on_remote(&mut self, player: &str, name: &str, data: &Value) -> Vec<Outgoing> {
            self.log.lock().unwrap().push(format!("remote:{player}:{name}"));
            if name == "all" {
                vec![Outgoing::FireAll { name: "hit".into(), data: data.clone() }]
            } else if name == "arm" {
                vec![Outgoing::After { id: 7, ms: 100, tag: "t".into(), data: data.clone() }]
            } else if name == "disarm" {
                vec![Outgoing::Cancel { id: 7 }]
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
        let r = Registry::new(Box::new(move |_, _| Box::new(FakeHost { log: l.clone() })));
        (r, log)
    }

    fn player(r: &Registry, game: &str, id: &str) -> (u64, UnboundedReceiver<String>) {
        let (tx, rx) = unbounded_channel();
        (r.join(game, id, tx, None), rx)
    }

    fn drain(rx: &mut UnboundedReceiver<String>) -> Vec<Value> {
        let mut v = Vec::new();
        while let Ok(t) = rx.try_recv() {
            v.push(serde_json::from_str(&t).unwrap());
        }
        v
    }

    #[test]
    fn close_drops_the_session_and_ends_every_players_channel() {
        let (r, _log) = reg();
        let (_ca, mut a) = player(&r, "g", "a");
        let (_cb, mut b) = player(&r, "g", "b");
        let (_cc, mut other) = player(&r, "h", "c");
        drain(&mut a);
        drain(&mut b);
        r.close("g");
        assert_eq!(r.player_count("g"), 0);
        assert!(matches!(a.try_recv(), Err(tokio::sync::mpsc::error::TryRecvError::Disconnected)));
        assert!(matches!(b.try_recv(), Err(tokio::sync::mpsc::error::TryRecvError::Disconnected)));
        assert_eq!(r.player_count("h"), 1);
        drain(&mut other);
        r.close("g");
        r.close("nobody");
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

    #[test]
    fn timer_fires_once_when_due_and_can_be_cancelled() {
        let (r, log) = reg();
        let (ca, mut a) = player(&r, "g", "a");
        drain(&mut a);
        r.remote("g", "a", ca, r#"{"name":"arm","data":{"n":1}}"#);
        r.tick("g", Instant::now()); // not due yet (100 ms)
        assert!(drain(&mut a).is_empty());
        r.tick("g", Instant::now() + Duration::from_secs(1));
        assert_eq!(drain(&mut a), vec![json!({"name":"fired","data":{"n":1}})]);
        r.tick("g", Instant::now() + Duration::from_secs(2)); // one-shot
        assert!(drain(&mut a).is_empty());
        r.remote("g", "a", ca, r#"{"name":"arm"}"#);
        r.remote("g", "a", ca, r#"{"name":"disarm"}"#);
        r.tick("g", Instant::now() + Duration::from_secs(5));
        assert!(drain(&mut a).is_empty());
        assert_eq!(log.lock().unwrap().iter().filter(|l| *l == "timer:t").count(), 1);
    }

    #[test]
    fn join_named_sends_welcome_and_name_even_on_reconnect() {
        let (r, log) = reg();
        let (tx, mut rx) = unbounded_channel();
        r.join_named("g", "a", "Ada", tx, None);
        let got = drain(&mut rx);
        assert_eq!(got[0], json!({"name":"_welcome","data":{"id":"a","name":"Ada","lobby":"OPEN"}}));
        let (tx2, mut rx2) = unbounded_channel();
        r.join_named("g", "a", "Ada", tx2, None);
        assert_eq!(drain(&mut rx2)[0]["name"], "_welcome");
        assert!(log.lock().unwrap().contains(&"name:a:Ada".to_string()));
    }

    #[test]
    fn reload_drops_pending_timers() {
        let (r, _) = reg();
        let (ca, mut a) = player(&r, "g", "a");
        drain(&mut a);
        r.remote("g", "a", ca, r#"{"name":"arm"}"#);
        r.reload("g", Release { version: 2, sources: vec![] });
        drain(&mut a);
        r.tick("g", Instant::now() + Duration::from_secs(5));
        assert!(drain(&mut a).is_empty());
    }

    #[test]
    fn lobbies_of_one_game_are_isolated_and_listed() {
        let (r, _) = reg();
        let (ca, mut a) = player(&r, &session_key("g", "AB12"), "a");
        let (_cb, mut b) = player(&r, &session_key("g", "ZZ99"), "b");
        let (_cc, _c) = player(&r, &session_key("h", "AB12"), "c");
        drain(&mut a);
        drain(&mut b);
        r.remote(&session_key("g", "AB12"), "a", ca, r#"{"name":"all","data":1}"#);
        assert_eq!(drain(&mut a).len(), 1);
        assert!(drain(&mut b).is_empty());
        assert_eq!(
            r.lobbies("g"),
            vec![
                ("AB12".to_string(), vec![("a".to_string(), String::new())]),
                ("ZZ99".to_string(), vec![("b".to_string(), String::new())]),
            ]
        );
        assert_eq!(r.game_of("b"), Some(("g".to_string(), "ZZ99".to_string())));
        assert!(r.lobbies("nope").is_empty());
    }

    #[test]
    fn reload_and_close_hit_every_lobby_of_the_game() {
        let (r, _) = reg();
        let (_ca, mut a) = player(&r, &session_key("g", "AB12"), "a");
        let (_cb, mut b) = player(&r, &session_key("g", "OPEN"), "b");
        let (_cc, mut c) = player(&r, &session_key("h", "OPEN"), "c");
        drain(&mut a);
        drain(&mut b);
        drain(&mut c);
        r.reload("g", Release { version: 2, sources: vec![] });
        let reloaded = |v: Vec<Value>| v.iter().any(|f| f["name"] == "_reload");
        assert!(reloaded(drain(&mut a)));
        assert!(reloaded(drain(&mut b)));
        assert!(!reloaded(drain(&mut c)));
        r.close("g");
        assert!(r.lobbies("g").is_empty());
        assert!(matches!(a.try_recv(), Err(tokio::sync::mpsc::error::TryRecvError::Disconnected)));
        assert!(matches!(b.try_recv(), Err(tokio::sync::mpsc::error::TryRecvError::Disconnected)));
        assert_eq!(r.lobbies("h").len(), 1);
    }

    #[test]
    fn lobby_codes_normalize_and_validate() {
        assert_eq!(normalize_lobby("ab12c").as_deref(), Some("AB12C"));
        assert_eq!(normalize_lobby("abc"), None);
        assert_eq!(normalize_lobby("abcdefghi"), None);
        assert_eq!(normalize_lobby("ab-12"), None);
    }

    /// A client that connects and then never reads (so never answers pings) is dropped and its player
    /// leaves; a client that keeps writing stays.
    #[tokio::test]
    async fn heartbeat_drops_a_silent_socket() {
        use futures_util::{SinkExt, StreamExt};
        let hb = Heartbeat { ping: Duration::from_millis(50), idle: Duration::from_millis(300) };
        async fn upgrade(ws: WebSocketUpgrade, Path(id): Path<String>, State(hb): State<Heartbeat>) -> Response {
            ws.on_upgrade(move |s| run_socket(s, session_key("hbgame", "BEAT"), id, "n".into(), None, hb))
        }
        let app = Router::new().route("/t/{id}", get(upgrade)).with_state(hb);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let (silent, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/t/silent")).await.unwrap();
        let (mut live, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/t/live")).await.unwrap();
        let reg = registry();
        for _ in 0..40 {
            if reg.lobbies("hbgame").first().is_some_and(|l| l.1.len() == 2) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(reg.lobbies("hbgame")[0].1.len(), 2);
        let keepalive = tokio::spawn(async move {
            loop {
                let _ = live.send(tokio_tungstenite::tungstenite::Message::Ping(Vec::new().into())).await;
                tokio::select! {
                    _ = live.next() => {}
                    _ = tokio::time::sleep(Duration::from_millis(50)) => {}
                }
            }
        });
        let mut left = false;
        for _ in 0..60 {
            if reg.lobbies("hbgame")[0].1.len() == 1 {
                left = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        keepalive.abort();
        drop(silent); // held open until here: never polled, so it never answered a ping
        assert!(left, "silent socket should have been dropped");
        assert_eq!(reg.lobbies("hbgame")[0].1, vec![("live".to_string(), "n".to_string())]);
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
