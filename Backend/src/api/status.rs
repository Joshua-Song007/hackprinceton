// GET /api/status: liveness plus what the deploy needs to see. Public: {ok, version, storage, database}.
// With a developer bearer it adds storage_detail {description, probe: {ok, reason?, at} | null}, instances,
// players, uptime_s and limits. A storage probe runs once at startup (main.rs) and its result is cached;
// a developer can force a fresh one with ?probe=1. `version` is the crate version plus PEAR_BUILD (git short sha).

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

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/status", get(status))
}
