// Plugin marketplace registry: list plugins, fetch a manifest or bundle, count installs. No auth.
// Plugins are seeded at startup from OMNI_PLUGIN_SEED_DIR (see `seed`); queries go through db.rs only.
//
// Routes:
//   GET  /api/plugins               -> 200 [PluginSummary]
//   GET  /api/plugins/{id}          -> 200 manifest (the omni-plugin.json object)
//   GET  /api/plugins/{id}/bundle   -> 200 {"manifest":{..},"files":{"relpath":"utf8 content"}}
//   POST /api/plugins/{id}/installs -> 200 {"installs":n}
// Unknown id -> 404 {"error":..}.

use std::path::Path as FsPath;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Map, Value};

use crate::db::{self, Db, Plugin, PluginSummary};
use crate::AppState;

type ApiError = (StatusCode, Json<Value>);

const MANIFEST_FILE: &str = "omni-plugin.json";
const MAX_FILE_BYTES: u64 = 256 * 1024;
const SKIPPED_DIRS: [&str; 2] = ["__pycache__", "node_modules"];

fn error(status: StatusCode, msg: &str) -> ApiError {
    (status, Json(json!({ "error": msg })))
}

fn db_err(what: &str, e: sqlx::Error) -> ApiError {
    eprintln!("marketplace: {what}: db error: {e}");
    error(StatusCode::INTERNAL_SERVER_ERROR, "database error")
}

fn unknown_plugin(id: &str) -> ApiError {
    error(StatusCode::NOT_FOUND, &format!("unknown plugin: {id}"))
}

fn store(state: &AppState) -> Result<&Db, ApiError> {
    state
        .db
        .as_ref()
        .ok_or_else(|| error(StatusCode::SERVICE_UNAVAILABLE, "database unavailable"))
}

async fn list(State(state): State<AppState>) -> Result<Json<Vec<PluginSummary>>, ApiError> {
    db::list_plugins(store(&state)?)
        .await
        .map(Json)
        .map_err(|e| db_err("list", e))
}

async fn manifest(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let (manifest, _) = db::get_plugin_content(store(&state)?, &id)
        .await
        .map_err(|e| db_err("manifest", e))?
        .ok_or_else(|| unknown_plugin(&id))?;
    Ok(Json(manifest))
}

async fn bundle(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let (manifest, bundle) = db::get_plugin_content(store(&state)?, &id)
        .await
        .map_err(|e| db_err("bundle", e))?
        .ok_or_else(|| unknown_plugin(&id))?;
    Ok(Json(json!({ "manifest": manifest, "files": bundle["files"] })))
}

async fn record_install(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let installs = db::add_plugin_install(store(&state)?, &id)
        .await
        .map_err(|e| db_err("install", e))?
        .ok_or_else(|| unknown_plugin(&id))?;
    Ok(Json(json!({ "installs": installs })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/plugins", get(list))
        .route("/api/plugins/{id}", get(manifest))
        .route("/api/plugins/{id}/bundle", get(bundle))
        .route("/api/plugins/{id}/installs", post(record_install))
}

/// Collects the files under `dir` into `files` keyed by POSIX relative path. Skips any path segment
/// starting with "." or named in SKIPPED_DIRS, symlinks, files over 256 KiB and non-UTF-8 files.
// shortcut: blocking std::fs inside an async fn, fine for a startup seed of a few small plugins.
fn collect_files(root: &FsPath, dir: &FsPath, files: &mut Map<String, Value>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || SKIPPED_DIRS.contains(&name.as_str()) {
            continue;
        }
        let kind = entry.file_type()?;
        let path = entry.path();
        if kind.is_dir() {
            collect_files(root, &path, files)?;
        } else if kind.is_file() && entry.metadata()?.len() <= MAX_FILE_BYTES {
            if let (Ok(text), Ok(rel)) = (std::fs::read_to_string(&path), path.strip_prefix(root)) {
                let rel: Vec<_> = rel.iter().map(|s| s.to_string_lossy()).collect();
                files.insert(rel.join("/"), Value::String(text));
            }
        }
    }
    Ok(())
}

fn read_plugin(dir: &FsPath) -> Result<Plugin, String> {
    let text = std::fs::read_to_string(dir.join(MANIFEST_FILE)).map_err(|e| e.to_string())?;
    let manifest: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let field = |k: &str| manifest[k].as_str().unwrap_or_default().to_string();
    let id = field("id");
    if id.is_empty() {
        return Err("manifest has no id".into());
    }
    let mut files = Map::new();
    collect_files(dir, dir, &mut files).map_err(|e| e.to_string())?;
    Ok(Plugin {
        id,
        name: field("name"),
        version: field("version"),
        author: field("author"),
        category: field("category"),
        description: field("description"),
        manifest,
        bundle: json!({ "files": files }),
        installs: 0,
    })
}

/// Upserts one plugin per subdirectory of `seed_dir` that has an omni-plugin.json (keeps install
/// counts). A bad plugin is logged and skipped.
pub async fn seed(db: &Db, seed_dir: &FsPath) {
    let Ok(entries) = std::fs::read_dir(seed_dir) else {
        eprintln!("marketplace: cannot read OMNI_PLUGIN_SEED_DIR {}", seed_dir.display());
        return;
    };
    let mut dirs: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.join(MANIFEST_FILE).is_file())
        .collect();
    dirs.sort();
    for dir in dirs {
        match read_plugin(&dir) {
            Ok(plugin) => match db::upsert_plugin(db, &plugin).await {
                Ok(()) => eprintln!("marketplace: seeded {}", plugin.id),
                Err(e) => eprintln!("marketplace: seed {}: db error: {e}", dir.display()),
            },
            Err(e) => eprintln!("marketplace: skipping {}: {e}", dir.display()),
        }
    }
}
