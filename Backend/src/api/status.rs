// GET /api/status: liveness plus what the deploy needs to see. Public: {ok, version, storage, database}.
// With a developer bearer it adds storage_detail {description, probe: {ok, reason?, at} | null}, instances,
// players, uptime_s and limits. A storage probe runs once at startup (main.rs) and its result is cached;
// a developer can force a fresh one with ?probe=1. `version` is the crate version plus PEAR_BUILD (git short sha).
// GET /api/version (public): {version, build, crate, database, migrations: {known, applied, pending}}; the deploy checks it
// is not behind. `applied` probes the same table/column markers db::migrate uses (there is no migrations table), and is
// null for the memory store, which has no schema.

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use axum::extract::{RawQuery, State};
use axum::http::HeaderMap;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{json, Value};

use crate::api::accounts::{authenticate, query_param};
use crate::blobs::blobs;
use crate::db::Db;
use crate::game_server::session;
use crate::AppState;

#[derive(Clone, Serialize)]
pub struct ProbeResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub at: String,
}

fn last_probe() -> &'static Mutex<Option<ProbeResult>> {
    static P: OnceLock<Mutex<Option<ProbeResult>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(None))
}

fn started() -> Instant {
    static S: OnceLock<Instant> = OnceLock::new();
    *S.get_or_init(Instant::now)
}

/// Starts the uptime clock; main calls it first thing.
pub fn mark_started() {
    started();
}

/// Probes the blob store and caches the result.
pub async fn run_probe() -> ProbeResult {
    let r = blobs().probe().await;
    let res = ProbeResult { ok: r.is_ok(), reason: r.err(), at: crate::memstore::now_rfc3339() };
    *last_probe().lock().unwrap_or_else(|p| p.into_inner()) = Some(res.clone());
    res
}

fn version() -> String {
    let build = std::env::var("PEAR_BUILD").ok().filter(|b| !b.trim().is_empty()).unwrap_or_else(|| "dev".into());
    format!("{}+{build}", env!("CARGO_PKG_VERSION"))
}

async fn status(State(state): State<AppState>, headers: HeaderMap, RawQuery(query): RawQuery) -> Json<Value> {
    let database = match &state.db {
        Some(Db::Pg(_)) => "postgres",
        Some(Db::Mem(_)) => "memory",
        None => "none",
    };
    let mut out = json!({ "ok": true, "version": version(), "storage": blobs().kind(), "database": database });
    if authenticate(&headers).await.is_some_and(|a| a.is_developer()) {
        let probe = if query_param(query.as_deref(), "probe") == Some("1") {
            Some(run_probe().await)
        } else {
            last_probe().lock().unwrap_or_else(|p| p.into_inner()).clone()
        };
        let (instances, players) = session::counts();
        let (max_instances, max_players) = session::limits();
        out["storage_detail"] = json!({ "description": blobs().describe(), "probe": probe });
        out["instances"] = json!(instances);
        out["players"] = json!(players);
        out["uptime_s"] = json!(started().elapsed().as_secs());
        out["limits"] = json!({
            "max_instances": max_instances,
            "max_players_per_instance": max_players,
            "max_asset_bytes": crate::api::assets::MAX_ASSET_BYTES,
        });
    }
    Json(out)
}

/// Migration files and the schema marker that shows each one ran: ("table", None) or ("table", Some("column")).
/// Keep in step with Backend/migrations and db::migrate (a test checks the names against the directory).
const MIGRATIONS: [(&str, &str, Option<&str>); 7] = [
    ("0001_init", "accounts", None),
    ("0002_plugins", "plugins", None),
    ("0003_marketplace_cloud", "plugin_versions", None),
    ("0004_friends", "friendships", None),
    ("0005_developer", "accounts", Some("role")),
    ("0006_sessions", "sessions", None),
    ("0007_listing", "games", Some("listed")),
];

async fn applied_migrations(state: &AppState) -> Option<Vec<&'static str>> {
    let Some(Db::Pg(pool)) = &state.db else { return None };
    let mut applied = Vec::new();
    for (name, table, column) in MIGRATIONS {
        let ran: bool = match column {
            None => sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL").bind(format!("public.{table}")).fetch_one(pool).await,
            Some(c) => sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2)",
            )
            .bind(table)
            .bind(c)
            .fetch_one(pool)
            .await,
        }
        .unwrap_or(false);
        if ran {
            applied.push(name);
        }
    }
    Some(applied)
}

async fn version_info(State(state): State<AppState>) -> Json<Value> {
    let known: Vec<&str> = MIGRATIONS.iter().map(|m| m.0).collect();
    let applied = applied_migrations(&state).await;
    let pending = applied.as_ref().map(|a| known.iter().filter(|k| !a.contains(k)).copied().collect::<Vec<_>>());
    let database = match &state.db {
        Some(Db::Pg(_)) => "postgres",
        Some(Db::Mem(_)) => "memory",
        None => "none",
    };
    let build = std::env::var("PEAR_BUILD").ok().filter(|b| !b.trim().is_empty()).unwrap_or_else(|| "dev".into());
    Json(json!({
        "version": version(), "build": build, "crate": env!("CARGO_PKG_VERSION"), "database": database,
        "migrations": { "known": known, "applied": applied, "pending": pending },
    }))
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/status", get(status)).route("/api/version", get(version_info))
}

#[cfg(test)]
mod tests {
    #[test]
    fn migration_list_matches_the_directory() {
        let mut files: Vec<String> = std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/migrations"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().trim_end_matches(".sql").to_string())
            .collect();
        files.sort();
        let known: Vec<&str> = super::MIGRATIONS.iter().map(|m| m.0).collect();
        assert_eq!(files, known);
    }
}
