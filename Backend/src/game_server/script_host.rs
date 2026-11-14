// Embedded JS engine (rquickjs) running a game's server scripts. Implements `session::ScriptHost`
// with the same `serverScript` API as Packages/OmniScript `ServerScriptEngine.swift`:
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

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rquickjs::{Context, Function, Object, Runtime};
use serde_json::Value;

use super::session::{HostFactory, NoopHost, Outgoing, ScriptHost};

const PRELUDE: &str = include_str!("../../../Packages/OmniScript/Sources/OmniScript/Resources/prelude.js");
const CALL_DEADLINE: Duration = Duration::from_secs(1);
const MEMORY_LIMIT: usize = 32 * 1024 * 1024;
const STACK_LIMIT: usize = 1024 * 1024;
const MAX_ERRORS: usize = 100;

const GLUE: &str = r#"
(function (fire, fireAll, report) {
  "use strict";
  var scripts = [];
  var state = {};
  function encode(value) {
    var text = JSON.stringify(value);
    return text === undefined ? "null" : text;
  }
  var remote = Object.freeze({
    fire: function (playerId, name, data) { fire(String(playerId), String(name), encode(data)); },
    fireAll: function (name, data) { fireAll(String(name), encode(data)); }
  });
  var ctx = Object.freeze({ state: state, remote: remote });
  globalThis.__omniHost = {
    add: function (definition) { scripts.push(definition); },
    stateJSON: function () { return encode(state); },
    dispatch: function (handler, playerId, name, dataJson) {
      var args = [ctx, Object.freeze({ id: playerId })];
      if (handler === "onRemote") {
        var data = null;
        try { data = JSON.parse(dataJson); } catch (e) { data = null; }
        args.push(name, data);
      }
      scripts.forEach(function (script) {
        if (typeof script[handler] !== "function") { return; }
        try { script[handler].apply(script, args); }
        catch (e) { report(handler + ": " + String(e)); }
      });
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
}

fn push_error(errors: &Mutex<Vec<String>>, msg: String) {
    let mut e = errors.lock().unwrap_or_else(|p| p.into_inner());
    if e.len() < MAX_ERRORS {
        e.push(msg);
    }
}

/// Turns a leading `export default X;` into `__omniExportDefault(X)` (see prelude.js).
fn rewrite_export_default(source: &str) -> String {
    let trimmed = source.trim();
    let Some(rest) = trimmed.strip_prefix("export default") else {
        return source.to_string();
    };
    let body = rest.trim_end_matches(|c: char| c == ';' || c.is_whitespace());
    format!("__omniExportDefault({body}\n)")
}

impl QuickJsHost {
    /// Builds a host and loads every source in order. Fails on engine setup or a script that does
    /// not compile or `export default serverScript({...})`.
    pub fn new(sources: &[String]) -> Result<Self, String> {
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
        let host = QuickJsHost { context, _runtime: runtime, out, errors, deadline };
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
        let errors = self.errors.clone();
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
            let report = Function::new(ctx.clone(), move |msg: String| push_error(&errors, msg)).map_err(fail)?;
            let glue: Function = ctx.eval(GLUE).map_err(fail)?;
            glue.call::<_, ()>((fire, fire_all, report)).map_err(fail)?;
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
            let take: Function = globals.get("__omniTakeDefault").map_err(describe)?;
            let def: rquickjs::Value = take.call(()).map_err(describe)?;
            if !def.is_object() {
                return Err("script does not export default serverScript({...})".to_string());
            }
            let host: Object = globals.get("__omniHost").map_err(describe)?;
            let add: Function = host.get("add").map_err(describe)?;
            add.call::<_, ()>((def,)).map_err(describe)
        })
    }

    fn dispatch(&mut self, handler: &str, player: &str, name: &str, data: &Value) -> Vec<Outgoing> {
        self.arm();
        let data_json = serde_json::to_string(data).unwrap_or_else(|_| "null".into());
        let errors = self.errors.clone();
        self.context.with(|ctx| {
            let res: rquickjs::Result<()> = (|| {
                let host: Object = ctx.globals().get("__omniHost")?;
                let f: Function = host.get("dispatch")?;
                f.call((handler, player, name, data_json))
            })();
            if let Err(e) = res {
                let msg = match e {
                    rquickjs::Error::Exception => format!("{handler}: {:?}", ctx.catch()),
                    other => format!("{handler}: {other}"),
                };
                push_error(&errors, msg);
            }
        });
        *self.deadline.lock().unwrap_or_else(|p| p.into_inner()) = None;
        std::mem::take(&mut *self.out.lock().unwrap_or_else(|p| p.into_inner()))
    }

    /// `ctx.state` as JSON text, for tests and diagnostics.
    #[allow(dead_code)] // diagnostics; used by tests
    pub fn state_json(&self) -> String {
        self.arm();
        let s = self.context.with(|ctx| {
            let host: Object = ctx.globals().get("__omniHost").ok()?;
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
}

/// Host factory: `lookup(game_id)` returns the game's server-script sources. No sources, or sources
/// that fail to load, give a `NoopHost` so a bad script never takes the session down.
pub fn factory_with(lookup: impl Fn(&str) -> Vec<String> + Send + Sync + 'static) -> HostFactory {
    Box::new(move |game_id| {
        let sources = lookup(game_id);
        if sources.is_empty() {
            return Box::new(NoopHost);
        }
        match QuickJsHost::new(&sources) {
            Ok(h) => Box::new(h),
            Err(_) => Box::new(NoopHost),
        }
    })
}

/// Factory for the global registry. Published server scripts are not reachable from here yet
/// (later item), so every game gets `NoopHost` for now.
pub fn factory() -> HostFactory {
    factory_with(|_| Vec::new())
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
        QuickJsHost::new(&[SCRIPT.to_string()]).expect("loads")
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
        let mut h = QuickJsHost::new(&[probe.to_string()]).unwrap();
        let out = h.on_remote("a", "x", &Value::Null);
        let Outgoing::FireAll { data, .. } = &out[0] else { panic!("expected FireAll") };
        assert_eq!(data["io"], json!(vec!["undefined"; 6]));
        assert_eq!(data["keys"], json!(["remote", "state"]));
        assert_eq!(data["frozen"], json!(true));
    }

    #[test]
    fn bad_sources_fail_to_load() {
        assert!(QuickJsHost::new(&["export default serverScript({ onNope() {} });".into()]).is_err());
        assert!(QuickJsHost::new(&["export default (".into()]).is_err());
        assert!(QuickJsHost::new(&["var x = 1;".into()]).is_err());
    }

    #[test]
    fn multiple_scripts_share_state_in_load_order() {
        let a = "export default serverScript({ onPlayerJoin(ctx, p) { ctx.state.n = 1; } });";
        let b = "export default serverScript({ onPlayerJoin(ctx, p) { ctx.state.n += 1; } });";
        let mut h = QuickJsHost::new(&[a.into(), b.into()]).unwrap();
        h.on_player_join("a");
        assert_eq!(serde_json::from_str::<Value>(&h.state_json()).unwrap(), json!({"n":2}));
    }

    #[test]
    fn factory_falls_back_to_noop() {
        let f = factory_with(|id| if id == "good" { vec![SCRIPT.to_string()] } else if id == "bad" { vec!["(".into()] } else { vec![] });
        assert_eq!(f("good").on_player_join("a").len(), 1);
        assert!(f("bad").on_player_join("a").is_empty());
        assert!(f("none").on_player_join("a").is_empty());
    }
}
