// Embedded JS engine (rquickjs) running a game's server scripts. Implements `session::ScriptHost`
// with the same `serverScript` API as Packages/PearScript `ServerScriptEngine.swift`:
// `onPlayerJoin(ctx, player)`, `onPlayerLeave(ctx, player)`, `onRemote(ctx, player, name, data)`,
// `ctx.state` (persists for the session), `ctx.remote.fire(playerId, name, data)` / `fireAll(name, data)`.
// Scripts see only `ctx`: no file, network or input access (QuickJS has no host I/O by default).
//
// [provisional: needs-tien-review] design choices:
// - rquickjs 0.9 with its `parallel` feature so a host is `Send` (required by `ScriptHost`).
// - prelude.js is shared with the Swift engine via `include_str!` (one `serverScript` definition check).
// - Script errors (load, handler, timeout, memory) are contained and kept in `errors()`; never a panic.
// - Each call has a 1 s CPU deadline and the runtime has a 32 MiB heap / 1 MiB stack cap.
// - Server-script sources are not stored anywhere reachable yet (publish/fetch is a later item), so
//   `factory()` currently yields `NoopHost` for every game; `factory_with` takes a source lookup.
// - `ctx.agent.run(prompt)` returns a Promise<string> (agent_run.rs). The call runs in a spawned task; the
//   session tick calls `poll()`, which settles finished calls and runs the promise jobs (so `await` works
//   in handlers). Needs a tokio runtime: without one the call rejects.
// - 8.1: that is superseded. `factory()` now builds the host from the sources session.rs fetched from
//   the game's published version. `console.log/warn/error` in scripts and handler errors are captured
//   (capped, truncated) and published to the debug bus (debug.rs) with `ctx.state` after each handler.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rquickjs::{Context, Function, Object, Runtime};
use serde_json::{json, Value};

use super::agent_run::{self, AgentConfig, AgentTarget};
use super::debug::bus;
use super::session::{HostFactory, NoopHost, Outgoing, ScriptHost};

const PRELUDE: &str = include_str!("../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js");
const CALL_DEADLINE: Duration = Duration::from_secs(1);
const MEMORY_LIMIT: usize = 32 * 1024 * 1024;
const STACK_LIMIT: usize = 1024 * 1024;
const MAX_ERRORS: usize = 100;
const MAX_PENDING: usize = 100; // console/error events kept between two debug publishes
const MAX_LOG_CHARS: usize = 2000;
type AgentOutcome = (u64, Result<String, String>);
const MAX_JOBS: usize = 10_000; // promise jobs run after one handler or poll

