// Publish a game version, list games, fetch a version; only the owner (or a developer account) may publish.
// [provisional: needs-tien-review] Fetch requires a signed-in account (any account, not only the owner);
// public fetch for players is a later decision (permissions are not decided in overview.md Module 11).
// Auth is `accounts::authenticate`; queries go through db.rs only. Order per request: auth, validate, db.
//
// Routes:
//   POST /api/games                         {title}            -> 201 Game
//   GET  /api/games                                            -> 200 [Game] (the caller's games)
//   GET  /api/games?all=1                                      -> 200 [Game] (every game; developers only, else 403)
//   PUT  /api/games/{id}                    {title?, description?} -> 200 Game (owner or developer)
//   PUT  /api/games/{id}/cover              raw jpeg/png <= 2 MB -> 204 | 413 | 415 (owner or developer)
//   DELETE /api/games/{id}/cover                               -> 204 (owner or developer)
//   GET  /api/games/{id}/cover                                 -> 200 image bytes | 404 (public, no auth)
//   GET  /api/games/{id}/lobbies                               -> 200 [{code, players: [{id, name}]}] live lobbies
//   POST /api/games/{id}/versions           NewGameVersion     -> 201 GameVersion (owner only; 400 when assets[*].sha256 is not stored)
//   GET  /api/games/{id}/versions/{version} number or "latest" -> 200 GameVersion

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, RawQuery, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::api::accounts::{authenticate, query_param};
use crate::api::avatars::sniff;
use crate::game_server::session;
use crate::db::{self, Account, Game, GameVersion, NewGameVersion};
use crate::AppState;

const MAX_TITLE_LEN: usize = 256;
const MAX_DESCRIPTION_LEN: usize = 4000;
const MAX_COVER_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct CreateGameRequest {
    pub title: String,
}

async fn require_account(headers: &HeaderMap) -> Result<Account, StatusCode> {
    authenticate(headers).await.ok_or(StatusCode::UNAUTHORIZED)
}

fn db_err(what: &str, e: sqlx::Error) -> StatusCode {
    eprintln!("games: {what}: db error: {e}");
    StatusCode::INTERNAL_SERVER_ERROR
}

