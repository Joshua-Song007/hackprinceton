// Profile pictures: one small JPEG or PNG per account, kept in the blob store under avatars/<account id>.
// The image is public (GET needs no session) because AsyncImage cannot send an Authorization header;
// ids are random uuids and the response is the image only. Removing a picture stores a 0-byte object
// (blobs has put and get only), and GET treats an empty object as none.
//
// Routes:
//   PUT    /api/accounts/me/avatar  raw image body, image/jpeg or image/png, <= 512 KB -> 204 | 413 | 415 | 401
//   DELETE /api/accounts/me/avatar  -> 204
//   GET    /api/avatars/{id}        -> 200 image bytes | 404 none

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::Router;

use crate::api::accounts::authenticate;
use crate::api::games::valid_uuid;
use crate::blobs::blobs;
use crate::AppState;

const MAX_AVATAR_BYTES: usize = 512 * 1024;

fn key(account_id: &str) -> String {
    format!("avatars/{account_id}")
}

/// The image type from its first bytes, so nothing but the bytes is stored.
fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else {
        None
    }
}

async fn upload(headers: HeaderMap, body: Bytes) -> Result<StatusCode, StatusCode> {
    let me = authenticate(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let declared = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or_default();
    if !matches!(declared, "image/jpeg" | "image/png") || sniff(&body) != Some(declared) {
        return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    blobs().put(&key(&me.id), body.to_vec()).await.map_err(|e| {
        eprintln!("avatar: put: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove(headers: HeaderMap) -> Result<StatusCode, StatusCode> {
    let me = authenticate(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    blobs().put(&key(&me.id), Vec::new()).await.map_err(|e| {
        eprintln!("avatar: clear: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(StatusCode::NO_CONTENT)
}

async fn fetch(Path(id): Path<String>) -> Result<Response, StatusCode> {
    // The id becomes part of an object key: only a real uuid gets that far.
    if !valid_uuid(&id) {
        return Err(StatusCode::NOT_FOUND);
    }
    let bytes = blobs().get(&key(&id)).await.map_err(|e| {
        eprintln!("avatar: get: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    match bytes.as_deref().and_then(|b| sniff(b).map(|t| (t, b))) {
        Some((ty, b)) => Ok(([(header::CONTENT_TYPE, ty), (header::CACHE_CONTROL, "no-cache")], b.to_vec()).into_response()),
        None => Err(StatusCode::NOT_FOUND),
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/accounts/me/avatar",
            put(upload).delete(remove).layer(DefaultBodyLimit::max(MAX_AVATAR_BYTES)),
        )
        .route("/api/avatars/{id}", get(fetch))
}