const GLUE: &str = r#"
(function (fire, fireAll, report, log, after, cancel, meta) {
  var lobby = meta.lobby;
  var agentRun = meta.agentRun;
  "use strict";
  var scripts = [];
  var state = {};
  function show(value) {
    if (typeof value === "string") { return value; }
    try { var text = JSON.stringify(value); return text === undefined ? String(value) : text; }
    catch (e) { return String(value); }
  }
  function logger(level) {
    return function () { log(level, Array.prototype.map.call(arguments, show).join(" ")); };
  }
  globalThis.console = Object.freeze({ log: logger("log"), warn: logger("warn"), error: logger("error") });
  function encode(value) {
    var text = JSON.stringify(value);
    return text === undefined ? "null" : text;
  }
  var remote = Object.freeze({
    fire: function (playerId, name, data) { fire(String(playerId), String(name), encode(data)); },
    fireAll: function (name, data) { fireAll(String(name), encode(data)); }
  });
  var names = {};
  var nextTimer = 1;
  var pending = [];
  var seen = [];
  var phases = {};
  var phase = null;
  var PLAYER_KEY = "__pearPlayer";
  function canon(v) {
    if (v === null || typeof v !== "object") { return JSON.stringify(v); }
    if (Array.isArray(v)) { return "[" + v.map(canon).join(",") + "]"; }
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }
  function touch(playerId) {
    for (var i = 0; i < seen.length; i++) { if (seen[i].id === playerId) { seen[i].lastSeen = Date.now(); return; } }
    seen.push({ id: playerId, lastSeen: Date.now() });
  }
  var agentCalls = {};
  var nextAgentCall = 1;
  var agent = Object.freeze({
    run: function (prompt) {
      return new Promise(function (resolve, reject) {
        var id = nextAgentCall++;
        agentCalls[id] = { resolve: resolve, reject: reject };
        agentRun(id, String(prompt));
      });
    }
  });
  var ctx = Object.freeze({
    state: state,
    agent: agent,
    remote: remote,
    lobby: String(lobby),
    now: function () { return Date.now(); },
    players: function () {
      return seen.map(function (p) { return { id: p.id, name: names[p.id] || "", lastSeen: p.lastSeen }; });
    },
    enterPhase: function (name) {
      var at = Date.now();
      phase = String(name);
      phases[phase] = at;
      return at;
    },
    phaseEnteredAt: function (name) {
      var key = name === undefined || name === null ? phase : String(name);
      return key !== null && Object.prototype.hasOwnProperty.call(phases, key) ? phases[key] : null;
    },
    after: function (ms, tag, data, playerId) {
      var id = nextTimer++;
      var player = playerId === undefined || playerId === null ? null : String(playerId);
      var wire = player === null ? encode(data) : encode(Object.fromEntries([[PLAYER_KEY, { p: player, d: data === undefined ? null : data }]]));
      pending.push({ id: id, tag: String(tag), key: canon(JSON.parse(wire)), player: player });
      after(id, Number(ms) || 0, String(tag), wire);
      return id;
    },
    cancel: function (id) {
      id = Number(id);
      for (var i = 0; i < pending.length; i++) {
        if (pending[i].id === id) { pending.splice(i, 1); cancel(id); return true; }
      }
      return false;
    }
  });
  globalThis.__pearHost = {
    add: function (definition) { scripts.push(definition); },
    setName: function (playerId, name) { names[playerId] = String(name); },
    stateJSON: function () { return encode(state); },
    agentDone: function (id, error, text) {
      var call = agentCalls[id];
      delete agentCalls[id];
      if (!call) { return; }
      if (error) { call.reject(new Error(error)); } else { call.resolve(text); }
    },
    dispatch: function (handler, playerId, name, dataJson) {
      var args = [ctx, Object.freeze({ id: playerId, name: names[playerId] || "" })];
      var data = null;
      if (handler === "onRemote" || handler === "onTimer") {
        try { data = JSON.parse(dataJson); } catch (e) { data = null; }
      }
      if (handler === "onPlayerJoin" || handler === "onRemote") { touch(playerId); }
      if (handler === "onPlayerLeave") {
        seen = seen.filter(function (p) { return p.id !== playerId; });
      }
      if (handler === "onRemote") { args.push(name, data); }
      else if (handler === "onTimer") {
        var key = canon(data);
        var fired = null;
        for (var i = 0; i < pending.length; i++) {
          if (pending[i].tag === name && pending[i].key === key) { fired = pending.splice(i, 1)[0]; break; }
        }
        args = [ctx, name, data];
        if (fired && fired.player !== null) { args = [ctx, name, data[PLAYER_KEY].d, fired.player]; }
      }
      scripts.forEach(function (script) {
        if (typeof script[handler] !== "function") { return; }
        try {
          var result = script[handler].apply(script, args);
          if (result && typeof result.then === "function") {
            result.then(null, function (e) { report(handler + ": " + String(e)); });
          }
        } catch (e) { report(handler + ": " + String(e)); }
      });
      if (handler === "onPlayerLeave") {
        pending.filter(function (t) { return t.player === playerId; }).forEach(function (t) { ctx.cancel(t.id); });
      }
    }
  };
})
"#;

