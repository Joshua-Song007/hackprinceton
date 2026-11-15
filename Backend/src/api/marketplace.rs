// Plugin marketplace registry: versioned plugins, gzip tarball bundles in object storage (blobs.rs),
// each with a SHA-256 and the server's Ed25519 signature (crypto.rs), authenticated publish with
// review, and install records per account. Queries go through db.rs only.
//
// Routes:
//   GET    /api/plugins                         -> 200 [PluginSummary] (latest approved version of each)
//   GET    /api/plugins/{id}                    -> 200 {id, version, manifest, sha256, signature, size}
//   GET    /api/plugins/{id}/bundle[?version=v] -> 200 application/gzip tarball (approved versions only)
//   POST   /api/plugins                         -> 201 {id, version, status, sha256}; body = gzip tarball
//                                                  (e.g. `tar czf - -C <dir> . | curl --data-binary @- ...`)
//   POST   /api/plugins/{id}/versions/{v}/review -> 200 {status}; body {"status":"approved|rejected"}
//   POST   /api/plugins/{id}/installs           -> 200 {installs}; body {"version":v} optional
//   DELETE /api/plugins/{id}/installs           -> 200 {installs}
//   GET    /api/me/plugins                      -> 200 [{id, version, installed}]
//   GET    /api/plugin-signing-key              -> 200 {publicKey} (hex Ed25519)
// Publish, review, installs and /api/me need a session (401); review needs an account listed in
// PEAR_PLUGIN_REVIEWERS (comma-separated account ids, 403 otherwise). Unknown id -> 404 {"error":..}.
// The seed job (`pear-backend seed <dir>`, or PEAR_PLUGIN_SEED_DIR at startup on a dev box) publishes
// every plugin dir as approved with no author; re-running it with unchanged plugins changes nothing.

use std::path::Path as FsPath;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::api::accounts::authenticate;
use crate::blobs::blobs;
use crate::bundle::{self, Files, MANIFEST_FILE};
use crate::crypto::signer;
use crate::db::{self, Account, Db, PluginVersion};
use crate::AppState;

type ApiError = (StatusCode, Json<Value>);

const MAX_UPLOAD_BYTES: usize = 16 * 1024 * 1024;

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

fn signed_in(headers: &HeaderMap) -> Result<Account, ApiError> {
    authenticate(headers).ok_or_else(|| error(StatusCode::UNAUTHORIZED, "sign in first"))
}

/// Plugin ids: 1-64 of [a-z0-9-].
pub fn valid_plugin_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Versions are 1-4 dot-separated numbers ("0.7.37"); None for anything else.
pub fn parse_version(v: &str) -> Option<Vec<u64>> {
    let parts: Option<Vec<u64>> = v.split('.').map(|p| (!p.is_empty() && p.len() <= 9 && p.bytes().all(|b| b.is_ascii_digit())).then(|| p.parse().ok()).flatten()).collect();
    parts.filter(|p| (1..=4).contains(&p.len()))
}

/// Compares versions numerically; missing parts count as 0 ("1.2" == "1.2.0").
fn version_cmp(a: &[u64], b: &[u64]) -> std::cmp::Ordering {
    let n = a.len().max(b.len());
    (0..n).map(|i| a.get(i).unwrap_or(&0).cmp(b.get(i).unwrap_or(&0))).find(|o| o.is_ne()).unwrap_or(std::cmp::Ordering::Equal)
}

#[derive(Debug, PartialEq)]
pub enum Published {
    New(PluginVersion),
    /// The same version with the same content is already stored: nothing changed.
    Unchanged(PluginVersion),
}

