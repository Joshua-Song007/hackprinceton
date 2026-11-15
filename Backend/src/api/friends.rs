// Friends: request by friend code, accept, remove, and which game an accepted friend is in right now.
// "Playing" comes from the live /play sockets (session::game_of); nothing about presence is stored.
// Auth is `accounts::authenticate`; queries go through db.rs only. Order per request: auth, db, query.
//
// Routes:
//   GET    /api/friends              -> 200 [{id, name, playing: {gameId, title} | null}] accepted friends only
//   GET    /api/friends/requests     -> 200 {incoming: [{id, name}], outgoing: [{id, name}]}
//   POST   /api/friends {code}       -> 200 {status: "pending" | "accepted"} | 404 unknown code | 400 own code
//   POST   /api/friends/{id}/accept  -> 204 | 404 no pending request from id
//   DELETE /api/friends/{id}         -> 204 decline / cancel / remove | 404 no such link

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::api::accounts::authenticate;
use crate::api::games::valid_uuid;
use crate::db::{self, FriendRef, RequestOutcome};
use crate::game_server::session::game_of;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Playing {
    game_id: String,
    title: String,
}

#[derive(Debug, Serialize)]
struct FriendEntry {
    id: String,
    name: String,
    playing: Option<Playing>,
}

#[derive(Debug, Serialize)]
struct Requests {
    incoming: Vec<FriendRef>,
    outgoing: Vec<FriendRef>,
}

#[derive(Debug, Deserialize)]
struct AddRequest {
    code: String,
}

fn db_err(what: &str) -> impl Fn(sqlx::Error) -> StatusCode + '_ {
    move |e| {
        eprintln!("friends: {what}: db error: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

async fn list(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Vec<FriendEntry>>, StatusCode> {
    let me = authenticate(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let friends = db::list_friends(pool, &me.id).await.map_err(db_err("list"))?;
    let live: Vec<Option<String>> = friends.iter().map(|f| game_of(&f.id)).collect();
    // One catalog read for every title, and only when someone is actually in a game.
    let catalog = if live.iter().any(Option::is_some) {
        db::list_catalog(pool).await.map_err(db_err("catalog"))?
    } else {
        Vec::new()
    };
    let out = friends
        .into_iter()
        .zip(live)
        .map(|(f, game)| FriendEntry {
            playing: game.map(|game_id| Playing {
                title: catalog.iter().find(|c| c.id == game_id).map(|c| c.title.clone()).unwrap_or_default(),
                game_id,
            }),
            id: f.id,
            name: f.name,
        })
        .collect();
    Ok(Json(out))
}

async fn requests(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Requests>, StatusCode> {
    let me = authenticate(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let (incoming, outgoing) = db::list_friend_requests(pool, &me.id).await.map_err(db_err("requests"))?;
    Ok(Json(Requests { incoming, outgoing }))
}

async fn add(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AddRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let me = authenticate(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    match db::send_friend_request(pool, &me.id, &req.code).await.map_err(db_err("add"))? {
        RequestOutcome::NoSuchCode => Err(StatusCode::NOT_FOUND),
        RequestOutcome::OwnCode => Err(StatusCode::BAD_REQUEST),
        RequestOutcome::Pending => Ok(Json(serde_json::json!({ "status": "pending" }))),
        RequestOutcome::Accepted => Ok(Json(serde_json::json!({ "status": "accepted" }))),
    }
}

async fn accept(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> Result<StatusCode, StatusCode> {
    let me = authenticate(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    if !valid_uuid(&id) {
        return Err(StatusCode::NOT_FOUND);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    match db::accept_friend(pool, &me.id, &id).await.map_err(db_err("accept"))? {
        true => Ok(StatusCode::NO_CONTENT),
        false => Err(StatusCode::NOT_FOUND),
    }
}

async fn remove(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> Result<StatusCode, StatusCode> {
    let me = authenticate(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    if !valid_uuid(&id) {
        return Err(StatusCode::NOT_FOUND);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    match db::remove_friend(pool, &me.id, &id).await.map_err(db_err("remove"))? {
        true => Ok(StatusCode::NO_CONTENT),
        false => Err(StatusCode::NOT_FOUND),
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/friends", get(list).post(add))
        .route("/api/friends/requests", get(requests))
        .route("/api/friends/{id}/accept", post(accept))
        .route("/api/friends/{id}", delete(remove))
}
