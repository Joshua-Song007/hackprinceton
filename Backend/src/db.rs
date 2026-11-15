// Postgres (Vultr) pool and queries for accounts, games and game versions.
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

/// Where data lives: Postgres (Vultr) when DATABASE_URL is set, else the in-memory store.
#[derive(Clone)]
pub enum Db {
    Pg(PgPool),
    Mem(MemStore),
}

const MIGRATION_0001: &str = include_str!("../migrations/0001_init.sql");
const MIGRATION_0002: &str = include_str!("../migrations/0002_plugins.sql");
const MIGRATION_0003: &str = include_str!("../migrations/0003_marketplace_cloud.sql");
const MIGRATION_0004: &str = include_str!("../migrations/0004_friends.sql");

/// Lazy pool: no connection is made until a query runs.
pub fn connect_lazy(url: &str) -> DbResult<PgPool> {
    PgPoolOptions::new().connect_lazy(url)
}

/// Applies 0001_init.sql, 0002_plugins.sql and 0003_marketplace_cloud.sql, each once: a step is
/// skipped when its table (`accounts`, `plugins`, `plugin_versions`) already exists.
pub async fn migrate(pool: &PgPool) -> DbResult<()> {
    for (table, sql) in [("accounts", MIGRATION_0001), ("plugins", MIGRATION_0002), ("plugin_versions", MIGRATION_0003), ("friendships", MIGRATION_0004)] {
        let exists: bool = sqlx::query("SELECT to_regclass($1) IS NOT NULL")
            .bind(format!("public.{table}"))
            .fetch_one(pool)
            .await?
            .try_get(0)?;
        if !exists {
            sqlx::raw_sql(sql).execute(pool).await?;
        }
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

/// One published version of a marketplace plugin. The tarball lives in object storage under `object_key`;
/// `sha256` (hex) is its hash and `signature` the server's Ed25519 signature (crypto::signed_message).
#[derive(Debug, Clone, PartialEq)]
pub struct PluginVersion {
    pub plugin_id: String,
    pub version: String,
    pub manifest: Value,
    pub sha256: String,
    pub signature: String,
    pub object_key: String,
    pub size: i64,
    /// pending | approved | rejected; only approved versions are listed and served.
    pub status: String,
}

/// What GET /api/plugins lists: the latest approved version of each plugin (no manifest or bundle).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PluginSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub category: String,
    pub description: String,
    /// Accounts that have the plugin installed now.
    pub installs: i64,
}

impl PluginSummary {
    pub fn from_manifest(id: &str, version: &str, manifest: &Value, installs: i64) -> PluginSummary {
        let field = |k: &str| manifest[k].as_str().unwrap_or_default().to_string();
        PluginSummary {
            id: id.into(),
            name: field("name"),
            version: version.into(),
            author: field("author"),
            category: field("category"),
            description: field("description"),
            installs,
        }
    }
}

/// One account's install state for a plugin (GET /api/me/plugins).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct InstallRecord {
    pub id: String,
    pub version: String,
    pub installed: bool,
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

/// Sets the display name; None when the account does not exist.
pub async fn update_display_name(db: &Db, id: &str, display_name: &str) -> DbResult<Option<Account>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.update_display_name(id, display_name)),
    };
    let row = sqlx::query(
        "UPDATE accounts SET display_name = $2 WHERE id = $1::uuid \
         RETURNING id::text AS id, provider, subject, display_name, created_at::text AS created_at",
    )
    .bind(id)
    .bind(display_name)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(account_from_row).transpose()
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

/// Deletes the game; its versions go with it (ON DELETE CASCADE). False when the game does not exist.
pub async fn delete_game(db: &Db, game_id: &str) -> DbResult<bool> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.delete_game(game_id)),
    };
    let done = sqlx::query("DELETE FROM games WHERE id = $1::uuid")
        .bind(game_id)
        .execute(pool)
        .await?;
    Ok(done.rows_affected() > 0)
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

fn plugin_version_from_row(r: &sqlx::postgres::PgRow) -> DbResult<PluginVersion> {
    Ok(PluginVersion {
        plugin_id: r.try_get("plugin_id")?,
        version: r.try_get("version")?,
        manifest: json_col(r, "manifest")?,
        sha256: r.try_get("sha256")?,
        signature: r.try_get("signature")?,
        object_key: r.try_get("object_key")?,
        size: r.try_get("size")?,
        status: r.try_get("status")?,
    })
}

const PLUGIN_VERSION_COLS: &str =
    "plugin_id, version, manifest::text AS manifest, sha256, signature, object_key, size, status";