/// Canonical 8-4-4-4-12 hex uuid; anything else would make the `::uuid` cast fail inside Postgres.
pub(crate) fn valid_uuid(s: &str) -> bool {
    s.len() == 36
        && s.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

fn valid_title(t: &str) -> bool {
    !t.trim().is_empty() && t.len() <= MAX_TITLE_LEN
}

/// "latest" -> None; a positive integer -> Some(n); anything else -> Err.
fn parse_version(s: &str) -> Result<Option<i32>, ()> {
    if s == "latest" {
        return Ok(None);
    }
    match s.parse::<i32>() {
        Ok(n) if n >= 1 => Ok(Some(n)),
        _ => Err(()),
    }
}

/// Run mode is `screen` or `device` (overview.md Module 7); every content part is a JSON object.
fn valid_version(v: &NewGameVersion) -> bool {
    matches!(v.run_mode.as_str(), "screen" | "device")
        && v.scene.is_object()
        && v.client_scripts.is_object()
        && v.server_scripts.is_object()
        && v.assets.is_object()
        && v.metadata.is_object()
}

async fn create_game(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateGameRequest>,
) -> Result<(StatusCode, Json<Game>), StatusCode> {
    let account = require_account(&headers).await?;
    if !valid_title(&req.title) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let game = db::create_game(pool, &account.id, req.title.trim())
        .await
        .map_err(|e| db_err("create", e))?;
    Ok((StatusCode::CREATED, Json(game)))
}

async fn list_games(
    State(state): State<AppState>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
) -> Result<Json<Vec<Game>>, StatusCode> {
    let account = require_account(&headers).await?;
    let all = query_param(query.as_deref(), "all") == Some("1");
    if all && !account.is_developer() {
        return Err(StatusCode::FORBIDDEN);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let games = if all { db::list_all_games(pool).await } else { db::list_games_by_owner(pool, &account.id).await };
    games.map(Json).map_err(|e| db_err("list", e))
}

/// 404 when the game does not exist, 403 unless the caller owns it or is a developer.
pub(crate) async fn require_editor(pool: &db::Db, account: &Account, game_id: &str) -> Result<(), StatusCode> {
    match db::game_owner(pool, game_id).await.map_err(|e| db_err("owner", e))? {
        None => Err(StatusCode::NOT_FOUND),
        Some(owner) if owner != account.id && !account.is_developer() => Err(StatusCode::FORBIDDEN),
        Some(_) => Ok(()),
    }
}

#[derive(Debug, Deserialize)]
struct UpdateGameRequest {
    title: Option<String>,
    description: Option<String>,
}

async fn update_game(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(game_id): Path<String>,
    Json(req): Json<UpdateGameRequest>,
) -> Result<Json<Game>, StatusCode> {
    let account = require_account(&headers).await?;
    if !valid_uuid(&game_id)
        || (req.title.is_none() && req.description.is_none())
        || req.title.as_deref().is_some_and(|t| !valid_title(t))
        || req.description.as_deref().is_some_and(|d| d.len() > MAX_DESCRIPTION_LEN)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    require_editor(pool, &account, &game_id).await?;
    db::update_game_meta(pool, &game_id, req.title.as_deref().map(str::trim), req.description.as_deref())
        .await
        .map_err(|e| db_err("update", e))?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn put_cover(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(game_id): Path<String>,
    body: Bytes,
) -> Result<StatusCode, StatusCode> {
    let account = require_account(&headers).await?;
    if !valid_uuid(&game_id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let declared = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or_default();
    if !matches!(declared, "image/jpeg" | "image/png") || sniff(&body) != Some(declared) {
        return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    require_editor(pool, &account, &game_id).await?;
    if !db::set_cover(pool, &game_id, Some((declared, &body))).await.map_err(|e| db_err("cover", e))? {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_cover(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(game_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let account = require_account(&headers).await?;
    if !valid_uuid(&game_id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    require_editor(pool, &account, &game_id).await?;
    if !db::set_cover(pool, &game_id, None).await.map_err(|e| db_err("cover", e))? {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Public like the avatars: AsyncImage and <img> cannot send an Authorization header, ids are random uuids.
async fn fetch_cover(State(state): State<AppState>, Path(game_id): Path<String>) -> Result<Response, StatusCode> {
    if !valid_uuid(&game_id) {
        return Err(StatusCode::NOT_FOUND);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    match db::get_cover(pool, &game_id).await.map_err(|e| db_err("cover", e))? {
        Some((ty, bytes)) => Ok(([(header::CONTENT_TYPE, ty), (header::CACHE_CONTROL, "no-cache".to_string())], bytes).into_response()),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn publish_version(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(game_id): Path<String>,
    Json(body): Json<NewGameVersion>,
) -> Result<(StatusCode, Json<GameVersion>), StatusCode> {
    let account = require_account(&headers).await?;
    if !valid_uuid(&game_id) || !valid_version(&body) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    require_editor(pool, &account, &game_id).await?;
    crate::api::assets::check_refs(&body.assets).await?;
    let v = db::insert_game_version(pool, &game_id, &body)
        .await
        .map_err(|e| db_err("publish", e))?;
    session::reload(&game_id, &v); // a live session restarts on the new version
    Ok((StatusCode::CREATED, Json(v)))
}

async fn fetch_version(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((game_id, version)): Path<(String, String)>,
) -> Result<Json<GameVersion>, StatusCode> {
    require_account(&headers).await?;
    let version = parse_version(&version).map_err(|_| StatusCode::BAD_REQUEST)?;
    if !valid_uuid(&game_id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    db::fetch_game_version(pool, &game_id, version)
        .await
        .map_err(|e| db_err("fetch", e))?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn remove_game(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(game_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let account = require_account(&headers).await?;
    if !valid_uuid(&game_id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    require_editor(pool, &account, &game_id).await?;
    if !db::delete_game(pool, &game_id)
        .await
        .map_err(|e| db_err("delete", e))?
    {
        return Err(StatusCode::NOT_FOUND); // a concurrent request deleted it first
    }
    session::close(&game_id); // anyone playing it is disconnected
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize)]
struct LobbyPlayer {
    id: String,
    name: String,
}

#[derive(Debug, Serialize)]
struct LobbyInfo {
    code: String,
    players: Vec<LobbyPlayer>,
}

/// GET /api/games/{id}/lobbies: the game's live lobbies, from the in-memory registry only.
async fn list_lobbies(headers: HeaderMap, Path(id): Path<String>) -> Result<Json<Vec<LobbyInfo>>, StatusCode> {
    require_account(&headers).await?;
    let out = session::lobbies(&id)
        .into_iter()
        .map(|(code, ps)| LobbyInfo {
            code,
            players: ps.into_iter().map(|(id, name)| LobbyPlayer { id, name }).collect(),
        })
        .collect();
    Ok(Json(out))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/games", post(create_game).get(list_games))
        .route("/api/games/{id}", delete(remove_game).put(update_game))
        .route(
            "/api/games/{id}/cover",
            get(fetch_cover).put(put_cover).delete(remove_cover).layer(DefaultBodyLimit::max(MAX_COVER_BYTES)),
        )
        .route("/api/games/{id}/lobbies", get(list_lobbies))
        .route("/api/games/{id}/versions", post(publish_version))
        .route("/api/games/{id}/versions/{version}", get(fetch_version))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const GID: &str = "123e4567-e89b-12d3-a456-426614174000";

    fn nv(run_mode: &str) -> NewGameVersion {
        NewGameVersion {
            scene: json!({}),
            client_scripts: json!({}),
            server_scripts: json!({}),
            assets: json!({}),
            metadata: json!({}),
            run_mode: run_mode.into(),
        }
    }

    #[test]
    fn uuid_title_version_validation() {
        assert!(valid_uuid(GID));
        assert!(!valid_uuid("nope"));
        assert!(!valid_uuid("123e4567-e89b-12d3-a456-42661417400g"));
        assert!(!valid_uuid("123e4567e89b12d3a456426614174000"));
        assert!(valid_title("Game"));
        assert!(!valid_title("   "));
        assert!(!valid_title(&"x".repeat(MAX_TITLE_LEN + 1)));
        assert_eq!(parse_version("latest"), Ok(None));
        assert_eq!(parse_version("3"), Ok(Some(3)));
        assert!(parse_version("0").is_err());
        assert!(parse_version("-1").is_err());
        assert!(parse_version("x").is_err());
    }

    #[test]
    fn version_content_validation() {
        assert!(valid_version(&nv("screen")));
        assert!(valid_version(&nv("device")));
        assert!(!valid_version(&nv("vr")));
        let mut bad = nv("screen");
        bad.scene = json!([1]);
        assert!(!valid_version(&bad));
    }

    fn token() -> String {
        crate::api::accounts::test_token("games-test-account")
    }

    async fn request(raw: &str) -> String {
        request_with(None, raw).await
    }

    async fn request_with(db: Option<db::Db>, raw: &str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = routes().with_state(AppState { db });
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(raw.as_bytes()).await.unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).await.unwrap();
        buf
    }

    fn post_json(path: &str, tok: Option<&str>, body: &str) -> String {
        let auth = tok
            .map(|t| format!("Authorization: Bearer {t}\r\n"))
            .unwrap_or_default();
        format!(
            "POST {path} HTTP/1.1\r\nHost: x\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn get_req(path: &str, tok: Option<&str>) -> String {
        let auth = tok
            .map(|t| format!("Authorization: Bearer {t}\r\n"))
            .unwrap_or_default();
        format!("GET {path} HTTP/1.1\r\nHost: x\r\n{auth}Connection: close\r\n\r\n")
    }

    fn delete_req(path: &str, tok: Option<&str>) -> String {
        let auth = tok
            .map(|t| format!("Authorization: Bearer {t}\r\n"))
            .unwrap_or_default();
        format!("DELETE {path} HTTP/1.1\r\nHost: x\r\n{auth}Connection: close\r\n\r\n")
    }

    #[tokio::test]
    async fn delete_is_owner_only_and_removes_the_game() {
        let mem = db::Db::Mem(crate::memstore::MemStore::default());
        let owner = token();
        let other = crate::api::accounts::test_token("someone-else");
        let g = db::create_game(&mem, "games-test-account", "T").await.unwrap();
        let path = format!("/api/games/{}", g.id);
        let r = request_with(Some(mem.clone()), &delete_req(&path, None)).await;
        assert!(r.starts_with("HTTP/1.1 401"), "{r}");
        let r = request_with(Some(mem.clone()), &delete_req("/api/games/not-a-uuid", Some(&owner))).await;
        assert!(r.starts_with("HTTP/1.1 400"), "{r}");
        let r = request_with(Some(mem.clone()), &delete_req(&path, Some(&other))).await;
        assert!(r.starts_with("HTTP/1.1 403"), "{r}");
        let r = request_with(Some(mem.clone()), &delete_req(&format!("/api/games/{GID}"), Some(&owner))).await;
        assert!(r.starts_with("HTTP/1.1 404"), "{r}");
        let r = request_with(Some(mem.clone()), &get_req("/api/games", Some(&owner))).await;
        assert!(r.contains(&g.id), "{r}");
        let r = request_with(Some(mem.clone()), &delete_req(&path, Some(&owner))).await;
        assert!(r.starts_with("HTTP/1.1 204"), "{r}");
        let r = request_with(Some(mem.clone()), &get_req("/api/games", Some(&owner))).await;
        assert!(!r.contains(&g.id), "{r}");
        let r = request_with(Some(mem), &delete_req(&path, Some(&owner))).await;
        assert!(r.starts_with("HTTP/1.1 404"), "{r}");
    }

    #[tokio::test]
    async fn delete_without_database_is_503() {
        let r = request(&delete_req(&format!("/api/games/{GID}"), Some(&token()))).await;
        assert!(r.starts_with("HTTP/1.1 503"), "{r}");
    }

    #[tokio::test]
    async fn unauthenticated_requests_are_401() {
        let r = request(&get_req("/api/games", None)).await;
        assert!(r.starts_with("HTTP/1.1 401"), "{r}");
        let r = request(&post_json("/api/games", None, r#"{"title":"t"}"#)).await;
        assert!(r.starts_with("HTTP/1.1 401"), "{r}");
        let body = serde_json::to_string(&nv("screen")).unwrap();
        let r = request(&post_json(&format!("/api/games/{GID}/versions"), None, &body)).await;
        assert!(r.starts_with("HTTP/1.1 401"), "{r}");
        let r = request(&get_req(&format!("/api/games/{GID}/versions/latest"), None)).await;
        assert!(r.starts_with("HTTP/1.1 401"), "{r}");
    }

    #[tokio::test]
    async fn bad_input_is_400_before_db() {
        let t = token();
        let r = request(&post_json("/api/games", Some(&t), r#"{"title":"  "}"#)).await;
        assert!(r.starts_with("HTTP/1.1 400"), "{r}");
        let body = serde_json::to_string(&nv("vr")).unwrap();
        let r = request(&post_json(&format!("/api/games/{GID}/versions"), Some(&t), &body)).await;
        assert!(r.starts_with("HTTP/1.1 400"), "{r}");
        let body = serde_json::to_string(&nv("screen")).unwrap();
        let r = request(&post_json("/api/games/not-a-uuid/versions", Some(&t), &body)).await;
        assert!(r.starts_with("HTTP/1.1 400"), "{r}");
        let r = request(&get_req(&format!("/api/games/{GID}/versions/abc"), Some(&t))).await;
        assert!(r.starts_with("HTTP/1.1 400"), "{r}");
    }

    #[tokio::test]
    async fn valid_request_without_database_is_503() {
        let t = token();
        let r = request(&get_req("/api/games", Some(&t))).await;
        assert!(r.starts_with("HTTP/1.1 503"), "{r}");
        let r = request(&get_req(&format!("/api/games/{GID}/versions/latest"), Some(&t))).await;
        assert!(r.starts_with("HTTP/1.1 503"), "{r}");
        let body = serde_json::to_string(&nv("device")).unwrap();
        let r = request(&post_json(&format!("/api/games/{GID}/versions"), Some(&t), &body)).await;
        assert!(r.starts_with("HTTP/1.1 503"), "{r}");
    }
}
