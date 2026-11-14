// In-memory store used when DATABASE_URL is unset: same data model as the Postgres tables
// (accounts, games, game_versions), reached through db.rs. Data is lost on restart.
// std only: ids are uuid-shaped text (hex, version 4 layout) from std's OS-seeded RandomState,
// timestamps are RFC3339 UTC text like Postgres output. Not a CSPRNG; ids are not secrets.
// shortcut: linear scans over Vecs, fine for a local demo; use the Postgres path for real load.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::db::{catalog_tier, Account, CatalogRow, Game, GameVersion, NewGameVersion, Plugin, PluginSummary};

#[derive(Default)]
struct Inner {
    accounts: Vec<Account>,
    games: Vec<Game>,
    versions: Vec<GameVersion>,
    plugins: Vec<Plugin>,
}

/// Cheap to clone: clones share the same data.
#[derive(Clone, Default)]
pub struct MemStore(Arc<Mutex<Inner>>);

fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let half = |salt: u64| {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(n);
        h.write_u64(salt);
        h.finish()
    };
    let (a, b) = (half(0), half(1));
    // 8-4-4-4-12 with version nibble 4 and variant nibble 8..b, so it passes `valid_uuid` like a Postgres uuid.
    format!(
        "{:08x}-{:04x}-4{:03x}-{:x}{:03x}-{:012x}",
        a >> 32,
        (a >> 16) & 0xffff,
        a & 0xfff,
        8 + ((b >> 60) & 3),
        (b >> 48) & 0xfff,
        b & 0xffff_ffff_ffff
    )
}

/// Current UTC time as RFC3339 with microseconds, e.g. `2024-01-02T03:04:05.123456Z`.
fn now_rfc3339() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let (secs, micros) = (d.as_secs() as i64, d.subsec_micros());
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{micros:06}Z",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60
    )
}

impl MemStore {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Same rule as the SQL upsert: an existing account keeps its display name unless a non-empty one is given.
    pub fn upsert_account(&self, provider: &str, subject: &str, display_name: &str) -> Account {
        let mut s = self.lock();
        if let Some(a) = s
            .accounts
            .iter_mut()
            .find(|a| a.provider == provider && a.subject == subject)
        {
            if !display_name.is_empty() {
                a.display_name = display_name.to_string();
            }
            return a.clone();
        }
        let a = Account {
            id: new_id(),
            provider: provider.into(),
            subject: subject.into(),
            display_name: display_name.into(),
            created_at: now_rfc3339(),
        };
        s.accounts.push(a.clone());
        a
    }