/// Validates a plugin's files, builds the tarball, stores it and records the version.
/// `author` None = the seed job (approved, may only touch plugins with no author).
pub async fn publish_files(db: &Db, author: Option<&str>, files: Files, status: &str) -> Result<Published, ApiError> {
    let bad = |m: String| error(StatusCode::BAD_REQUEST, &m);
    let raw = files.get(MANIFEST_FILE).ok_or_else(|| bad(format!("bundle has no {MANIFEST_FILE}")))?;
    let manifest: Value = serde_json::from_slice(raw).map_err(|e| bad(format!("bad {MANIFEST_FILE}: {e}")))?;
    let id = manifest["id"].as_str().unwrap_or_default().to_string();
    if !valid_plugin_id(&id) {
        return Err(bad(format!("plugin id {id:?} must be 1-64 of [a-z0-9-]")));
    }
    let version = manifest["version"].as_str().unwrap_or_default().to_string();
    let parsed = parse_version(&version).ok_or_else(|| bad(format!("version {version:?} must look like 1.2.3")))?;

    if let Some(owner) = db::plugin_author(db, &id).await.map_err(|e| db_err("publish", e))? {
        if owner.as_deref() != author {
            return Err(error(StatusCode::FORBIDDEN, &format!("plugin {id} belongs to another author")));
        }
    }
    let tarball = bundle::build_tarball(&files);
    let sha256 = hex::encode(Sha256::digest(&tarball));
    if let Some(latest) = db::latest_plugin_version(db, &id, false).await.map_err(|e| db_err("publish", e))? {
        if latest.version == version && latest.sha256 == sha256 {
            // Same content: only put the tarball back if storage lost it (memory store after a restart).
            if matches!(blobs().get(&latest.object_key).await, Ok(None)) {
                let _ = blobs().put(&latest.object_key, tarball).await;
            }
            return Ok(Published::Unchanged(latest));
        }
        let older = parse_version(&latest.version).unwrap_or_default();
        if version_cmp(&parsed, &older).is_le() {
            return Err(error(StatusCode::CONFLICT, &format!("version {version} must be higher than {}", latest.version)));
        }
    }
    let object_key = format!("plugins/{id}/{sha256}.tar.gz");
    let size = tarball.len() as i64;
    blobs().put(&object_key, tarball).await.map_err(|e| {
        eprintln!("marketplace: store {object_key}: {e}");
        error(StatusCode::BAD_GATEWAY, "bundle storage failed")
    })?;
    let v = PluginVersion {
        signature: signer().sign(&id, &version, &sha256),
        plugin_id: id,
        version,
        manifest,
        sha256,
        object_key,
        size,
        status: status.into(),
    };
    db::insert_plugin_version(db, author, &v).await.map_err(|e| db_err("publish", e))?;
    Ok(Published::New(v))
}

async fn list(State(state): State<AppState>) -> Result<Json<Vec<db::PluginSummary>>, ApiError> {
    db::list_plugins(store(&state)?).await.map(Json).map_err(|e| db_err("list", e))
}

async fn listed(db: &Db, id: &str) -> Result<PluginVersion, ApiError> {
    db::latest_plugin_version(db, id, true)
        .await
        .map_err(|e| db_err("release", e))?
        .ok_or_else(|| unknown_plugin(id))
}

async fn release(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let v = listed(store(&state)?, &id).await?;
    Ok(Json(json!({ "id": v.plugin_id, "version": v.version, "manifest": v.manifest, "sha256": v.sha256, "signature": v.signature, "size": v.size })))
}

#[derive(Deserialize)]
struct VersionQuery {
    version: Option<String>,
}

async fn bundle_bytes(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<VersionQuery>) -> Result<Response, ApiError> {
    let db = store(&state)?;
    let v = match q.version {
        Some(version) => db::find_plugin_version(db, &id, &version)
            .await
            .map_err(|e| db_err("bundle", e))?
            .filter(|v| v.status == "approved")
            .ok_or_else(|| error(StatusCode::NOT_FOUND, &format!("unknown version {version} of {id}")))?,
        None => listed(db, &id).await?,
    };
    let bytes = blobs()
        .get(&v.object_key)
        .await
        .map_err(|e| {
            eprintln!("marketplace: fetch {}: {e}", v.object_key);
            error(StatusCode::BAD_GATEWAY, "bundle storage failed")
        })?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "bundle missing from storage; re-run the seed job"))?;
    Ok(([(header::CONTENT_TYPE, "application/gzip".to_string()), (header::HeaderName::from_static("x-pear-sha256"), v.sha256)], bytes).into_response())
}

async fn publish(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> Result<(StatusCode, Json<Value>), ApiError> {
    let me = signed_in(&headers)?;
    let db = store(&state)?;
    let files = bundle::read_tarball(&body).map_err(|e| error(StatusCode::BAD_REQUEST, &e))?;
    match publish_files(db, Some(&me.id), files, "pending").await? {
        Published::New(v) => Ok((StatusCode::CREATED, Json(json!({ "id": v.plugin_id, "version": v.version, "status": v.status, "sha256": v.sha256 })))),
        Published::Unchanged(v) => Err(error(StatusCode::CONFLICT, &format!("version {} is already published", v.version))),
    }
}

fn is_reviewer(account_id: &str) -> bool {
    std::env::var("PEAR_PLUGIN_REVIEWERS").unwrap_or_default().split(',').any(|r| r.trim() == account_id)
}

#[derive(Deserialize)]
struct ReviewRequest {
    status: String,
}

async fn review(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, version)): Path<(String, String)>,
    Json(req): Json<ReviewRequest>,
) -> Result<Json<Value>, ApiError> {
    let me = signed_in(&headers)?;
    if !is_reviewer(&me.id) {
        return Err(error(StatusCode::FORBIDDEN, "not a plugin reviewer"));
    }
    if !matches!(req.status.as_str(), "approved" | "rejected") {
        return Err(error(StatusCode::BAD_REQUEST, "status must be approved or rejected"));
    }
    let found = db::set_plugin_version_status(store(&state)?, &id, &version, &req.status)
        .await
        .map_err(|e| db_err("review", e))?;
    if !found {
        return Err(error(StatusCode::NOT_FOUND, &format!("unknown version {version} of {id}")));
    }
    Ok(Json(json!({ "status": req.status })))
}

