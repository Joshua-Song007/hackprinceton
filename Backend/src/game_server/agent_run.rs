// `ctx.agent.run(prompt)` for server scripts: one prompt to the hosted agent runtime
// (PEAR_AGENT_RUNTIME_URL, same websocket protocol as the editor panel; api/agent.rs proxies the panel)
// with a hard time cap, a per-game rate limit and a prompt length cap. Never blocks the tick loop: the
// call runs in a spawned task and the script host collects the result on its next poll.
//
// Hosted runtime only: needs PEAR_RUNTIME_SECRET (runtime hosted mode scopes files per account/project;
// its dev mode would hand the script read+write on the runtime's project dir) and an operator-paid model
// (PEAR_GAME_AGENT_PROVIDER + PEAR_GAME_AGENT_KEY, sent as X-Pear-Model-* headers). Any missing -> not configured.
use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

pub const RUN_TIMEOUT: Duration = Duration::from_secs(20);
pub const CALLS_PER_MINUTE: usize = 10;
pub const MAX_PROMPT_CHARS: usize = 4000;
const MAX_ERROR_CHARS: usize = 500;

pub const NOT_CONFIGURED: &str = "agent runtime not configured";

/// Everything needed to call the hosted runtime. No Debug impl: it holds secrets.
#[derive(Clone)]
pub struct AgentTarget {
    pub url: String,
    pub secret: String,
    pub provider: String,
    pub key: String,
}

/// Where and how long a host calls the runtime; `target` None = not configured.
#[derive(Clone)]
pub struct AgentConfig {
    pub target: Option<AgentTarget>,
    pub timeout: Duration,
}

impl AgentConfig {
    pub fn from_env() -> Self {
        Self::from_vars(|name| std::env::var(name).ok())
    }

    /// `get` reads one env var; blank counts as unset.
    fn from_vars(get: impl Fn(&str) -> Option<String>) -> Self {
        let var = |name: &str| get(name).filter(|v| !v.trim().is_empty());
        let target = (|| {
            Some(AgentTarget {
                url: var("PEAR_AGENT_RUNTIME_URL")?,
                secret: var("PEAR_RUNTIME_SECRET")?,
                provider: var("PEAR_GAME_AGENT_PROVIDER")?,
                key: var("PEAR_GAME_AGENT_KEY")?,
            })
        })();
        AgentConfig { target, timeout: RUN_TIMEOUT }
    }
}

/// The runtime's project slug for a game: the id itself, or None when the id is not a plain slug
/// (a sanitised id could collide with another game's files).
fn project_slug(game_id: &str) -> Option<&str> {
    let ok = !game_id.is_empty()
        && game_id.len() <= 64
        && game_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then_some(game_id)
}

/// Cheap synchronous checks (config, game id, prompt length, per-game rate), then returns the target to call.
pub fn admit(config: &AgentConfig, game_id: &str, prompt: &str) -> Result<AgentTarget, String> {
    let target = config.target.clone().ok_or(NOT_CONFIGURED)?;
    if project_slug(game_id).is_none() {
        return Err("agent unavailable for this game id".to_string());
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(format!("agent prompt too long (max {MAX_PROMPT_CHARS} characters)"));
    }
    if !allow(game_id, Instant::now()) {
        return Err(format!("agent rate limit exceeded (max {CALLS_PER_MINUTE} calls per minute per game)"));
    }
    Ok(target)
}

/// Sliding one-minute window per game id; kept across host restarts (reload) so they cannot reset it.
fn allow(game_id: &str, now: Instant) -> bool {
    static CALLS: OnceLock<Mutex<HashMap<String, VecDeque<Instant>>>> = OnceLock::new();
    let mut map = CALLS.get_or_init(Default::default).lock().unwrap_or_else(|p| p.into_inner());
    map.retain(|_, w| w.back().is_some_and(|t| now.duration_since(*t) < Duration::from_secs(60)));
    let window = map.entry(game_id.to_string()).or_default();
    while window.front().is_some_and(|t| now.duration_since(*t) >= Duration::from_secs(60)) {
        window.pop_front();
    }
    if window.len() >= CALLS_PER_MINUTE {
        return false;
    }
    window.push_back(now);
    true
}

