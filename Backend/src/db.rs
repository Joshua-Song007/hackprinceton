// TigerData (Postgres) pool and queries for accounts, games and game versions.
// Runtime sqlx queries only (no query! macros). The sqlx features in Cargo.toml have no uuid, chrono
// or json support, so ids and timestamps cross the boundary as text (cast in SQL) and JSON columns
// are read as text and parsed with serde_json.
#![allow(dead_code)] // consumed by the api / game_server items that follow

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;

use crate::memstore::MemStore;

pub type DbResult<T> = Result<T, sqlx::Error>;

/// Where data lives: TigerData (Postgres) when DATABASE_URL is set, else the in-memory store.
#[derive(Clone)]
pub enum Db {
    Pg(PgPool),
    Mem(MemStore),
}

const MIGRATION_0001: &str = include_str!("../migrations/0001_init.sql");

/// Lazy pool: no connection is made until a query runs.
pub fn connect_lazy(url: &str) -> DbResult<PgPool> {
    PgPoolOptions::new().connect_lazy(url)
}

/// Applies 0001_init.sql once. Skips when the `accounts` table already exists.
pub async fn migrate(pool: &PgPool) -> DbResult<()> {
    let exists: bool = sqlx::query("SELECT to_regclass('public.accounts') IS NOT NULL")
        .fetch_one(pool)
        .await?
        .try_get(0)?;
    if !exists {
        sqlx::raw_sql(MIGRATION_0001).execute(pool).await?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Account {
    pub id: String,
    pub provider: String,
    pub subject: String,
    pub display_name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Game {
    pub id: String,
    pub owner_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GameVersion {
    pub id: String,
    pub game_id: String,
    pub version: i32,
    pub scene: Value,
    pub client_scripts: Value,
    pub server_scripts: Value,
    pub assets: Value,
    pub metadata: Value,
    pub run_mode: String,
    pub published_at: String,
}

/// Content of a version to publish (what `insert_game_version` stores).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NewGameVersion {
    pub scene: Value,
    pub client_scripts: Value,
    pub server_scripts: Value,
    pub assets: Value,
    pub metadata: Value,
    pub run_mode: String,
}

// The sqlx `derive` feature is not enabled, so rows are mapped by hand.
fn account_from_row(r: &sqlx::postgres::PgRow) -> DbResult<Account> {
    Ok(Account {
        id: r.try_get("id")?,
        provider: r.try_get("provider")?,
        subject: r.try_get("subject")?,
        display_name: r.try_get("display_name")?,
        created_at: r.try_get("created_at")?,
    })
}

fn game_from_row(r: &sqlx::postgres::PgRow) -> DbResult<Game> {
    Ok(Game {
        id: r.try_get("id")?,
        owner_id: r.try_get("owner_id")?,
        title: r.try_get("title")?,
        created_at: r.try_get("created_at")?,
        updated_at: r.try_get("updated_at")?,
    })
}

const VERSION_COLS: &str = "id::text AS id, game_id::text AS game_id, version, scene::text AS scene, \
    client_scripts::text AS client_scripts, server_scripts::text AS server_scripts, \
    assets::text AS assets, metadata::text AS metadata, run_mode, published_at::text AS published_at";

fn json_col(row: &sqlx::postgres::PgRow, name: &str) -> DbResult<Value> {
    let text: String = row.try_get(name)?;
    serde_json::from_str(&text).map_err(|e| sqlx::Error::Decode(Box::new(e)))
}

fn version_from_row(row: &sqlx::postgres::PgRow) -> DbResult<GameVersion> {
    Ok(GameVersion {
        id: row.try_get("id")?,
        game_id: row.try_get("game_id")?,
        version: row.try_get("version")?,
        scene: json_col(row, "scene")?,
        client_scripts: json_col(row, "client_scripts")?,
        server_scripts: json_col(row, "server_scripts")?,
        assets: json_col(row, "assets")?,
        metadata: json_col(row, "metadata")?,
        run_mode: row.try_get("run_mode")?,
        published_at: row.try_get("published_at")?,
    })
}

/// Finds or creates the account for (provider, subject); an existing row keeps its display name
/// unless a non-empty one is given.
pub async fn upsert_account(
    db: &Db,
    provider: &str,
    subject: &str,
    display_name: &str,
) -> DbResult<Account> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.upsert_account(provider, subject, display_name)),
    };
    let row = sqlx::query(
        "INSERT INTO accounts (provider, subject, display_name) VALUES ($1, $2, $3) \
         ON CONFLICT (provider, subject) DO UPDATE SET \
         display_name = CASE WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name \
         ELSE accounts.display_name END \
         RETURNING id::text AS id, provider, subject, display_name, created_at::text AS created_at",
    )
    .bind(provider)
    .bind(subject)
    .bind(display_name)
    .fetch_one(pool)
    .await?;
    account_from_row(&row)
}

