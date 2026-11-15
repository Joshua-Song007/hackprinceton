// `ctx.agent.run(prompt)` in server scripts against a fake runtime (a local websocket server speaking
// the editor panel's protocol: prompt in, `done {summary}` / `error {message}` out). Never sets env vars:
// each host is pointed at the fake with `set_agent_runtime`, so tests can run in parallel.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use pear_backend::game_server::agent_run::{AgentTarget, CALLS_PER_MINUTE, MAX_PROMPT_CHARS};
use pear_backend::game_server::script_host::QuickJsHost;
use pear_backend::game_server::session::{Outgoing, ScriptHost};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

/// Prompt "fail" -> error event, "hang" -> never answers, otherwise `done` with summary "echo:<prompt>".
/// Each connection reports its headers on the returned channel.
#[allow(clippy::result_large_err)] // the handshake callback type is fixed by tungstenite
async fn fake_runtime() -> (String, tokio::sync::mpsc::UnboundedReceiver<Vec<(String, String)>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/ws", listener.local_addr().unwrap());
    let (seen_tx, seen_rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let seen_tx = seen_tx.clone();
            tokio::spawn(async move {
                let callback = |req: &tokio_tungstenite::tungstenite::handshake::server::Request, res| {
                    let headers = req.headers().iter().map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()));
                    let _ = seen_tx.send(headers.collect());
                    Ok(res)
                };
                let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(stream, callback).await else { return };
                while let Some(Ok(Message::Text(t))) = ws.next().await {
                    let prompt: Value = serde_json::from_str(t.as_str()).unwrap();
                    let text = prompt["text"].as_str().unwrap();
                    let reply = match text {
                        "hang" => continue,
                        "fail" => json!({"type": "error", "id": prompt["id"], "message": "No model API key"}),
                        _ => json!({"type": "done", "id": prompt["id"], "summary": format!("echo:{text}")}),
                    };
                    let _ = ws.send(Message::Text(reply.to_string().into())).await;
                }
            });
        }
    });
    (url, seen_rx)
}

/// Replies (or the error text) of `ctx.agent.run(data.prompt)` come back as state.results[data.tag].
const SCRIPT: &str = r#"export default serverScript({
  async onRemote(ctx, player, name, data) {
    ctx.state.results = ctx.state.results || {};
    try { ctx.state.results[data.tag] = { ok: await ctx.agent.run(data.prompt) }; }
    catch (e) { ctx.state.results[data.tag] = { err: e.message }; }
    ctx.remote.fire(player.id, "agent", { tag: data.tag });
  },
});"#;

fn target(url: String) -> AgentTarget {
    AgentTarget { url, secret: "test-secret".into(), provider: "test-provider".into(), key: "test-key".into() }
}

fn host(game: &str, runtime: Option<String>, timeout: Duration) -> QuickJsHost {
    let h = QuickJsHost::new(game, &[SCRIPT.to_string()]).expect("loads");
    h.set_agent_runtime(runtime.map(target), timeout);
    h
}

fn ask(h: &mut QuickJsHost, tag: &str, prompt: &str) {
    assert!(h.on_remote("p", "ask", &json!({"tag": tag, "prompt": prompt})).is_empty(), "the call never answers synchronously");
}

