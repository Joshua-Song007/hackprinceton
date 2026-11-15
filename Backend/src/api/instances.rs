// Operator view of live game sessions ("instances"), developers only (401 without a session, 403 for players).
// Everything comes from the in-memory session registry; nothing is stored.
//
// Routes:
//   GET    /api/instances                                         -> 200 [{game_id, title?, lobby, version, players: [{id, name}], started_at, last_activity_at}]
//   DELETE /api/instances/{game_id}/{lobby}                       -> 204 | 404 (closes the session; its sockets end)
//   DELETE /api/instances/{game_id}/{lobby}/players/{player_id}   -> 204 | 404 (drops one player through the normal leave path)
//   DELETE /api/instances/{game_id}/{lobby}/ghosts/{player_id}    -> 204 | 404 | 409 (game owner or developer; only a player silent for PEAR_GHOST_SECS, 15 by default; 409 = still alive)

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{delete, get};
use axum::{Json, Router};
use serde::Serialize;

use crate::api::accounts::authenticate;
use crate::api::games::{require_editor, valid_uuid};
use crate::db;
use crate::game_server::session::{self, normalize_lobby, GhostKick};
use crate::AppState;

async fn require_developer(headers: &HeaderMap) -> Result<(), StatusCode> {
    match authenticate(headers).await {
        None => Err(StatusCode::UNAUTHORIZED),
        Some(a) if a.is_developer() => Ok(()),
        Some(_) => Err(StatusCode::FORBIDDEN),
    }
}

#[derive(Serialize)]
struct PlayerOut {
    id: String,
    name: String,
}

#[derive(Serialize)]
struct InstanceOut {
    game_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    lobby: String,
    version: Option<i32>,
    players: Vec<PlayerOut>,
    started_at: String,
    last_activity_at: String,
}

async fn list(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Vec<InstanceOut>>, StatusCode> {
    require_developer(&headers).await?;
    let mut out = Vec::new();
    for i in session::instances() {
        let title = match (&state.db, valid_uuid(&i.game_id)) {
            (Some(pool), true) => db::get_game(pool, &i.game_id).await.ok().flatten().map(|g| g.title),
            _ => None,
        };
        out.push(InstanceOut {
            game_id: i.game_id,
            title,
            lobby: i.lobby,
            version: i.version,
            players: i.players.into_iter().map(|(id, name)| PlayerOut { id, name }).collect(),
            started_at: i.started_at,
            last_activity_at: i.last_activity_at,
        });
    }
    Ok(Json(out))
}

async fn close(headers: HeaderMap, Path((game_id, lobby)): Path<(String, String)>) -> Result<StatusCode, StatusCode> {
    require_developer(&headers).await?;
    let lobby = normalize_lobby(&lobby).ok_or(StatusCode::BAD_REQUEST)?;
    if session::close_lobby(&game_id, &lobby) { Ok(StatusCode::NO_CONTENT) } else { Err(StatusCode::NOT_FOUND) }
}

async fn kick(headers: HeaderMap, Path((game_id, lobby, player)): Path<(String, String, String)>) -> Result<StatusCode, StatusCode> {
    require_developer(&headers).await?;
    let lobby = normalize_lobby(&lobby).ok_or(StatusCode::BAD_REQUEST)?;
    if session::kick(&game_id, &lobby, &player) { Ok(StatusCode::NO_CONTENT) } else { Err(StatusCode::NOT_FOUND) }
}

async fn kick_ghost(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((game_id, lobby, player)): Path<(String, String, String)>,
) -> Result<StatusCode, StatusCode> {
    let account = authenticate(&headers).await.ok_or(StatusCode::UNAUTHORIZED)?;
    let lobby = normalize_lobby(&lobby).ok_or(StatusCode::BAD_REQUEST)?;
    if !account.is_developer() {
        let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
        if !valid_uuid(&game_id) {
            return Err(StatusCode::NOT_FOUND);
        }
        require_editor(pool, &account, &game_id).await?;
    }
    match session::kick_ghost(&game_id, &lobby, &player) {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(GhostKick::NotFound) => Err(StatusCode::NOT_FOUND),
        Err(GhostKick::Alive) => Err(StatusCode::CONFLICT),
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/instances", get(list))
        .route("/api/instances/{game_id}/{lobby}", delete(close))
        .route("/api/instances/{game_id}/{lobby}/players/{player_id}", delete(kick))
        .route("/api/instances/{game_id}/{lobby}/ghosts/{player_id}", delete(kick_ghost))
}
