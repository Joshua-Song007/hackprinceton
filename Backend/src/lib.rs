// Library half of the crate so integration tests in tests/ can build the router; main.rs only starts the server.
pub mod api;
pub mod db;
pub mod game_server;
pub mod memstore;

use std::path::PathBuf;

use axum::http::{header, HeaderValue, Method};
use axum::{routing::get, Router};
use db::Db;
use sqlx::postgres::PgPool;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

/// Origins allowed when OMNI_CORS_ORIGINS is unset: the Studio desktop app (Tauri) and the Vite dev server.
const DEFAULT_CORS_ORIGINS: &str =
    "tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://localhost:5173";

/// Shared handler state. `db` is None only when DATABASE_URL is set but invalid; unset means the in-memory store.
#[derive(Clone)]
#[allow(dead_code)] // read by the db.rs / api items that follow
pub struct AppState {
    pub db: Option<Db>,
}

async fn health() -> &'static str {
    "ok"
}

/// CORS for the Studio: origins from OMNI_CORS_ORIGINS (comma-separated), else the defaults above.
fn cors_layer() -> CorsLayer {
    let configured = std::env::var("OMNI_CORS_ORIGINS").unwrap_or_else(|_| DEFAULT_CORS_ORIGINS.to_string());
    let origins: Vec<HeaderValue> = configured
        .split(',')
        .filter_map(|o| HeaderValue::from_str(o.trim()).ok())
        .collect();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
}

/// Builds the router without a Studio. Later items mount `/api` (accounts, games) and the `/play` WebSocket here.
pub fn app(db: Option<PgPool>) -> Router {
    app_with_studio(db.map(Db::Pg), None)
}

/// Builds the router; with `studio_dir` the built Studio is served at `/` and unknown paths fall
/// back to its index.html (single-page app routing).
pub fn app_with_studio(db: Option<Db>, studio_dir: Option<PathBuf>) -> Router {
    // Needs a Tokio runtime; main and the tests that build the app run inside one.
    if let (Some(db), Ok(dir)) = (db.clone(), std::env::var("OMNI_PLUGIN_SEED_DIR")) {
        tokio::spawn(async move { api::marketplace::seed(&db, std::path::Path::new(&dir)).await });
    }
    let router = Router::new()
        .route("/health", get(health))
        .merge(api::accounts::routes())
        .merge(api::games::routes())
        .merge(api::library::routes())
        .merge(api::marketplace::routes())
        .merge(api::apple::routes())
        .merge(game_server::session::routes())
        .merge(game_server::debug::routes());
    let router = match studio_dir {
        Some(dir) => router.fallback_service(ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html")))),
        None => router,
    };
    router.layer(cors_layer()).with_state(AppState { db })
}