/// Polls like the session tick until `n` "agent" frames came out; returns the script's `state.results`.
async fn results_after(h: &mut QuickJsHost, n: usize) -> Value {
    let mut fired = 0;
    for _ in 0..200 {
        fired += h.poll().iter().filter(|o| matches!(o, Outgoing::Fire { name, .. } if name == "agent")).count();
        if fired >= n {
            return serde_json::from_str::<Value>(&h.state_json()).unwrap()["results"].clone();
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("only {fired} of {n} agent calls settled; errors: {:?}", h.errors());
}

#[tokio::test]
async fn absent_runtime_rejects_with_a_clear_error() {
    let mut h = host("agent-test-absent", None, Duration::from_secs(5));
    ask(&mut h, "a", "hi");
    assert_eq!(results_after(&mut h, 1).await["a"], json!({"err": "agent runtime not configured"}));
    assert!(h.errors().is_empty());
}

#[tokio::test]
#[allow(clippy::result_large_err)] // the handshake callback type is fixed by tungstenite
async fn fake_runtime_text_reaches_the_script_and_errors_reject() {
    let (url, mut seen) = fake_runtime().await;
    let mut h = host("agent-test-ok", Some(url), Duration::from_secs(5));
    ask(&mut h, "a", "hello");
    ask(&mut h, "b", "fail");
    let results = results_after(&mut h, 2).await;
    assert_eq!(results["a"], json!({"ok": "echo:hello"}));
    assert_eq!(results["b"], json!({"err": "No model API key"}));
    let headers = seen.recv().await.unwrap();
    let get = |k: &str| headers.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
    assert_eq!((get("x-pear-account"), get("x-pear-project")), (Some("game"), Some("agent-test-ok")));
    assert_eq!(get("authorization"), Some("Bearer test-secret"));
    assert_eq!((get("x-pear-model-provider"), get("x-pear-model-key")), (Some("test-provider"), Some("test-key")));
    assert!(h.errors().is_empty());
}

#[tokio::test]
async fn a_call_that_never_answers_times_out_without_blocking_the_host() {
    let (url, _seen) = fake_runtime().await;
    let mut h = host("agent-test-timeout", Some(url), Duration::from_millis(300));
    ask(&mut h, "slow", "hang");
    // the host stays usable while the call is pending
    assert!(h.on_remote("p", "nothing", &json!({"tag": "x", "prompt": "y"})).is_empty());
    assert_eq!(results_after(&mut h, 2).await["slow"], json!({"err": "agent timed out after 0.3s"}));
}

#[tokio::test]
async fn unreachable_runtime_and_long_prompt_reject() {
    let dead = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap(); // closed again
    let mut h = host("agent-test-dead", Some(format!("ws://{dead}/ws")), Duration::from_secs(5));
    ask(&mut h, "a", "hi");
    ask(&mut h, "b", &"x".repeat(MAX_PROMPT_CHARS + 1));
    let results = results_after(&mut h, 2).await;
    assert_eq!(results["a"], json!({"err": "agent runtime unreachable"}));
    assert_eq!(results["b"], json!({"err": format!("agent prompt too long (max {MAX_PROMPT_CHARS} characters)")}));
}

#[tokio::test]
async fn per_game_rate_limit_triggers_and_other_games_are_unaffected() {
    let (url, _seen) = fake_runtime().await;
    let mut h = host("agent-test-rate", Some(url.clone()), Duration::from_secs(5));
    for i in 0..=CALLS_PER_MINUTE {
        ask(&mut h, &i.to_string(), "hi");
    }
    let results = results_after(&mut h, CALLS_PER_MINUTE + 1).await;
    let limited: Vec<&Value> = results.as_object().unwrap().values().filter(|r| r["err"].as_str().is_some()).collect();
    assert_eq!(limited, [&json!({"err": "agent rate limit exceeded (max 10 calls per minute per game)"})]);
    // a restarted host of the same game (reload) shares the window; another game has its own
    let mut again = host("agent-test-rate", Some(url.clone()), Duration::from_secs(5));
    ask(&mut again, "a", "hi");
    assert!(results_after(&mut again, 1).await["a"]["err"].as_str().unwrap().contains("rate limit"));
    let mut other = host("agent-test-rate-other", Some(url), Duration::from_secs(5));
    ask(&mut other, "a", "hi");
    assert_eq!(results_after(&mut other, 1).await["a"], json!({"ok": "echo:hi"}));
}

#[tokio::test]
async fn game_id_that_is_not_a_plain_slug_is_rejected() {
    let (url, _seen) = fake_runtime().await;
    for id in ["", "a b", "x/../y"] {
        let mut h = host(id, Some(url.clone()), Duration::from_secs(5));
        ask(&mut h, "a", "hi");
        assert_eq!(results_after(&mut h, 1).await["a"], json!({"err": "agent unavailable for this game id"}));
    }
}