/// Whether the plugin exists, and its author account (None = published by the seed job).
pub async fn plugin_author(db: &Db, id: &str) -> DbResult<Option<Option<String>>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.plugin_author(id)),
    };
    let row = sqlx::query("SELECT author_id::text AS author_id FROM plugins WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    row.map(|r| r.try_get("author_id")).transpose()
}

/// The newest version of a plugin (publish order), any status unless `approved_only`.
pub async fn latest_plugin_version(db: &Db, id: &str, approved_only: bool) -> DbResult<Option<PluginVersion>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.latest_plugin_version(id, approved_only)),
    };
    let sql = format!(
        "SELECT {PLUGIN_VERSION_COLS} FROM plugin_versions WHERE plugin_id = $1 AND ($2 = false OR status = 'approved') \
         ORDER BY seq DESC LIMIT 1"
    );
    let row = sqlx::query(&sql).bind(id).bind(approved_only).fetch_optional(pool).await?;
    row.as_ref().map(plugin_version_from_row).transpose()
}

pub async fn find_plugin_version(db: &Db, id: &str, version: &str) -> DbResult<Option<PluginVersion>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.find_plugin_version(id, version)),
    };
    let sql = format!("SELECT {PLUGIN_VERSION_COLS} FROM plugin_versions WHERE plugin_id = $1 AND version = $2");
    let row = sqlx::query(&sql).bind(id).bind(version).fetch_optional(pool).await?;
    row.as_ref().map(plugin_version_from_row).transpose()
}

/// Stores a new version, creating the plugin row (owned by `author_id`) on its first version.
/// The caller has checked ownership and that the version is newer.
pub async fn insert_plugin_version(db: &Db, author_id: Option<&str>, v: &PluginVersion) -> DbResult<()> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.insert_plugin_version(author_id, v)),
    };
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO plugins (id, author_id) VALUES ($1, $2::uuid) ON CONFLICT (id) DO NOTHING")
        .bind(&v.plugin_id)
        .bind(author_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO plugin_versions (plugin_id, version, manifest, sha256, signature, object_key, size, status) \
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)",
    )
    .bind(&v.plugin_id)
    .bind(&v.version)
    .bind(v.manifest.to_string())
    .bind(&v.sha256)
    .bind(&v.signature)
    .bind(&v.object_key)
    .bind(v.size)
    .bind(&v.status)
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

/// Sets a version's review status; false when that version does not exist.
pub async fn set_plugin_version_status(db: &Db, id: &str, version: &str, status: &str) -> DbResult<bool> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.set_plugin_version_status(id, version, status)),
    };
    let r = sqlx::query("UPDATE plugin_versions SET status = $3 WHERE plugin_id = $1 AND version = $2")
        .bind(id)
        .bind(version)
        .bind(status)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() == 1)
}

/// Latest approved version of every plugin that has one, by id; installs = accounts with it installed now.
pub async fn list_plugins(db: &Db) -> DbResult<Vec<PluginSummary>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.list_plugins()),
    };
    let rows = sqlx::query(
        "SELECT DISTINCT ON (v.plugin_id) v.plugin_id, v.version, v.manifest::text AS manifest, \
         (SELECT count(*) FROM plugin_installs i WHERE i.plugin_id = v.plugin_id AND i.uninstalled_at IS NULL) AS installs \
         FROM plugin_versions v WHERE v.status = 'approved' ORDER BY v.plugin_id, v.seq DESC",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|r| {
            let id: String = r.try_get("plugin_id")?;
            let version: String = r.try_get("version")?;
            Ok(PluginSummary::from_manifest(&id, &version, &json_col(r, "manifest")?, r.try_get("installs")?))
        })
        .collect()
}

/// Records an install (`Some(version)`) or an uninstall (`None`) for one account and returns the
/// plugin's install count, or None for an unknown plugin. Installing twice counts once; an
/// uninstall keeps the row (marked) so other devices see it as uninstalled, not unknown.
pub async fn set_plugin_install(db: &Db, id: &str, account_id: &str, version: Option<&str>) -> DbResult<Option<i64>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.set_plugin_install(id, account_id, version)),
    };
    if plugin_author(db, id).await?.is_none() {
        return Ok(None);
    }
    sqlx::query(
        "INSERT INTO plugin_installs (plugin_id, account_id, version, uninstalled_at) \
         VALUES ($1, $2::uuid, COALESCE($3, ''), CASE WHEN $3::text IS NULL THEN now() END) \
         ON CONFLICT (plugin_id, account_id) DO UPDATE SET \
         version = COALESCE($3, plugin_installs.version), updated_at = now(), \
         uninstalled_at = CASE WHEN $3::text IS NULL THEN now() END",
    )
    .bind(id)
    .bind(account_id)
    .bind(version)
    .execute(pool)
    .await?;
    let n: i64 = sqlx::query("SELECT count(*) FROM plugin_installs WHERE plugin_id = $1 AND uninstalled_at IS NULL")
        .bind(id)
        .fetch_one(pool)
        .await?
        .try_get(0)?;
    Ok(Some(n))
}