pub async fn create_game(db: &Db, owner_id: &str, title: &str) -> DbResult<Game> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.create_game(owner_id, title)),
    };
    let row = sqlx::query(
        "INSERT INTO games (owner_id, title) VALUES ($1::uuid, $2) \
         RETURNING id::text AS id, owner_id::text AS owner_id, title, \
         created_at::text AS created_at, updated_at::text AS updated_at",
    )
    .bind(owner_id)
    .bind(title)
    .fetch_one(pool)
    .await?;
    game_from_row(&row)
}

pub async fn list_games_by_owner(db: &Db, owner_id: &str) -> DbResult<Vec<Game>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.list_games_by_owner(owner_id)),
    };
    let rows = sqlx::query(
        "SELECT id::text AS id, owner_id::text AS owner_id, title, \
         created_at::text AS created_at, updated_at::text AS updated_at \
         FROM games WHERE owner_id = $1::uuid ORDER BY created_at, id",
    )
    .bind(owner_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(game_from_row).collect()
}

/// Owner account id of a game, or None when the game does not exist.
pub async fn game_owner(db: &Db, game_id: &str) -> DbResult<Option<String>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.game_owner(game_id)),
    };
    let row = sqlx::query("SELECT owner_id::text AS owner_id FROM games WHERE id = $1::uuid")
        .bind(game_id)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(r) => Ok(Some(r.try_get("owner_id")?)),
        None => Ok(None),
    }
}

/// Inserts the next version (max + 1, starting at 1) and bumps the game's `updated_at`.
/// Runs in one transaction with the game row locked, so concurrent publishes get distinct numbers.
pub async fn insert_game_version(
    db: &Db,
    game_id: &str,
    v: &NewGameVersion,
) -> DbResult<GameVersion> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return m.insert_game_version(game_id, v).ok_or(sqlx::Error::RowNotFound),
    };
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT id FROM games WHERE id = $1::uuid FOR UPDATE")
        .bind(game_id)
        .fetch_one(&mut *tx)
        .await?;
    let sql = format!(
        "INSERT INTO game_versions (game_id, version, scene, client_scripts, server_scripts, assets, metadata, run_mode) \
         VALUES ($1::uuid, (SELECT COALESCE(MAX(version), 0) + 1 FROM game_versions WHERE game_id = $1::uuid), \
         $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7) RETURNING {VERSION_COLS}"
    );
    let row = sqlx::query(&sql)
        .bind(game_id)
        .bind(v.scene.to_string())
        .bind(v.client_scripts.to_string())
        .bind(v.server_scripts.to_string())
        .bind(v.assets.to_string())
        .bind(v.metadata.to_string())
        .bind(&v.run_mode)
        .fetch_one(&mut *tx)
        .await?;
    let out = version_from_row(&row)?;
    sqlx::query("UPDATE games SET updated_at = now() WHERE id = $1::uuid")
        .bind(game_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(out)
}

/// Fetches version `version` of a game, or the latest when `version` is None.
pub async fn fetch_game_version(
    db: &Db,
    game_id: &str,
    version: Option<i32>,
) -> DbResult<Option<GameVersion>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.fetch_game_version(game_id, version)),
    };
    let sql = format!(
        "SELECT {VERSION_COLS} FROM game_versions WHERE game_id = $1::uuid \
         AND ($2::int IS NULL OR version = $2) ORDER BY version DESC LIMIT 1"
    );
    let row = sqlx::query(&sql)
        .bind(game_id)
        .bind(version)
        .fetch_optional(pool)
        .await?;
    row.as_ref().map(version_from_row).transpose()
}

/// One row of the public library: a game with its newest version's run mode and required tier.
#[derive(Debug, Clone, PartialEq)]
pub struct CatalogRow {
    pub id: String,
    pub title: String,
    pub author: String,
    pub latest_version: i32,
    pub run_mode: String,
    pub required_tier: i32,
}

/// Tier a scene asks for: its `requiredTier` when that is a JSON integer, clamped to 1..=3;
/// missing, null or any other type means 1 (SceneDescription's default). Shared by both stores.
pub fn catalog_tier(v: &Value) -> i32 {
    v.as_i64().map_or(1, |n| n.clamp(1, 3) as i32)
}