/// Sends `prompt` and waits for the runtime's final `done` (its summary is the reply text) or `error`.
pub async fn run(target: &AgentTarget, game_id: &str, prompt: &str, timeout: Duration) -> Result<String, String> {
    match tokio::time::timeout(timeout, exchange(target, game_id, prompt)).await {
        Ok(result) => result,
        Err(_) => Err(format!("agent timed out after {}s", timeout.as_secs_f64())),
    }
}

async fn exchange(target: &AgentTarget, game_id: &str, prompt: &str) -> Result<String, String> {
    let mut req = target.url.as_str().into_client_request().map_err(|_| "agent runtime URL invalid".to_string())?;
    // A game's files live under account "game", project = its id (admit() checked it is a plain slug).
    let headers = req.headers_mut();
    let mut set = |name: &'static str, value: &str| {
        if let Ok(v) = HeaderValue::from_str(value) {
            headers.insert(name, v);
        }
    };
    set("authorization", &format!("Bearer {}", target.secret));
    set("x-pear-model-provider", &target.provider);
    set("x-pear-model-key", &target.key);
    set("x-pear-account", "game");
    set("x-pear-project", game_id);
    let unreachable = |_| "agent runtime unreachable".to_string();
    let (mut ws, _) = tokio_tungstenite::connect_async(req).await.map_err(unreachable)?;
    let prompt_frame = json!({ "type": "prompt", "id": "1", "text": prompt }).to_string();
    ws.send(Message::Text(prompt_frame.into())).await.map_err(unreachable)?;
    while let Some(msg) = ws.next().await {
        match msg.map_err(unreachable)? {
            Message::Text(text) => {
                let event: Value = serde_json::from_str(text.as_str()).unwrap_or(Value::Null);
                match event["type"].as_str() {
                    Some("done") => return Ok(event["summary"].as_str().unwrap_or_default().to_string()),
                    Some("error") => {
                        let message = event["message"].as_str().unwrap_or("agent failed");
                        return Err(message.chars().take(MAX_ERROR_CHARS).collect());
                    }
                    _ => {}
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    Err("agent runtime closed the connection".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_env_var_is_required() {
        let all = [
            ("PEAR_AGENT_RUNTIME_URL", "ws://r/ws"),
            ("PEAR_RUNTIME_SECRET", "s"),
            ("PEAR_GAME_AGENT_PROVIDER", "p"),
            ("PEAR_GAME_AGENT_KEY", "k"),
        ];
        let config = |skip: &str, blank: bool| {
            AgentConfig::from_vars(|n| match all.iter().find(|(k, _)| *k == n) {
                Some((k, _)) if *k == skip => blank.then(|| "  ".to_string()),
                Some((_, v)) => Some(v.to_string()),
                None => None,
            })
        };
        assert!(config("", false).target.is_some());
        for (missing, _) in all {
            for blank in [false, true] {
                assert!(config(missing, blank).target.is_none(), "{missing} blank={blank}");
            }
        }
        assert_eq!(admit(&config("PEAR_GAME_AGENT_KEY", false), "g", "hi").err().as_deref(), Some(NOT_CONFIGURED));
    }

    #[test]
    fn rate_limit_is_per_game_and_slides() {
        let t0 = Instant::now();
        for _ in 0..CALLS_PER_MINUTE {
            assert!(allow("agent-run-unit-a", t0));
        }
        assert!(!allow("agent-run-unit-a", t0 + Duration::from_secs(59)));
        assert!(allow("agent-run-unit-b", t0));
        assert!(allow("agent-run-unit-a", t0 + Duration::from_secs(61)));
    }
}