/// Every plugin this account has installed or uninstalled, by id.
pub async fn plugin_installs_of(db: &Db, account_id: &str) -> DbResult<Vec<InstallRecord>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.plugin_installs_of(account_id)),
    };
    let rows = sqlx::query(
        "SELECT plugin_id, version, uninstalled_at IS NULL AS installed FROM plugin_installs \
         WHERE account_id = $1::uuid ORDER BY plugin_id",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|r| Ok(InstallRecord { id: r.try_get("plugin_id")?, version: r.try_get("version")?, installed: r.try_get("installed")? }))
        .collect()
}

/// Stores (replaces) an account's sealed model API key.
pub async fn set_model_key(db: &Db, account_id: &str, provider: &str, ciphertext: &str) -> DbResult<()> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.set_model_key(account_id, provider, ciphertext)),
    };
    sqlx::query(
        "INSERT INTO account_model_keys (account_id, provider, ciphertext) VALUES ($1::uuid, $2, $3) \
         ON CONFLICT (account_id) DO UPDATE SET provider = EXCLUDED.provider, ciphertext = EXCLUDED.ciphertext, updated_at = now()",
    )
    .bind(account_id)
    .bind(provider)
    .bind(ciphertext)
    .execute(pool)
    .await?;
    Ok(())
}

/// (provider, sealed key) for an account, if one is stored.
pub async fn get_model_key(db: &Db, account_id: &str) -> DbResult<Option<(String, String)>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.get_model_key(account_id)),
    };
    let row = sqlx::query("SELECT provider, ciphertext FROM account_model_keys WHERE account_id = $1::uuid")
        .bind(account_id)
        .fetch_optional(pool)
        .await?;
    row.map(|r| Ok((r.try_get("provider")?, r.try_get("ciphertext")?))).transpose()
}

pub async fn delete_model_key(db: &Db, account_id: &str) -> DbResult<()> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.delete_model_key(account_id)),
    };
    sqlx::query("DELETE FROM account_model_keys WHERE account_id = $1::uuid").bind(account_id).execute(pool).await?;
    Ok(())
}

/// A friend (or a requester / addressee) as the app lists them.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FriendRef {
    pub id: String,
    pub name: String,
}

/// What sending a request by friend code did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestOutcome {
    NoSuchCode,
    OwnCode,
    Pending,
    Accepted,
}

/// The code a friend types to find this account: the first 6 hex characters of its id, uppercase.
// ponytail: derived from the id so nothing is stored; a 6-char prefix can collide (first match wins), widen it or add a column if accounts reach the thousands.
pub fn friend_code(account_id: &str) -> String {
    account_id.chars().filter(|c| *c != '-').take(6).collect::<String>().to_uppercase()
}

/// Friend codes are 6 hex characters; anything else cannot match an account.
pub fn normalize_code(code: &str) -> Option<String> {
    let c = code.trim().to_uppercase();
    (c.len() == 6 && c.chars().all(|ch| ch.is_ascii_hexdigit())).then_some(c)
}

fn friend_from_row(r: &sqlx::postgres::PgRow) -> DbResult<FriendRef> {
    Ok(FriendRef { id: r.try_get("id")?, name: r.try_get("display_name")? })
}

