// Same server-script fixture and expectations as
// Packages/PearScript/Tests/PearScriptTests/ServerScriptEngineTests.swift, run against the
// rquickjs host. Keeps the Swift and Rust server-script hosts aligned. No DATABASE_URL needed.
// [provisional: needs-tien-review]

use pear_backend::game_server::script_host::{factory, QuickJsHost};
use pear_backend::game_server::session::{Outgoing, ScriptHost};
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
    QuickJsHost::new("test", &[source.to_string()]).expect("script loads")
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
    assert!(QuickJsHost::new("test", &["export default serverScript({".to_string()]).is_err());
    assert!(QuickJsHost::new("test", &["var x = 1;".to_string()]).is_err());
    assert!(QuickJsHost::new("test", &["export default serverScript({ onBogus() {} });".to_string()]).is_err());
}

#[test]
fn multiple_scripts_share_state() {
    let a = "export default serverScript({ onPlayerJoin(ctx, p) { ctx.state.a = 1; } });";
    let b = "export default serverScript({ onPlayerJoin(ctx, p) { ctx.state.b = ctx.state.a + 1; } });";
    let mut h = QuickJsHost::new("test", &[a.to_string(), b.to_string()]).expect("loads");
    h.on_player_join("p1");
    assert_eq!(state(&h), json!({"a": 1, "b": 2}));
}

#[test]
fn factory_runs_fixture_through_public_api() {
    let f = factory();
    let mut h = f("game", &[SHARED_FIXTURE.to_string()]);
    let out = h.on_remote("p1", "punch", &json!({"dir": [0, 1, 0]}));
    assert_eq!(
        out,
        vec![Outgoing::FireAll { name: "hit".into(), data: json!({"from": "p1", "dir": [0, 1, 0]}) }]
    );
}

#[test]
fn lobby_comes_from_the_session_key_and_defaults_to_open() {
    let src = r#"export default serverScript({ onRemote(ctx) { ctx.remote.fireAll("lobby", ctx.lobby); } });"#;
    let lobby = |key: &str| {
        let mut h = QuickJsHost::new(key, &[src.to_string()]).unwrap();
        h.on_remote("a", "x", &Value::Null)
    };
    assert_eq!(lobby("game/ABCD"), vec![Outgoing::FireAll { name: "lobby".into(), data: json!("ABCD") }]);
    assert_eq!(lobby("game"), vec![Outgoing::FireAll { name: "lobby".into(), data: json!("OPEN") }]);
}

#[test]
fn players_list_has_names_and_last_seen_and_drops_leavers() {
    let src = r#"export default serverScript({
      onPlayerJoin(ctx, p) { ctx.state.joined = ctx.players().map((x) => x.id); },
      onPlayerLeave(ctx, p) { ctx.state.left = ctx.players().map((x) => x.id); },
      onRemote(ctx, p, name) {
        const me = ctx.players().find((x) => x.id === p.id);
        ctx.state.seen = { name: me.name, recent: ctx.now() - me.lastSeen < 1000, n: ctx.players().length };
      },
    });"#;
    let mut h = host(src);
    h.set_player_name("a", "Ann");
    h.on_player_join("a");
    h.on_player_join("b");
    assert_eq!(state(&h)["joined"], json!(["a", "b"]));
    h.on_remote("a", "ping", &Value::Null);
    assert_eq!(state(&h)["seen"], json!({"name": "Ann", "recent": true, "n": 2}));
    h.on_player_leave("a");
    assert_eq!(state(&h)["left"], json!(["b"]));
}

#[test]
fn player_timers_carry_the_player_and_die_with_them() {
    let src = r#"export default serverScript({
      onRemote(ctx, p, name) {
        if (name === "arm") { ctx.state.t = ctx.after(1000, "ping", { n: 1 }, p.id); ctx.state.g = ctx.after(2000, "ping", { n: 1 }); }
      },
      onTimer(ctx, tag, data, playerId) { ctx.state.fired = (ctx.state.fired || []).concat([[tag, data, playerId === undefined ? null : playerId]]); },
    });"#;
    let mut h = host(src);
    let out = h.on_remote("a", "arm", &Value::Null);
    assert_eq!(out.len(), 2);
    h.on_timer("ping", &json!({"n": 1})); // the global one: no player arg
    let Outgoing::After { tag, data, .. } = &out[0] else { panic!("After") };
    h.on_timer(tag, data);
    assert_eq!(state(&h)["fired"], json!([["ping", {"n": 1}, null], ["ping", {"n": 1}, "a"]]));
    // an unfired player timer is cancelled when that player leaves
    h.on_remote("b", "arm", &Value::Null);
    assert_eq!(h.on_player_leave("b"), vec![Outgoing::Cancel { id: 3 }]);
}

#[test]
fn cancel_on_a_fired_or_unknown_handle_is_a_quiet_false() {
    let src = r#"export default serverScript({
      onRemote(ctx, p, name) {
        if (name === "arm") ctx.state.id = ctx.after(100, "t");
        if (name === "cancel") ctx.state.r = [ctx.cancel(ctx.state.id), ctx.cancel(ctx.state.id), ctx.cancel(999)];
      },
    });"#;
    let mut h = host(src);
    h.on_remote("a", "arm", &Value::Null);
    h.on_timer("t", &Value::Null);
    assert!(h.on_remote("a", "cancel", &Value::Null).is_empty());
    assert_eq!(state(&h)["r"], json!([false, false, false]));
    assert!(h.errors().is_empty());
}

#[test]
fn phase_entered_at_tracks_current_and_named_phases() {
    let src = r#"export default serverScript({
      onRemote(ctx, p, name) {
        if (name === "enter") ctx.enterPhase(p.id);
        if (name === "ask") ctx.state.r = [ctx.phaseEnteredAt(), ctx.phaseEnteredAt("lobby"), ctx.phaseEnteredAt("nope")];
      },
    });"#;
    let mut h = host(src);
    h.on_remote("a", "ask", &Value::Null);
    assert_eq!(state(&h)["r"], json!([null, null, null]));
    h.on_remote("lobby", "enter", &Value::Null);
    h.on_remote("play", "enter", &Value::Null);
    h.on_remote("a", "ask", &Value::Null);
    let r = state(&h)["r"].clone();
    assert!(r[0].as_f64().unwrap() >= r[1].as_f64().unwrap() && r[1].is_number() && r[2].is_null());
}

#[test]
fn per_player_fire_reaches_only_that_player() {
    let src = r#"export default serverScript({ onRemote(ctx, p) { ctx.remote.fire("hunter", "pos", { lat: 1 }); } });"#;
    let out = host(src).on_remote("prey", "x", &Value::Null);
    assert_eq!(out, vec![Outgoing::Fire { player: "hunter".into(), name: "pos".into(), data: json!({"lat": 1}) }]);
}
