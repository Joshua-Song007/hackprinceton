// Game assets in the blob store, content-addressed: bytes live at assets/<sha256> (identical uploads dedup),
// the content type in a small sidecar object assets/<sha256>.type. GET is public (images, <audio> and <iframe>
// cannot send an Authorization header; the address is a hash of the content).
//
// Routes:
//   PUT /api/games/{id}/assets/{name}  raw body <= 10 MB, name [A-Za-z0-9._-]{1,128}, allowed Content-Type
//                                      -> 200 {name, sha256, size, content_type} | 400 | 401 | 403 | 404 | 413 | 415
//                                      (owner or developer)
//   GET /api/assets/{sha256}           -> 200 bytes | 304 | 404; immutable cache, ETag, nosniff
// A published version's `assets` object may map names to {sha256, size, content_type}; publish checks they exist.

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::api::accounts::authenticate;
use crate::api::games::{require_editor, valid_uuid};
use crate::blobs::blobs;
use crate::AppState;

pub const MAX_ASSET_BYTES: usize = 10 * 1024 * 1024;
const ALLOWED_TYPES: [&str; 10] = [
    "image/png",
    "image/jpeg",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "text/html",
    "text/css",
    "application/javascript",
    "application/json",
];

fn valid_name(n: &str) -> bool {
    (1..=128).contains(&n.len()) && n.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

pub(crate) fn valid_sha(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn key(sha: &str) -> String {
    format!("assets/{sha}")
}

/// The media type without parameters, lowercased, if it is allowed.
fn allowed_type(header_value: &str) -> Option<String> {
    let t = header_value.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    ALLOWED_TYPES.contains(&t.as_str()).then_some(t)
}

fn store_err(what: &str, e: String) -> StatusCode {
    eprintln!("assets: {what}: {e}");
    StatusCode::INTERNAL_SERVER_ERROR
}

/// 400 unless every `{sha256}` an `assets` entry carries is well formed and stored; entries without one are left alone.
pub(crate) async fn check_refs(assets: &Value) -> Result<(), StatusCode> {
    let Some(map) = assets.as_object() else { return Ok(()) };
    for sha in map.values().filter_map(|v| v.get("sha256")) {
        let Some(sha) = sha.as_str().filter(|s| valid_sha(s)) else { return Err(StatusCode::BAD_REQUEST) };
        if !blobs().exists(&key(sha)).await.map_err(|e| store_err("exists", e))? {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    Ok(())
}

#[derive(Serialize)]
struct Stored {
    name: String,
    sha256: String,
    size: usize,
    content_type: String,
}

async fn put_asset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((game_id, name)): Path<(String, String)>,
    body: Bytes,
) -> Result<Json<Stored>, StatusCode> {
    let account = authenticate(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    if !valid_uuid(&game_id) || !valid_name(&name) || body.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let declared = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or_default();
    let content_type = allowed_type(declared).ok_or(StatusCode::UNSUPPORTED_MEDIA_TYPE)?;
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    require_editor(pool, &account, &game_id).await?;
    let sha256 = hex::encode(Sha256::digest(&body));
    let size = body.len();
    let k = key(&sha256);
    // ponytail: the sidecar is rewritten on every upload, so the latest declared type wins for identical bytes.
    blobs().put(&k, body.to_vec()).await.map_err(|e| store_err("put", e))?;
    blobs().put(&format!("{k}.type"), content_type.clone().into_bytes()).await.map_err(|e| store_err("put type", e))?;
    Ok(Json(Stored { name, sha256, size, content_type }))
}

async fn get_asset(headers: HeaderMap, Path(sha): Path<String>) -> Result<Response, StatusCode> {
    if !valid_sha(&sha) {
        return Err(StatusCode::NOT_FOUND);
    }
    let etag = format!("\"{sha}\"");
    let cache = [(header::CACHE_CONTROL, "public, max-age=31536000, immutable".to_string()), (header::ETAG, etag.clone())];
    if headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some(etag.as_str()) {
        return Ok((StatusCode::NOT_MODIFIED, cache).into_response());
    }
    let bytes = blobs().get(&key(&sha)).await.map_err(|e| store_err("get", e))?.ok_or(StatusCode::NOT_FOUND)?;
    let ty = blobs().get(&format!("{}.type", key(&sha))).await.map_err(|e| store_err("get type", e))?;
    let ty = ty.and_then(|t| String::from_utf8(t).ok()).unwrap_or_else(|| "application/octet-stream".into());
    let mut res = (cache, [(header::CONTENT_TYPE, ty.clone()), (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string())], bytes).into_response();
    if ty == "text/html" {
        res.headers_mut().insert(header::CONTENT_DISPOSITION, "inline".parse().expect("static header value"));
    }
    Ok(res)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/games/{id}/assets/{name}", put(put_asset).layer(DefaultBodyLimit::max(MAX_ASSET_BYTES)))
        .route("/api/assets/{sha}", get(get_asset))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_shas_and_types() {
        assert!(valid_name("a.png") && valid_name("A_b-1.js") && valid_name(&"x".repeat(128)));
        assert!(!valid_name("") && !valid_name(&"x".repeat(129)) && !valid_name("a/b") && !valid_name("a b") && !valid_name("é"));
        assert!(valid_sha(&"ab".repeat(32)));
        assert!(!valid_sha(&"AB".repeat(32)) && !valid_sha("abc"));
        assert_eq!(allowed_type("Image/PNG; charset=x").as_deref(), Some("image/png"));
        assert_eq!(allowed_type("audio/x-wav").as_deref(), Some("audio/x-wav"));
        assert_eq!(allowed_type("image/svg+xml"), None);
        assert_eq!(allowed_type(""), None);
    }
}