    pub fn create_game(&self, owner_id: &str, title: &str) -> Game {
        let now = now_rfc3339();
        let g = Game {
            id: new_id(),
            owner_id: owner_id.into(),
            title: title.into(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.lock().games.push(g.clone());
        g
    }

    /// In creation order, like the SQL `ORDER BY created_at, id`.
    pub fn list_games_by_owner(&self, owner_id: &str) -> Vec<Game> {
        let s = self.lock();
        s.games.iter().filter(|g| g.owner_id == owner_id).cloned().collect()
    }

    pub fn game_owner(&self, game_id: &str) -> Option<String> {
        let s = self.lock();
        s.games.iter().find(|g| g.id == game_id).map(|g| g.owner_id.clone())
    }

    /// Next version (max + 1, starting at 1); None when the game does not exist.
    pub fn insert_game_version(&self, game_id: &str, v: &NewGameVersion) -> Option<GameVersion> {
        let mut s = self.lock();
        let now = now_rfc3339();
        s.games.iter_mut().find(|g| g.id == game_id)?.updated_at = now.clone();
        let next = s
            .versions
            .iter()
            .filter(|x| x.game_id == game_id)
            .map(|x| x.version)
            .max()
            .unwrap_or(0)
            + 1;
        let out = GameVersion {
            id: new_id(),
            game_id: game_id.into(),
            version: next,
            scene: v.scene.clone(),
            client_scripts: v.client_scripts.clone(),
            server_scripts: v.server_scripts.clone(),
            assets: v.assets.clone(),
            metadata: v.metadata.clone(),
            run_mode: v.run_mode.clone(),
            published_at: now,
        };
        s.versions.push(out.clone());
        Some(out)
    }

    /// Version `version` of a game, or the latest when None.
    pub fn fetch_game_version(&self, game_id: &str, version: Option<i32>) -> Option<GameVersion> {
        let s = self.lock();
        s.versions
            .iter()
            .filter(|x| x.game_id == game_id && version.is_none_or(|n| x.version == n))
            .max_by_key(|x| x.version)
            .cloned()
    }

    /// Same rule as the SQL upsert: an existing plugin keeps its installs count.
    pub fn upsert_plugin(&self, p: &Plugin) {
        let mut s = self.lock();
        match s.plugins.iter_mut().find(|x| x.id == p.id) {
            Some(x) => *x = Plugin { installs: x.installs, ..p.clone() },
            None => s.plugins.push(p.clone()),
        }
    }

    /// Ordered by id, like the SQL `ORDER BY id`.
    pub fn list_plugins(&self) -> Vec<PluginSummary> {
        let mut out: Vec<PluginSummary> = self
            .lock()
            .plugins
            .iter()
            .map(|p| PluginSummary {
                id: p.id.clone(),
                name: p.name.clone(),
                version: p.version.clone(),
                author: p.author.clone(),
                category: p.category.clone(),
                description: p.description.clone(),
                installs: p.installs,
            })
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    pub fn get_plugin_content(&self, id: &str) -> Option<(Value, Value)> {
        let s = self.lock();
        s.plugins.iter().find(|p| p.id == id).map(|p| (p.manifest.clone(), p.bundle.clone()))
    }

    pub fn add_plugin_install(&self, id: &str) -> Option<i64> {
        let mut s = self.lock();
        let p = s.plugins.iter_mut().find(|p| p.id == id)?;
        p.installs += 1;
        Some(p.installs)
    }

    /// Same result as the SQL in `db::list_catalog`: games with at least one version, newest-updated
    /// first (then id). An owner with no account row gets an empty author (Postgres has a foreign key).
    pub fn list_catalog(&self) -> Vec<CatalogRow> {
        let s = self.lock();
        let mut games: Vec<&Game> = s.games.iter().collect();
        games.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.id.cmp(&b.id)));
        games
            .into_iter()
            .filter_map(|g| {
                let latest = s.versions.iter().filter(|v| v.game_id == g.id).max_by_key(|v| v.version)?;
                Some(CatalogRow {
                    id: g.id.clone(),
                    title: g.title.clone(),
                    author: s
                        .accounts
                        .iter()
                        .find(|a| a.id == g.owner_id)
                        .map(|a| a.display_name.clone())
                        .unwrap_or_default(),
                    latest_version: latest.version,
                    run_mode: latest.run_mode.clone(),
                    required_tier: catalog_tier(&latest.scene["requiredTier"]),
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn nv(tag: &str) -> NewGameVersion {
        NewGameVersion {
            scene: json!({"tag": tag}),
            client_scripts: json!({}),
            server_scripts: json!({"game.js": "x"}),
            assets: json!({}),
            metadata: json!({}),
            run_mode: "screen".into(),
        }
    }

    #[test]
    fn upsert_account_is_idempotent_and_keeps_name_on_empty() {
        let m = MemStore::default();
        let a = m.upsert_account("dev", "s1", "Ann");
        let b = m.upsert_account("dev", "s1", "");
        assert_eq!(a.id, b.id);
        assert_eq!(b.display_name, "Ann");
        assert_eq!(m.upsert_account("dev", "s1", "Anna").display_name, "Anna");
        assert_ne!(m.upsert_account("dev", "s2", "").id, a.id);
        assert_ne!(m.upsert_account("other", "s1", "").id, a.id);
    }

    #[test]
    fn ids_and_timestamps_have_postgres_shape() {
        let id = new_id();
        assert!(crate::api::games::valid_uuid(&id), "{id}");
        assert_ne!(id, new_id());
        let t = now_rfc3339();
        assert_eq!(t.len(), 27, "{t}");
        assert!(t.starts_with("20") && t.ends_with('Z') && &t[10..11] == "T", "{t}");
    }

    #[test]
    fn versions_increment_per_game_and_latest_wins() {
        let m = MemStore::default();
        let g1 = m.create_game("o", "G1");
        let g2 = m.create_game("o", "G2");
        assert!(m.fetch_game_version(&g1.id, None).is_none());
        assert_eq!(m.insert_game_version(&g1.id, &nv("a")).unwrap().version, 1);
        assert_eq!(m.insert_game_version(&g1.id, &nv("b")).unwrap().version, 2);
        assert_eq!(m.insert_game_version(&g2.id, &nv("c")).unwrap().version, 1);
        assert_eq!(m.fetch_game_version(&g1.id, None).unwrap().scene, json!({"tag": "b"}));
        assert_eq!(m.fetch_game_version(&g1.id, Some(1)).unwrap().scene, json!({"tag": "a"}));
        assert!(m.fetch_game_version(&g1.id, Some(3)).is_none());
        assert!(m.insert_game_version("missing", &nv("x")).is_none());
        assert!(m.list_games_by_owner("o").iter().any(|g| g.id == g1.id && g.updated_at >= g1.created_at));
    }

    fn nvs(scene: serde_json::Value, run_mode: &str) -> NewGameVersion {
        NewGameVersion { scene, run_mode: run_mode.into(), ..nv("x") }
    }

    #[test]
    fn catalog_skips_unpublished_and_latest_version_wins() {
        let m = MemStore::default();
        let ann = m.upsert_account("dev", "s1", "Ann");
        let g = m.create_game(&ann.id, "Mine");
        m.create_game(&ann.id, "Draft");
        assert!(m.list_catalog().is_empty());
        m.insert_game_version(&g.id, &nvs(json!({"requiredTier": 1}), "screen")).unwrap();
        m.insert_game_version(&g.id, &nvs(json!({"requiredTier": 2}), "device")).unwrap();
        let rows = m.list_catalog();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0],
            CatalogRow {
                id: g.id.clone(),
                title: "Mine".into(),
                author: "Ann".into(),
                latest_version: 2,
                run_mode: "device".into(),
                required_tier: 2,
            }
        );
    }

    #[test]
    fn catalog_author_tier_default_and_clamp() {
        let m = MemStore::default();
        let g1 = m.create_game("no-account", "A");
        let g2 = m.create_game("no-account", "B");
        m.insert_game_version(&g1.id, &nvs(json!({}), "screen")).unwrap();
        m.insert_game_version(&g2.id, &nvs(json!({"requiredTier": 9}), "screen")).unwrap();
        let rows = m.list_catalog();
        let tier = |id: &str| rows.iter().find(|r| r.id == id).unwrap().required_tier;
        assert_eq!((tier(&g1.id), tier(&g2.id)), (1, 3));
        assert!(rows.iter().all(|r| r.author.is_empty()));
    }

    #[test]
    fn catalog_orders_by_last_publish() {
        let m = MemStore::default();
        let g1 = m.create_game("o", "G1");
        let g2 = m.create_game("o", "G2");
        let ids = |m: &MemStore| m.list_catalog().into_iter().map(|r| r.id).collect::<Vec<_>>();
        m.insert_game_version(&g1.id, &nv("a")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2)); // timestamps are microseconds; keep them distinct
        m.insert_game_version(&g2.id, &nv("b")).unwrap();
        assert_eq!(ids(&m), vec![g2.id.clone(), g1.id.clone()]);
        std::thread::sleep(std::time::Duration::from_millis(2));
        m.insert_game_version(&g1.id, &nv("c")).unwrap();
        assert_eq!(ids(&m), vec![g1.id.clone(), g2.id.clone()]);
    }

    #[test]
    fn owner_lookup_and_listing() {
        let m = MemStore::default();
        let g = m.create_game("alice", "Mine");
        m.create_game("bob", "Theirs");
        assert_eq!(m.game_owner(&g.id), Some("alice".into()));
        assert_eq!(m.game_owner("missing"), None);
        let mine = m.list_games_by_owner("alice");
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].id, g.id);
    }
}
