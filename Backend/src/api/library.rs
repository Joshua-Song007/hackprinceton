// Public game library for the player app: every published game with its newest version's details.
// [provisional: needs-tien-review] Every published game is listed to any signed-in account; permissions
// and moderation are not decided (overview.md Module 11). The description and cover come from the game row.
// Auth is `accounts::authenticate`; queries go through db.rs only. Order per request: auth, db, query.
//
// Routes:
//   GET /api/library -> 200 [CatalogEntry] (any signed-in account; only games their owner has listed)

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;

use crate::api::accounts::authenticate;
use crate::db::{self, CatalogRow};
use crate::AppState;

/// One game in the library, as the player app reads it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub title: String,
    pub author: String,
    pub latest_version: i32,
    pub run_mode: String,
    pub required_tier: i32,
    pub description: String,
    /// "/api/games/{id}/cover?v=<version>" when the game has a cover, else null.
    pub cover_url: Option<String>,
    pub tags: Vec<String>,
    pub release_notes: String,
}

impl From<CatalogRow> for CatalogEntry {
    fn from(r: CatalogRow) -> Self {
        CatalogEntry {
            cover_url: r.cover_version.map(|v| format!("/api/games/{}/cover?v={v}", r.id)),
            description: r.description,
            tags: r.tags,
            release_notes: r.release_notes,
            id: r.id,
            title: r.title,
            author: r.author,
            latest_version: r.latest_version,
            run_mode: r.run_mode,
            required_tier: r.required_tier,
        }
    }
}

async fn list_library(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<CatalogEntry>>, StatusCode> {
    authenticate(&headers).await.ok_or(StatusCode::UNAUTHORIZED)?;
    let pool = state.db.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    db::list_catalog(pool)
        .await
        .map(|rows| Json(rows.into_iter().map(CatalogEntry::from).collect()))
        .map_err(|e| {
            eprintln!("library: list: db error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/library", get(list_library))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Db, Listing, NewGameVersion};
    use crate::memstore::MemStore;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn request(state: AppState, raw: &str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = routes().with_state(state);
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(raw.as_bytes()).await.unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).await.unwrap();
        buf
    }

    fn get_req(tok: Option<&str>) -> String {
        let auth = tok
            .map(|t| format!("Authorization: Bearer {t}\r\n"))
            .unwrap_or_default();
        format!("GET /api/library HTTP/1.1\r\nHost: x\r\n{auth}Connection: close\r\n\r\n")
    }

    #[test]
    fn entry_serializes_camel_case() {
        let e = CatalogEntry::from(CatalogRow {
            id: "i".into(),
            title: "t".into(),
            author: "a".into(),
            latest_version: 3,
            run_mode: "device".into(),
            required_tier: 2,
            description: "d".into(),
            cover_version: Some(7),
            tags: vec!["gps".into()],
            release_notes: "n".into(),
        });
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            json!({"id":"i","title":"t","author":"a","latestVersion":3,"runMode":"device","requiredTier":2,
                   "description":"d","coverUrl":"/api/games/i/cover?v=7","tags":["gps"],"releaseNotes":"n"})
        );
    }

    #[tokio::test]
    async fn signed_out_is_401() {
        let r = request(AppState { db: None }, &get_req(None)).await;
        assert!(r.starts_with("HTTP/1.1 401"), "{r}");
    }

    #[tokio::test]
    async fn signed_in_without_database_is_503() {
        let t = crate::api::accounts::test_token("library-test-503");
        let r = request(AppState { db: None }, &get_req(Some(&t))).await;
        assert!(r.starts_with("HTTP/1.1 503"), "{r}");
    }

    #[tokio::test]
    async fn signed_in_lists_only_listed_published_games() {
        let m = MemStore::default();
        let owner = m.upsert_account("dev", "s", "Ann");
        let g = m.create_game(&owner.id, "Mine");
        m.create_game(&owner.id, "Draft");
        let hidden = m.create_game(&owner.id, "Hidden fixture");
        let nv = NewGameVersion {
            scene: json!({"requiredTier": 2}),
            client_scripts: json!({}),
            server_scripts: json!({}),
            assets: json!({}),
            metadata: json!({}),
            run_mode: "device".into(),
        };
        m.insert_game_version(&g.id, &nv).unwrap();
        m.insert_game_version(&hidden.id, &nv).unwrap(); // published but never listed
        m.set_listing(&g.id, &Listing { listed: Some(true), tags: Some(vec!["gps".into()]), release_notes: Some("first".into()), description: None });
        let t = crate::api::accounts::test_token("library-test-200");
        let r = request(AppState { db: Some(Db::Mem(m)) }, &get_req(Some(&t))).await;
        assert!(r.starts_with("HTTP/1.1 200"), "{r}");
        let body = &r[r.find("\r\n\r\n").unwrap() + 4..];
        let rows: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(
            rows,
            json!([{"id": g.id, "title": "Mine", "author": "Ann", "latestVersion": 1, "runMode": "device", "requiredTier": 2, "description": "", "coverUrl": null, "tags": ["gps"], "releaseNotes": "first"}])
        );
    }
}