/// Every game that has at least one published version, newest-updated first. The tier comes from the
/// newest version's scene; the scene itself is not returned.
pub async fn list_catalog(db: &Db) -> DbResult<Vec<CatalogRow>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.list_catalog()),
    };
    let rows = sqlx::query(
        "SELECT g.id::text AS id, g.title, a.display_name AS author, v.version AS latest_version, \
         v.run_mode, (v.scene->'requiredTier')::text AS required_tier \
         FROM games g JOIN accounts a ON a.id = g.owner_id \
         JOIN LATERAL (SELECT version, run_mode, scene FROM game_versions \
         WHERE game_id = g.id ORDER BY version DESC LIMIT 1) v ON true \
         ORDER BY g.updated_at DESC, g.id",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|r| -> DbResult<CatalogRow> {
            // A scene whose tier does not parse counts as tier 1; it must not fail the whole catalog.
            let tier: Option<String> = r.try_get("required_tier")?;
            let tier = tier
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .unwrap_or(Value::Null);
            Ok(CatalogRow {
                id: r.try_get("id")?,
                title: r.try_get("title")?,
                author: r.try_get("author")?,
                latest_version: r.try_get("latest_version")?,
                run_mode: r.try_get("run_mode")?,
                required_tier: catalog_tier(&tier),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn connect_lazy_makes_no_connection() {
        // connect_lazy needs a runtime for its background tasks.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            assert!(connect_lazy("postgres://u:p@127.0.0.1:1/none").is_ok());
            assert!(connect_lazy("not a url").is_err());
        });
    }

    #[test]
    fn game_version_serde_round_trip() {
        let v = GameVersion {
            id: "i".into(),
            game_id: "g".into(),
            version: 2,
            scene: json!({"entities": []}),
            client_scripts: json!({"enemy": "x"}),
            server_scripts: json!({}),
            assets: json!({}),
            metadata: json!({"title": "t"}),
            run_mode: "screen".into(),
            published_at: "now".into(),
        };
        let back: GameVersion = serde_json::from_str(&serde_json::to_string(&v).unwrap()).unwrap();
        assert_eq!(v, back);
    }

    #[test]
    fn catalog_tier_rules() {
        for (v, want) in [
            (json!(1), 1),
            (json!(2), 2),
            (json!(3), 3),
            (json!(0), 1),
            (json!(-2), 1),
            (json!(7), 3),
            (json!(2.5), 1),
            (json!("2"), 1),
            (json!(null), 1),
        ] {
            assert_eq!(catalog_tier(&v), want, "{v}");
        }
    }

    // Runs only with DATABASE_URL set; the schema is created by `migrate` on a fresh database.
    #[tokio::test]
    async fn db_round_trip() {
        let Ok(url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let pool = connect_lazy(&url).unwrap();
        migrate(&pool).await.unwrap();
        let db = Db::Pg(pool.clone());
        let subject = format!("test-{}", std::process::id());
        let a = upsert_account(&db, "test", &subject, "A").await.unwrap();
        let a2 = upsert_account(&db, "test", &subject, "").await.unwrap();
        assert_eq!(a.id, a2.id);
        assert_eq!(a2.display_name, "A");
        let g = create_game(&db, &a.id, "Game").await.unwrap();
        assert_eq!(game_owner(&db, &g.id).await.unwrap(), Some(a.id.clone()));
        assert!(list_games_by_owner(&db, &a.id)
            .await
            .unwrap()
            .iter()
            .any(|x| x.id == g.id));
        let nv = NewGameVersion {
            scene: json!({"entities": []}),
            client_scripts: json!({"enemy": "s"}),
            server_scripts: json!({}),
            assets: json!({}),
            metadata: json!({"title": "Game"}),
            run_mode: "device".into(),
        };
        let v1 = insert_game_version(&db, &g.id, &nv).await.unwrap();
        let v2 = insert_game_version(&db, &g.id, &nv).await.unwrap();
        assert_eq!((v1.version, v2.version), (1, 2));
        assert_eq!(v1.scene, nv.scene);
        assert_eq!(v1.run_mode, "device");
        let latest = fetch_game_version(&db, &g.id, None).await.unwrap().unwrap();
        assert_eq!(latest.version, 2);
        let first = fetch_game_version(&db, &g.id, Some(1)).await.unwrap().unwrap();
        assert_eq!(first.id, v1.id);
        assert!(fetch_game_version(&db, &g.id, Some(9)).await.unwrap().is_none());
        let unpublished = create_game(&db, &a.id, "Draft").await.unwrap();
        let catalog = list_catalog(&db).await.unwrap();
        let row = catalog.iter().find(|r| r.id == g.id).expect("published game is listed");
        assert_eq!(
            (row.latest_version, row.run_mode.as_str(), row.author.as_str(), row.required_tier),
            (2, "device", "A", 1)
        );
        assert!(catalog.iter().all(|r| r.id != unpublished.id));
        sqlx::query("DELETE FROM accounts WHERE id = $1::uuid")
            .bind(&a.id)
            .execute(&pool)
            .await
            .unwrap();
    }
}
