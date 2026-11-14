// Hosted Deep Agents runtime (browser mode without a local `uv` process) and per-account model keys.
//
// Routes:
//   PUT    /api/me/model-key  {provider, key} -> 200 {provider, set: true}   (anthropic | openai | google)
//   GET    /api/me/model-key                  -> 200 {provider, set} ; the key itself is never returned
//   DELETE /api/me/model-key                  -> 204
//   GET    /agent/health                      -> the runtime's /health, 503 when no runtime is configured
//   GET    /agent/ws?token=..&project=..      -> WebSocket proxied to the runtime
// The runtime is OMNI_AGENT_RUNTIME_URL (e.g. ws://runtime:9410/ws, on the Docker network only). Each
// proxied connection carries `Authorization: Bearer $OMNI_RUNTIME_SECRET`, the account and project ids
// and, when the account stored one, its decrypted model key: the runtime uses only that key, so one
// account's key never serves another account.
use axum::extract::ws::{rejection::WebSocketUpgradeRejection, Message as AMsg, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message as TMsg;

use crate::api::accounts::{authenticate, authenticate_request, query_param};
use crate::crypto::secret_box;
use crate::db::{self, Db};
use crate::AppState;

type ApiError = (StatusCode, Json<Value>);

pub const PROVIDERS: [&str; 3] = ["anthropic", "openai", "google"];

fn error(status: StatusCode, msg: &str) -> ApiError {
    (status, Json(json!({ "error": msg })))
}

fn db_err(e: sqlx::Error) -> ApiError {
    eprintln!("agent: db error: {e}");
    error(StatusCode::INTERNAL_SERVER_ERROR, "database error")
}

fn parts(state: &AppState, headers: &HeaderMap) -> Result<(Db, String), ApiError> {
    let me = authenticate(headers).ok_or_else(|| error(StatusCode::UNAUTHORIZED, "sign in first"))?;
    let db = state.db.clone().ok_or_else(|| error(StatusCode::SERVICE_UNAVAILABLE, "database unavailable"))?;
    Ok((db, me.id))
}

#[derive(Deserialize)]
struct KeyRequest {
    provider: String,
    key: String,
}

async fn put_key(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<KeyRequest>) -> Result<Json<Value>, ApiError> {
    let (db, me) = parts(&state, &headers)?;
    let key = req.key.trim();
    if !PROVIDERS.contains(&req.provider.as_str()) {
        return Err(error(StatusCode::BAD_REQUEST, "provider must be anthropic, openai or google"));
    }
    if !(8..=512).contains(&key.len()) || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(error(StatusCode::BAD_REQUEST, "key must be 8-512 characters with no spaces"));
    }
    db::set_model_key(&db, &me, &req.provider, &secret_box().seal(key)).await.map_err(db_err)?;
    Ok(Json(json!({ "provider": req.provider, "set": true })))
}

async fn get_key(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let (db, me) = parts(&state, &headers)?;
    Ok(Json(match db::get_model_key(&db, &me).await.map_err(db_err)? {
        Some((provider, _)) => json!({ "provider": provider, "set": true }),
        None => json!({ "provider": null, "set": false }),
    }))
}

async fn delete_key(State(state): State<AppState>, headers: HeaderMap) -> Result<StatusCode, ApiError> {
    let (db, me) = parts(&state, &headers)?;
    db::delete_model_key(&db, &me).await.map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

fn runtime_url() -> Option<String> {
    std::env::var("OMNI_AGENT_RUNTIME_URL").ok().filter(|u| !u.trim().is_empty())
}

async fn health() -> Response {
    let Some(ws) = runtime_url() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "no hosted agent runtime").into_response();
    };
    let url = ws.replacen("ws", "http", 1).trim_end_matches("/ws").to_string() + "/health";
    match reqwest::get(&url).await {
        Ok(r) if r.status().is_success() => match r.json::<Value>().await {
            Ok(v) => Json(v).into_response(),
            Err(_) => error(StatusCode::BAD_GATEWAY, "runtime health not JSON").into_response(),
        },
        _ => error(StatusCode::BAD_GATEWAY, "hosted agent runtime unreachable").into_response(),
    }
}

fn valid_project(p: &str) -> bool {
    (1..=64).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

async fn proxy(State(state): State<AppState>, uri: Uri, headers: HeaderMap, ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>) -> Response {
    let Some(account) = authenticate_request(&headers, uri.query()) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let project = query_param(uri.query(), "project").unwrap_or("local").to_string();
    if !valid_project(&project) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Some(url) = runtime_url() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "no hosted agent runtime").into_response();
    };
    let key = match &state.db {
        Some(db) => match db::get_model_key(db, &account.id).await {
            Ok(found) => found.and_then(|(provider, sealed)| Some((provider, secret_box().open(&sealed)?))),
            Err(e) => {
                eprintln!("agent: model key lookup: {e}");
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
        },
        None => None,
    };
    let Ok(mut req) = url.as_str().into_client_request() else {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "bad OMNI_AGENT_RUNTIME_URL").into_response();
    };
    let h = req.headers_mut();
    let mut set = |name: &'static str, value: &str| {
        if let Ok(v) = HeaderValue::from_str(value) {
            h.insert(name, v);
        }
    };
    set("authorization", &format!("Bearer {}", std::env::var("OMNI_RUNTIME_SECRET").unwrap_or_default()));
    set("x-omni-account", &account.id);
    set("x-omni-project", &project);
    if let Some((provider, key)) = &key {
        set("x-omni-model-provider", provider);
        set("x-omni-model-key", key);
    }
    let upstream = match tokio_tungstenite::connect_async(req).await {
        Ok((s, _)) => s,
        Err(e) => {
            eprintln!("agent: runtime connect: {e}");
            return error(StatusCode::BAD_GATEWAY, "hosted agent runtime unreachable").into_response();
        }
    };
    match ws {
        Ok(ws) => ws.max_message_size(1 << 22).on_upgrade(move |socket| pump(socket, upstream)),
        Err(rej) => rej.into_response(),
    }
}

type Upstream = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Copies text frames both ways until either side closes.
async fn pump(socket: WebSocket, upstream: Upstream) {
    let (mut up_tx, mut up_rx) = upstream.split();
    let (mut down_tx, mut down_rx) = socket.split();
    let to_runtime = async {
        while let Some(Ok(m)) = down_rx.next().await {
            match m {
                AMsg::Text(t) => {
                    if up_tx.send(TMsg::Text(t.as_str().into())).await.is_err() {
                        break;
                    }
                }
                AMsg::Close(_) => break,
                _ => {}
            }
        }
        let _ = up_tx.close().await;
    };
    let to_browser = async {
        while let Some(Ok(m)) = up_rx.next().await {
            match m {
                TMsg::Text(t) => {
                    if down_tx.send(AMsg::Text(t.as_str().into())).await.is_err() {
                        break;
                    }
                }
                TMsg::Close(_) => break,
                _ => {}
            }
        }
        let _ = down_tx.close().await;
    };
    tokio::select! {
        _ = to_runtime => {}
        _ = to_browser => {}
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/me/model-key", get(get_key).put(put_key).delete(delete_key))
        .route("/agent/health", get(health))
        .route("/agent/ws", get(proxy))
}
