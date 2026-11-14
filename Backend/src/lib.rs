// Library half of the crate so integration tests in tests/ can build the router; main.rs only starts the server.
pub mod api;
pub mod db;
pub mod game_server;

use axum::{routing::get, Router};
use sqlx::postgres::PgPool;

/// Shared handler state. `db` is None when DATABASE_URL is unset.
#[derive(Clone)]
#[allow(dead_code)] // read by the db.rs / api items that follow
pub struct AppState {
    pub db: Option<PgPool>,
}

async fn health() -> &'static str {
    "ok"
}

/// Builds the router. Later items mount `/api` (accounts, games) and the `/play` WebSocket here.
pub fn app(db: Option<PgPool>) -> Router {
    Router::new()
        .route("/health", get(health))
        .merge(api::accounts::routes())
        .merge(api::games::routes())
        .merge(game_server::session::routes())
        .with_state(AppState { db })
}