/// Sends a request to the account with this friend code. If that account already asked `me`, the
/// two become friends; if already friends or already asked, nothing changes.
pub async fn send_friend_request(db: &Db, me: &str, code: &str) -> DbResult<RequestOutcome> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.send_friend_request(me, code)),
    };
    let Some(code) = normalize_code(code) else { return Ok(RequestOutcome::NoSuchCode) };
    let target = sqlx::query(
        "SELECT id::text AS id FROM accounts WHERE upper(left(replace(id::text, '-', ''), 6)) = $1 \
         ORDER BY created_at, id LIMIT 1",
    )
    .bind(&code)
    .fetch_optional(pool)
    .await?;
    let Some(target) = target else { return Ok(RequestOutcome::NoSuchCode) };
    let other: String = target.try_get("id")?;
    if other == me {
        return Ok(RequestOutcome::OwnCode);
    }
    let existing = sqlx::query(
        "SELECT requester_id::text AS requester, status FROM friendships \
         WHERE (requester_id = $1::uuid AND addressee_id = $2::uuid) OR (requester_id = $2::uuid AND addressee_id = $1::uuid)",
    )
    .bind(me)
    .bind(&other)
    .fetch_optional(pool)
    .await?;
    match existing {
        None => {
            sqlx::query("INSERT INTO friendships (requester_id, addressee_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING")
                .bind(me)
                .bind(&other)
                .execute(pool)
                .await?;
            Ok(RequestOutcome::Pending)
        }
        Some(r) => {
            let (requester, status): (String, String) = (r.try_get("requester")?, r.try_get("status")?);
            if status == "accepted" {
                Ok(RequestOutcome::Accepted)
            } else if requester == me {
                Ok(RequestOutcome::Pending)
            } else {
                sqlx::query("UPDATE friendships SET status = 'accepted' WHERE requester_id = $1::uuid AND addressee_id = $2::uuid")
                    .bind(&other)
                    .bind(me)
                    .execute(pool)
                    .await?;
                Ok(RequestOutcome::Accepted)
            }
        }
    }
}

/// Accepts the pending request `requester` sent to `me`; false when there is none.
pub async fn accept_friend(db: &Db, me: &str, requester: &str) -> DbResult<bool> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.accept_friend(me, requester)),
    };
    let done = sqlx::query(
        "UPDATE friendships SET status = 'accepted' \
         WHERE requester_id = $1::uuid AND addressee_id = $2::uuid AND status = 'pending'",
    )
    .bind(requester)
    .bind(me)
    .execute(pool)
    .await?;
    Ok(done.rows_affected() > 0)
}

/// Declines, cancels or removes: deletes the row between the two accounts, whoever asked. False when none.
pub async fn remove_friend(db: &Db, me: &str, other: &str) -> DbResult<bool> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.remove_friend(me, other)),
    };
    let done = sqlx::query(
        "DELETE FROM friendships WHERE (requester_id = $1::uuid AND addressee_id = $2::uuid) \
         OR (requester_id = $2::uuid AND addressee_id = $1::uuid)",
    )
    .bind(me)
    .bind(other)
    .execute(pool)
    .await?;
    Ok(done.rows_affected() > 0)
}

/// Accepted friends of `me`, by name.
pub async fn list_friends(db: &Db, me: &str) -> DbResult<Vec<FriendRef>> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.list_friends(me)),
    };
    let rows = sqlx::query(
        "SELECT a.id::text AS id, a.display_name FROM friendships f \
         JOIN accounts a ON a.id = CASE WHEN f.requester_id = $1::uuid THEN f.addressee_id ELSE f.requester_id END \
         WHERE f.status = 'accepted' AND (f.requester_id = $1::uuid OR f.addressee_id = $1::uuid) \
         ORDER BY a.display_name, a.id",
    )
    .bind(me)
    .fetch_all(pool)
    .await?;
    rows.iter().map(friend_from_row).collect()
}

/// Pending requests as (incoming to `me`, outgoing from `me`).
pub async fn list_friend_requests(db: &Db, me: &str) -> DbResult<(Vec<FriendRef>, Vec<FriendRef>)> {
    let pool = match db {
        Db::Pg(pool) => pool,
        Db::Mem(m) => return Ok(m.list_friend_requests(me)),
    };
    let incoming = sqlx::query(
        "SELECT a.id::text AS id, a.display_name FROM friendships f JOIN accounts a ON a.id = f.requester_id \
         WHERE f.addressee_id = $1::uuid AND f.status = 'pending' ORDER BY f.created_at, a.id",
    )
    .bind(me)
    .fetch_all(pool)
    .await?;
    let outgoing = sqlx::query(
        "SELECT a.id::text AS id, a.display_name FROM friendships f JOIN accounts a ON a.id = f.addressee_id \
         WHERE f.requester_id = $1::uuid AND f.status = 'pending' ORDER BY f.created_at, a.id",
    )
    .bind(me)
    .fetch_all(pool)
    .await?;
    Ok((
        incoming.iter().map(friend_from_row).collect::<DbResult<_>>()?,
        outgoing.iter().map(friend_from_row).collect::<DbResult<_>>()?,
    ))
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
        assert!(delete_game(&db, &unpublished.id).await.unwrap());
        assert!(delete_game(&db, &g.id).await.unwrap());
        assert!(fetch_game_version(&db, &g.id, None).await.unwrap().is_none());
        assert!(!delete_game(&db, &g.id).await.unwrap());
        sqlx::query("DELETE FROM accounts WHERE id = $1::uuid")
            .bind(&a.id)
            .execute(&pool)
            .await
            .unwrap();
    }
}
