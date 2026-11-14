// Same server-script fixture and expectations as
// Packages/OmniScript/Tests/OmniScriptTests/ServerScriptEngineTests.swift, run against the
// rquickjs host. Keeps the Swift and Rust server-script hosts aligned. No DATABASE_URL needed.
// [provisional: needs-tien-review]

use omni_backend::game_server::script_host::{factory_with, QuickJsHost};
use omni_backend::game_server::session::{Outgoing, ScriptHost};
use serde_json::{json, Value};

/// Shared server-script fixture. Copied verbatim from `sharedFixture` in ServerScriptEngineTests.swift.
const SHARED_FIXTURE: &str = r#"export default serverScript({
  onPlayerJoin(ctx, player) {
    ctx.state.health = ctx.state.health || {};
    ctx.state.health[player.id] = 100;
  },
  onPlayerLeave(ctx, player) {
    delete ctx.state.health[player.id];
  },
  onRemote(ctx, player, name, data) {
    if (name === "punch") {
      ctx.remote.fireAll("hit", { from: player.id, dir: data.dir });
    }
  },
});"#;

fn host(source: &str) -> QuickJsHost {
    QuickJsHost::new(&[source.to_string()]).expect("script loads")
}

fn state(h: &QuickJsHost) -> Value {
    serde_json::from_str(&h.state_json()).expect("state is JSON")
}

#[test]
fn join_and_leave_update_state() {
    let mut h = host(SHARED_FIXTURE);
    h.on_player_join("p1");
    h.on_player_join("p2");
    assert_eq!(state(&h), json!({"health": {"p1": 100, "p2": 100}}));
    h.on_player_leave("p1");
    assert_eq!(state(&h), json!({"health": {"p2": 100}}));
    assert!(!h.state_json().contains("p1"));
}

#[test]
fn remote_event_in_fire_all_out() {
    let mut h = host(SHARED_FIXTURE);
    let out = h.on_remote("p1", "punch", &json!({"dir": [1, 0, 0]}));
    assert_eq!(
        out,
        vec![Outgoing::FireAll { name: "hit".into(), data: json!({"from": "p1", "dir": [1, 0, 0]}) }]
    );
}

#[test]
fn unknown_remote_event_sends_nothing() {
    let mut h = host(SHARED_FIXTURE);
    assert!(h.on_remote("p1", "other", &Value::Null).is_empty());
}

#[test]
fn fire_targets_one_player() {
    let mut h = host(
        r#"export default serverScript({
  onRemote(ctx, player, name, data) { ctx.remote.fire(player.id, "pong", { n: 1 }); },
});"#,
    );
    let out = h.on_remote("p9", "ping", &Value::Null);
    assert_eq!(out, vec![Outgoing::Fire { player: "p9".into(), name: "pong".into(), data: json!({"n": 1}) }]);
}

#[test]
fn sandbox_has_no_host_access() {
    let mut h = host(
        r#"export default serverScript({
  onPlayerJoin(ctx, player) {
    ctx.state.types = [typeof self, typeof require, typeof fetch, typeof XMLHttpRequest,
                       typeof process, typeof input, typeof ctx.input, typeof ctx.usis];
  },
});"#,
    );
    h.on_player_join("p1");
    assert_eq!(state(&h), json!({"types": vec!["undefined"; 8]}));
    assert!(h.errors().is_empty());
}

#[test]
fn handler_error_is_contained() {
    let mut h = host(
        r#"export default serverScript({
  onPlayerJoin(ctx, player) { throw new Error("boom"); },
  onRemote(ctx, player, name, data) { ctx.remote.fireAll("ok", null); },
});"#,
    );
    h.on_player_join("p1");
    let errors = h.errors();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains("boom"));
    let out = h.on_remote("p1", "x", &Value::Null);
    assert_eq!(out, vec![Outgoing::FireAll { name: "ok".into(), data: Value::Null }]);
}

#[test]
fn bad_source_fails_to_load() {
    assert!(QuickJsHost::new(&["export default serverScript({".to_string()]).is_err());
    assert!(QuickJsHost::new(&["var x = 1;".to_string()]).is_err());
    assert!(QuickJsHost::new(&["export default serverScript({ onBogus() {} });".to_string()]).is_err());
}

#[test]
fn multiple_scripts_share_state() {
    let a = "export default serverScript({ onPlayerJoin(ctx, p) { ctx.state.a = 1; } });";
    let b = "export default serverScript({ onPlayerJoin(ctx, p) { ctx.state.b = ctx.state.a + 1; } });";
    let mut h = QuickJsHost::new(&[a.to_string(), b.to_string()]).expect("loads");
    h.on_player_join("p1");
    assert_eq!(state(&h), json!({"a": 1, "b": 2}));
}

#[test]
fn factory_runs_fixture_through_public_api() {
    let f = factory_with(|_| vec![SHARED_FIXTURE.to_string()]);
    let mut h = f("game");
    let out = h.on_remote("p1", "punch", &json!({"dir": [0, 1, 0]}));
    assert_eq!(
        out,
        vec![Outgoing::FireAll { name: "hit".into(), data: json!({"from": "p1", "dir": [0, 1, 0]}) }]
    );
}