async fn record_install(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>, body: Bytes) -> Result<Json<Value>, ApiError> {
    let me = signed_in(&headers)?;
    let db = store(&state)?;
    let asked = serde_json::from_slice::<Value>(&body).ok().and_then(|b| b["version"].as_str().map(String::from));
    let version = match asked {
        Some(v) => v,
        None => listed(db, &id).await?.version,
    };
    let installs = db::set_plugin_install(db, &id, &me.id, Some(&version))
        .await
        .map_err(|e| db_err("install", e))?
        .ok_or_else(|| unknown_plugin(&id))?;
    Ok(Json(json!({ "installs": installs })))
}

async fn record_uninstall(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let me = signed_in(&headers)?;
    let installs = db::set_plugin_install(store(&state)?, &id, &me.id, None)
        .await
        .map_err(|e| db_err("uninstall", e))?
        .ok_or_else(|| unknown_plugin(&id))?;
    Ok(Json(json!({ "installs": installs })))
}

async fn mine(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Vec<db::InstallRecord>>, ApiError> {
    let me = signed_in(&headers)?;
    db::plugin_installs_of(store(&state)?, &me.id).await.map(Json).map_err(|e| db_err("mine", e))
}

async fn signing_key() -> Json<Value> {
    Json(json!({ "publicKey": signer().public_hex() }))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/plugins", get(list).post(publish).layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES)))
        .route("/api/plugins/{id}", get(release))
        .route("/api/plugins/{id}/bundle", get(bundle_bytes))
        .route("/api/plugins/{id}/versions/{version}/review", post(review))
        .route("/api/plugins/{id}/installs", post(record_install).delete(record_uninstall))
        .route("/api/me/plugins", get(mine))
        .route("/api/plugin-signing-key", get(signing_key))
}

/// Publishes one plugin per subdirectory of `seed_dir` that has an pear-plugin.json, as approved
/// with no author. Unchanged plugins are left alone; a bad plugin is logged and skipped.
/// Returns (published, unchanged, failed) counts.
pub async fn seed(db: &Db, seed_dir: &FsPath) -> (usize, usize, usize) {
    let dir = seed_dir.to_path_buf();
    let read = tokio::task::spawn_blocking(move || {
        let mut dirs: Vec<_> = std::fs::read_dir(&dir)
            .map_err(|e| format!("cannot read {}: {e}", dir.display()))?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.join(MANIFEST_FILE).is_file())
            .collect();
        dirs.sort();
        Ok::<_, String>(dirs.into_iter().map(|d| (d.clone(), bundle::collect_dir(&d))).collect::<Vec<_>>())
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()));
    let plugins = match read {
        Ok(p) => p,
        Err(e) => {
            eprintln!("marketplace: seed: {e}");
            return (0, 0, 1);
        }
    };
    let mut counts = (0, 0, 0);
    for (dir, files) in plugins {
        let result = match files {
            Ok(files) => publish_files(db, None, files, "approved").await.map_err(|(_, Json(b))| b["error"].as_str().unwrap_or_default().to_string()),
            Err(e) => Err(e),
        };
        match result {
            Ok(Published::New(v)) => {
                counts.0 += 1;
                eprintln!("marketplace: seeded {} {} ({} bytes, sha256 {})", v.plugin_id, v.version, v.size, v.sha256);
            }
            Ok(Published::Unchanged(v)) => {
                counts.1 += 1;
                eprintln!("marketplace: {} {} unchanged", v.plugin_id, v.version);
            }
            Err(e) => {
                counts.2 += 1;
                eprintln!("marketplace: skipping {}: {e}", dir.display());
            }
        }
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_versions() {
        assert!(valid_plugin_id("langchain-deepagents") && valid_plugin_id("a1"));
        for bad in ["", "A", "a_b", "a.b", "../x", &"a".repeat(65)] {
            assert!(!valid_plugin_id(bad), "{bad}");
        }
        assert_eq!(parse_version("0.7.37"), Some(vec![0, 7, 37]));
        for bad in ["", "1.", "v1", "1.2.3-beta", "1.2.3.4.5", "1..2", "1.2.x"] {
            assert_eq!(parse_version(bad), None, "{bad}");
        }
        let v = |s| parse_version(s).unwrap();
        assert!(version_cmp(&v("0.7.38"), &v("0.7.37")).is_gt());
        assert!(version_cmp(&v("0.10"), &v("0.9.9")).is_gt());
        assert!(version_cmp(&v("1.2"), &v("1.2.0")).is_eq());
    }
}