/// Server scripts of one game session in one QuickJS context sharing one `ctx.state`.
pub struct QuickJsHost {
    // Field order: context before runtime so it drops first.
    context: Context,
    _runtime: Runtime,
    out: Arc<Mutex<Vec<Outgoing>>>,
    errors: Arc<Mutex<Vec<String>>>,
    deadline: Arc<Mutex<Option<Instant>>>,
    game_id: String,
    /// Debug events (kind, fields) captured since the last publish.
    pending: Arc<Mutex<Vec<(&'static str, Value)>>>,
    last_state: String,
    agent: Arc<Mutex<AgentConfig>>,
    /// Finished `ctx.agent.run` calls (call id, reply or error) waiting for `poll`.
    agent_done: Arc<Mutex<Vec<AgentOutcome>>>,
}

fn push_error(errors: &Mutex<Vec<String>>, pending: &Mutex<Vec<(&'static str, Value)>>, msg: String) {
    let mut e = errors.lock().unwrap_or_else(|p| p.into_inner());
    if e.len() < MAX_ERRORS {
        e.push(msg.clone());
    }
    drop(e);
    push_pending(pending, "error", json!({ "msg": msg }));
}

fn push_pending(pending: &Mutex<Vec<(&'static str, Value)>>, kind: &'static str, mut fields: Value) {
    if let Some(Value::String(msg)) = fields.get_mut("msg") {
        if let Some((i, _)) = msg.char_indices().nth(MAX_LOG_CHARS) {
            msg.truncate(i);
        }
    }
    let mut p = pending.lock().unwrap_or_else(|p| p.into_inner());
    if p.len() < MAX_PENDING {
        p.push((kind, fields));
    }
}

/// Offset in `line` just past a line-leading `export default `, if it has one.
fn export_default_body_at(line: &str) -> Option<usize> {
    let after_export = line.trim_start().strip_prefix("export")?;
    let after_ws = after_export.trim_start();
    let after_default = after_ws.strip_prefix("default")?;
    let body = after_default.trim_start();
    // each keyword must be followed by whitespace (regex `\s+`)
    (after_ws.len() < after_export.len() && body.len() < after_default.len()).then(|| line.len() - body.len())
}

/// Turns the first line-leading `export default X;` into `__pearExportDefault(X);` (see prelude.js),
/// keeping what precedes it (comments). Same rule as the client engines' `^\s*export\s+default\s+`;
/// shortcut: `export` and `default` must share a line, upgrade if a script splits them.
fn rewrite_export_default(source: &str) -> String {
    let mut offset = 0;
    for line in source.split_inclusive('\n') {
        if let Some(at) = export_default_body_at(line) {
            let body = source[offset + at..].trim_end_matches(|c: char| c == ';' || c.is_whitespace());
            return format!("{}__pearExportDefault({body}\n);", &source[..offset]);
        }
        offset += line.len();
    }
    source.to_string()
}

impl QuickJsHost {
    /// Builds a host for `game_id` (debug events go to that game's stream) and loads every source in
    /// order. Fails on engine setup or a script that does not compile or
    /// `export default serverScript({...})`.
    pub fn new(game_id: &str, sources: &[String]) -> Result<Self, String> {
        let runtime = Runtime::new().map_err(|e| e.to_string())?;
        runtime.set_memory_limit(MEMORY_LIMIT);
        runtime.set_max_stack_size(STACK_LIMIT);
        let deadline: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
        let d = deadline.clone();
        runtime.set_interrupt_handler(Some(Box::new(move || {
            let g = d.lock().unwrap_or_else(|p| p.into_inner());
            g.is_some_and(|t| Instant::now() > t)
        })));
        let context = Context::full(&runtime).map_err(|e| e.to_string())?;
        let out = Arc::new(Mutex::new(Vec::new()));
        let errors = Arc::new(Mutex::new(Vec::new()));
        let host = QuickJsHost {
            context,
            _runtime: runtime,
            out,
            errors,
            deadline,
            game_id: game_id.to_string(),
            pending: Arc::new(Mutex::new(Vec::new())),
            last_state: "{}".to_string(),
            agent: Arc::new(Mutex::new(AgentConfig::from_env())),
            agent_done: Arc::new(Mutex::new(Vec::new())),
        };
        host.bootstrap()?;
        for s in sources {
            host.load(s)?;
        }
        Ok(host)
    }

    fn arm(&self) {
        *self.deadline.lock().unwrap_or_else(|p| p.into_inner()) = Some(Instant::now() + CALL_DEADLINE);
    }

    fn bootstrap(&self) -> Result<(), String> {
        self.arm();
        let out = self.out.clone();
        let out2 = self.out.clone();
        let out3 = self.out.clone();
        let out4 = self.out.clone();
        let errors = self.errors.clone();
        let pending = self.pending.clone();
        let pending2 = self.pending.clone();
        let agent = self.agent.clone();
        let agent_done = self.agent_done.clone();
        let game_id = self.game_id.clone();
        // session key is "<game>/<LOBBY>"; a bare id (tests, older callers) is the default lobby
        let lobby = game_id.rsplit_once('/').map_or("OPEN", |(_, l)| l).to_string();
        self.context.with(|ctx| {
            let fail = |e: rquickjs::Error| format!("{e}");
            ctx.eval::<(), _>(PRELUDE).map_err(fail)?;
            let fire = Function::new(ctx.clone(), move |player: String, name: String, data: String| {
                let data = serde_json::from_str(&data).unwrap_or(Value::Null);
                out.lock().unwrap_or_else(|p| p.into_inner()).push(Outgoing::Fire { player, name, data });
            })
            .map_err(fail)?;
            let fire_all = Function::new(ctx.clone(), move |name: String, data: String| {
                let data = serde_json::from_str(&data).unwrap_or(Value::Null);
                out2.lock().unwrap_or_else(|p| p.into_inner()).push(Outgoing::FireAll { name, data });
            })
            .map_err(fail)?;
            let report = Function::new(ctx.clone(), move |msg: String| push_error(&errors, &pending, msg))
                .map_err(fail)?;
            let log = Function::new(ctx.clone(), move |level: String, msg: String| {
                let level = match level.as_str() {
                    "warn" => "warn",
                    "error" => "error",
                    _ => "log",
                };
                push_pending(&pending2, "log", json!({ "level": level, "msg": msg }));
            })
            .map_err(fail)?;
            let after = Function::new(ctx.clone(), move |id: f64, ms: f64, tag: String, data: String| {
                let data = serde_json::from_str(&data).unwrap_or(Value::Null);
                // ms is clamped to the session's limits where the timer is stored (session.rs)
                out3.lock().unwrap_or_else(|p| p.into_inner()).push(Outgoing::After { id: id as u64, ms: ms.max(0.0) as u64, tag, data });
            })
            .map_err(fail)?;
            let cancel = Function::new(ctx.clone(), move |id: f64| {
                out4.lock().unwrap_or_else(|p| p.into_inner()).push(Outgoing::Cancel { id: id as u64 });
            })
            .map_err(fail)?;
            let agent_run = Function::new(ctx.clone(), move |id: f64, prompt: String| {
                let id = id as u64;
                let config = agent.lock().unwrap_or_else(|p| p.into_inner()).clone();
                let finish = {
                    let agent_done = agent_done.clone();
                    move |result: Result<String, String>| agent_done.lock().unwrap_or_else(|p| p.into_inner()).push((id, result))
                };
                match (agent_run::admit(&config, &game_id, &prompt), tokio::runtime::Handle::try_current()) {
                    (Err(e), _) => finish(Err(e)),
                    (Ok(_), Err(_)) => finish(Err("agent runtime unavailable (no async runtime)".to_string())),
                    (Ok(target), Ok(rt)) => {
                        let game_id = game_id.clone();
                        rt.spawn(async move { finish(agent_run::run(&target, &game_id, &prompt, config.timeout).await) });
                    }
                }
            })
            .map_err(fail)?;
            let glue: Function = ctx.eval(GLUE).map_err(fail)?;
            let meta = Object::new(ctx.clone()).map_err(fail)?;
            meta.set("lobby", lobby).map_err(fail)?;
            meta.set("agentRun", agent_run).map_err(fail)?;
            glue.call::<_, ()>((fire, fire_all, report, log, after, cancel, meta)).map_err(fail)?;
            Ok(())
        })
    }

    fn load(&self, source: &str) -> Result<(), String> {
        self.arm();
        let src = rewrite_export_default(source);
        self.context.with(|ctx| {
            let describe = |e: rquickjs::Error| match e {
                rquickjs::Error::Exception => format!("{:?}", ctx.catch()),
                other => other.to_string(),
            };
            ctx.eval::<(), _>(src).map_err(describe)?;
            let globals = ctx.globals();
            let take: Function = globals.get("__pearTakeDefault").map_err(describe)?;
            let def: rquickjs::Value = take.call(()).map_err(describe)?;
            if !def.is_object() {
                return Err("script does not export default serverScript({...})".to_string());
            }
            let host: Object = globals.get("__pearHost").map_err(describe)?;
            let add: Function = host.get("add").map_err(describe)?;
            add.call::<_, ()>((def,)).map_err(describe)
        })
    }

    fn dispatch(&mut self, handler: &str, player: &str, name: &str, data: &Value) -> Vec<Outgoing> {
        self.arm();
        let data_json = serde_json::to_string(data).unwrap_or_else(|_| "null".into());
        let errors = self.errors.clone();
        let pending = self.pending.clone();
        self.context.with(|ctx| {
            let res: rquickjs::Result<()> = (|| {
                let host: Object = ctx.globals().get("__pearHost")?;
                let f: Function = host.get("dispatch")?;
                f.call((handler, player, name, data_json))
            })();
            if let Err(e) = res {
                let msg = match e {
                    rquickjs::Error::Exception => format!("{handler}: {:?}", ctx.catch()),
                    other => format!("{handler}: {other}"),
                };
                push_error(&errors, &pending, msg);
            }
        });
        self.finish()
    }

    /// Runs promise jobs (async handler continuations), publishes debug events, disarms the deadline
    /// and returns what the scripts sent out.
    fn finish(&mut self) -> Vec<Outgoing> {
        for _ in 0..MAX_JOBS {
            match self._runtime.execute_pending_job() {
                Ok(true) => {}
                Ok(false) => break,
                Err(_) => {
                    let msg = self.context.with(|ctx| format!("{:?}", ctx.catch()));
                    push_error(&self.errors, &self.pending, format!("job: {msg}"));
                }
            }
        }
        self.publish_debug();
        *self.deadline.lock().unwrap_or_else(|p| p.into_inner()) = None;
        std::mem::take(&mut *self.out.lock().unwrap_or_else(|p| p.into_inner()))
    }

    /// Test hook: where `ctx.agent.run` calls go (None = not configured) and its time cap.
    pub fn set_agent_runtime(&self, target: Option<AgentTarget>, timeout: Duration) {
        *self.agent.lock().unwrap_or_else(|p| p.into_inner()) = AgentConfig { target, timeout };
    }

    /// Sends captured logs/errors and, when it changed, `ctx.state` to the game's debug stream.
    fn publish_debug(&mut self) {
        let events = std::mem::take(&mut *self.pending.lock().unwrap_or_else(|p| p.into_inner()));
        for (kind, fields) in events {
            bus().publish(&self.game_id, kind, fields);
        }
        let state = self.state_json();
        if state != self.last_state {
            let parsed = serde_json::from_str(&state).unwrap_or(Value::Null);
            bus().publish(&self.game_id, "state", json!({ "state": parsed }));
            self.last_state = state;
        }
    }

    /// `ctx.state` as JSON text, for tests and diagnostics.
    pub fn state_json(&self) -> String {
        self.arm();
        let s = self.context.with(|ctx| {
            let host: Object = ctx.globals().get("__pearHost").ok()?;
            let f: Function = host.get("stateJSON").ok()?;
            f.call::<_, String>(()).ok()
        });
        s.unwrap_or_else(|| "{}".to_string())
    }

    /// Errors contained so far (handler exceptions, timeouts), capped at 100.
    #[allow(dead_code)] // diagnostics; used by tests
    pub fn errors(&self) -> Vec<String> {
        self.errors.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
}

impl ScriptHost for QuickJsHost {
    fn on_player_join(&mut self, player: &str) -> Vec<Outgoing> {
        self.dispatch("onPlayerJoin", player, "", &Value::Null)
    }
    fn on_player_leave(&mut self, player: &str) -> Vec<Outgoing> {
        self.dispatch("onPlayerLeave", player, "", &Value::Null)
    }
    fn on_remote(&mut self, player: &str, name: &str, data: &Value) -> Vec<Outgoing> {
        self.dispatch("onRemote", player, name, data)
    }
    fn on_timer(&mut self, tag: &str, data: &Value) -> Vec<Outgoing> {
        self.dispatch("onTimer", "", tag, data)
    }
    fn poll(&mut self) -> Vec<Outgoing> {
        let done = std::mem::take(&mut *self.agent_done.lock().unwrap_or_else(|p| p.into_inner()));
        if done.is_empty() {
            return Vec::new();
        }
        self.arm();
        let errors = self.errors.clone();
        let pending = self.pending.clone();
        self.context.with(|ctx| {
            for (id, result) in done {
                let (error, text) = match result {
                    Ok(text) => (String::new(), text),
                    Err(error) => (error, String::new()),
                };
                let res: rquickjs::Result<()> = (|| {
                    let host: Object = ctx.globals().get("__pearHost")?;
                    let f: Function = host.get("agentDone")?;
                    f.call((id as f64, error, text))
                })();
                if let Err(e) = res {
                    push_error(&errors, &pending, format!("agent: {e}"));
                }
            }
        });
        self.finish()
    }
    fn set_player_name(&mut self, player: &str, name: &str) {
        self.arm();
        self.context.with(|ctx| {
            let host: Option<Object> = ctx.globals().get("__pearHost").ok();
            let set: Option<Function> = host.and_then(|h| h.get("setName").ok());
            if let Some(set) = set {
                let _ = set.call::<_, ()>((player, name));
            }
        });
    }
}

/// Server-script sources of a published version: the string values of `server_scripts`, in key order.
pub fn sources_of(server_scripts: &Value) -> Vec<String> {
    let Some(files) = server_scripts.as_object() else { return Vec::new() };
    files.values().filter_map(|v| v.as_str().map(str::to_string)).collect()
}

/// Factory for the global registry: builds the game's host from the sources the session fetched.
/// No sources, or sources that fail to load, give a `NoopHost` so a bad script never takes the
/// session down; a load failure is reported on the game's debug stream.
pub fn factory() -> HostFactory {
    Box::new(|game_id, sources| {
        if sources.is_empty() {
            return Box::new(NoopHost);
        }
        match QuickJsHost::new(game_id, sources) {
            Ok(h) => Box::new(h),
            Err(e) => {
                eprintln!("script load failed for game {game_id}: {e}");
                bus().publish(game_id, "error", json!({ "msg": format!("load: {e}") }));
                Box::new(NoopHost)
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SCRIPT: &str = r#"export default serverScript({
      onPlayerJoin(ctx, player) {
        ctx.state.health = ctx.state.health || {};
        ctx.state.health[player.id] = 100;
        ctx.remote.fire(player.id, "welcome", { hp: 100 });
      },
      onPlayerLeave(ctx, player) { delete ctx.state.health[player.id]; },
      onRemote(ctx, player, name, data) {
        if (name === "punch") ctx.remote.fireAll("hit", { from: player.id, dir: data.dir });
        if (name === "boom") throw new Error("bad");
        if (name === "spin") { for (;;) {} }
      },
    });"#;

    fn host() -> QuickJsHost {
        QuickJsHost::new("test", &[SCRIPT.to_string()]).expect("loads")
    }

    #[test]
    fn join_fires_and_state_persists_then_leave() {
        let mut h = host();
        let out = h.on_player_join("a");
        assert_eq!(out, vec![Outgoing::Fire { player: "a".into(), name: "welcome".into(), data: json!({"hp":100}) }]);
        h.on_player_join("b");
        assert_eq!(serde_json::from_str::<Value>(&h.state_json()).unwrap(), json!({"health":{"a":100,"b":100}}));
        h.on_player_leave("a");
        assert_eq!(serde_json::from_str::<Value>(&h.state_json()).unwrap(), json!({"health":{"b":100}}));
    }

    #[test]
    fn remote_in_fire_all_out() {
        let mut h = host();
        let out = h.on_remote("a", "punch", &json!({"dir":[1,0,0]}));
        assert_eq!(out, vec![Outgoing::FireAll { name: "hit".into(), data: json!({"from":"a","dir":[1,0,0]}) }]);
    }

    #[test]
    fn handler_errors_are_contained() {
        let mut h = host();
        assert!(h.on_remote("a", "boom", &Value::Null).is_empty());
        assert_eq!(h.errors().len(), 1);
        // still alive afterwards
        assert_eq!(h.on_remote("a", "punch", &json!({"dir":0})).len(), 1);
    }

    #[test]
    fn infinite_loop_times_out_without_panic() {
        let mut h = host();
        assert!(h.on_remote("a", "spin", &Value::Null).is_empty());
        assert!(!h.errors().is_empty());
        assert_eq!(h.on_remote("a", "punch", &json!({"dir":0})).len(), 1);
    }

    #[test]
    fn sandbox_has_no_io_and_ctx_is_only_state_and_remote() {
        let probe = r#"export default serverScript({
          onRemote(ctx, player, name, data) {
            ctx.remote.fireAll("probe", {
              io: [typeof require, typeof fetch, typeof std, typeof os, typeof XMLHttpRequest, typeof process],
              keys: Object.keys(ctx).sort(),
              frozen: Object.isFrozen(ctx),
            });
          },
        });"#;
        let mut h = QuickJsHost::new("test", &[probe.to_string()]).unwrap();
        let out = h.on_remote("a", "x", &Value::Null);
        let Outgoing::FireAll { data, .. } = &out[0] else { panic!("expected FireAll") };
        assert_eq!(data["io"], json!(vec!["undefined"; 6]));
        assert_eq!(data["keys"], json!(["after", "agent", "cancel", "enterPhase", "lobby", "now", "phaseEnteredAt", "players", "remote", "state"]));
        assert_eq!(data["frozen"], json!(true));
    }

    #[test]
    fn after_and_cancel_are_queued_and_on_timer_receives_tag_and_data() {
        let src = r#"export default serverScript({
          onRemote(ctx, player, name) {
            if (name === "arm") { ctx.state.id = ctx.after(1000, "boom", { n: 1 }); ctx.state.later = ctx.after(2000, "x"); }
            if (name === "disarm") ctx.cancel(ctx.state.later);
          },
          onTimer(ctx, tag, data) { ctx.state.fired = [tag, data]; },
        });"#;
        let mut h = QuickJsHost::new("test", &[src.to_string()]).unwrap();
        let out = h.on_remote("a", "arm", &Value::Null);
        assert_eq!(out[0], Outgoing::After { id: 1, ms: 1000, tag: "boom".into(), data: json!({"n":1}) });
        assert_eq!(out[1], Outgoing::After { id: 2, ms: 2000, tag: "x".into(), data: Value::Null });
        assert_eq!(h.on_remote("a", "disarm", &Value::Null), vec![Outgoing::Cancel { id: 2 }]);
        h.on_timer("boom", &json!({"n":1}));
        assert_eq!(serde_json::from_str::<Value>(&h.state_json()).unwrap()["fired"], json!(["boom", {"n":1}]));
    }

    #[test]
    fn player_has_a_name_after_set_player_name() {
        let src = "export default serverScript({ onPlayerJoin(ctx, p) { ctx.state.who = [p.id, p.name]; } });";
        let mut h = QuickJsHost::new("test", &[src.to_string()]).unwrap();
        h.set_player_name("a", "Ada");
        h.on_player_join("a");
        assert_eq!(serde_json::from_str::<Value>(&h.state_json()).unwrap()["who"], json!(["a", "Ada"]));
    }

    #[test]
    fn bad_sources_fail_to_load() {
        assert!(QuickJsHost::new("test", &["export default serverScript({ onNope() {} });".into()]).is_err());
        assert!(QuickJsHost::new("test", &["export default (".into()]).is_err());
        assert!(QuickJsHost::new("test", &["var x = 1;".into()]).is_err());
    }

    #[test]
    fn multiple_scripts_share_state_in_load_order() {
        let a = "export default serverScript({ onPlayerJoin(ctx, p) { ctx.state.n = 1; } });";
        let b = "export default serverScript({ onPlayerJoin(ctx, p) { ctx.state.n += 1; } });";
        let mut h = QuickJsHost::new("test", &[a.into(), b.into()]).unwrap();
        h.on_player_join("a");
        assert_eq!(serde_json::from_str::<Value>(&h.state_json()).unwrap(), json!({"n":2}));
    }

    #[test]
    fn factory_falls_back_to_noop() {
        let f = factory();
        assert_eq!(f("good", &[SCRIPT.to_string()]).on_player_join("a").len(), 1);
        assert!(f("bad", &["(".to_string()]).on_player_join("a").is_empty());
        assert!(f("none", &[]).on_player_join("a").is_empty());
    }

    #[test]
    fn sources_come_from_string_values_in_key_order() {
        let v = json!({"b.js": "two", "a.js": "one", "n": 3});
        assert_eq!(sources_of(&v), ["one", "two"]);
        assert!(sources_of(&json!([1])).is_empty());
    }

    #[test]
    fn flagship_server_script_loads_unmodified_and_round_is_won() {
        let src = include_str!("../../../Games/Flagship/scripts/game.js");
        let mut h = QuickJsHost::new("flagship-test", &[src.to_string()]).expect("flagship script loads");
        h.on_player_join("p1");
        let mut last = Vec::new();
        for enemy in ["WraithLeft", "WraithRight", "WraithAhead"] {
            last = h.on_remote("p1", "banish", &json!({ "enemy": enemy }));
        }
        assert!(last.contains(&Outgoing::FireAll {
            name: "round".into(),
            data: json!({ "state": "won", "scores": { "p1": 3 } }),
        }));
        let state: Value = serde_json::from_str(&h.state_json()).unwrap();
        assert_eq!(state["over"], json!(true));
        assert_eq!(state["score"], json!({ "p1": 3 }));
        assert!(h.errors().is_empty());
    }

    #[test]
    fn leading_comments_before_export_default_load() {
        let src = "// line comment\n/* block\n   comment */\n  export default serverScript({ onPlayerJoin(ctx, p) { ctx.state.ok = true; } });\n";
        let mut h = QuickJsHost::new("test", &[src.to_string()]).expect("loads");
        h.on_player_join("a");
        assert_eq!(serde_json::from_str::<Value>(&h.state_json()).unwrap(), json!({"ok":true}));
    }

    #[test]
    fn load_failure_is_in_a_later_debug_snapshot() {
        let game = "script-host-load-failure-test";
        assert!(factory()(game, &["(".to_string()]).on_player_join("a").is_empty());
        let (_sub, snap) = bus().subscribe(game); // connects after the failure, before any join
        let logs = snap["logs"].as_array().unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["kind"], "error");
        assert!(logs[0]["msg"].as_str().unwrap().starts_with("load: "));
        bus().end(game);
    }

    #[test]
    fn console_logs_errors_and_state_reach_the_debug_bus() {
        let game = "script-host-debug-test";
        bus().publish(game, "join", json!({"player": "a"})); // opens the game's debug entry
        let src = r#"export default serverScript({
          onPlayerJoin(ctx, player) {
            console.log("hi", { n: 1 });
            console.warn("careful");
            console.error("bad");
            ctx.state.joined = player.id;
          },
          onRemote() { for (let i = 0; i < 50; i++) console.log("spam" + i); throw new Error("boom"); },
        });"#;
        let mut h = QuickJsHost::new(game, &[src.to_string()]).unwrap();
        h.on_player_join("a");
        h.on_remote("a", "x", &Value::Null);
        let (_sub, snap) = bus().subscribe(game);
        assert_eq!(snap["state"], json!({"joined": "a"}));
        let logs = snap["logs"].as_array().unwrap();
        assert_eq!(logs[0]["msg"], "hi {\"n\":1}");
        assert_eq!((logs[1]["level"].clone(), logs[2]["level"].clone()), (json!("warn"), json!("error")));
        assert_eq!(logs[3]["msg"], "spam0");
        assert_eq!(logs.len(), 54); // 3 + 50 spam + the "boom" error
        assert_eq!(logs[53]["kind"], "error");
        bus().end(game);
    }
}
