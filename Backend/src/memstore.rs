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

use crate::db::{catalog_tier, friend_code, normalize_code, FriendRef, Listing, RequestOutcome, Account, CatalogRow, Game, GameVersion, InstallRecord, NewGameVersion, PluginSummary, PluginVersion};

#[derive(Default)]
struct Inner {
    accounts: Vec<Account>,
    games: Vec<Game>,
    versions: Vec<GameVersion>,
    /// (plugin id, author account id; None = seed job).
    plugins: Vec<(String, Option<String>)>,
    /// In publish order (the SQL `seq`).
    plugin_versions: Vec<PluginVersion>,
    /// (plugin id, account id, version, installed).
    plugin_installs: Vec<(String, String, String, bool)>,
    /// (requester id, addressee id, accepted); one entry per unordered pair.
    friendships: Vec<(String, String, bool)>,
    /// account id -> (provider, sealed key).
    model_keys: std::collections::HashMap<String, (String, String)>,
    /// account id -> argon2id PHC hash (developer accounts only).
    password_hashes: std::collections::HashMap<String, String>,
    /// game id -> (content type, bytes) of the cover picture.
    covers: std::collections::HashMap<String, (String, Vec<u8>)>,
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
pub fn now_rfc3339() -> String {
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

/// Microseconds since the epoch of an RFC3339 timestamp from `now_rfc3339` (the SQL side is
/// `EXTRACT(EPOCH FROM updated_at) * 1000000`).
fn epoch_micros(ts: &str) -> i64 {
    let n = |r: std::ops::Range<usize>| ts.get(r).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0);
    let (y, m, d) = (n(0..4), n(5..7), n(8..10));
    // Days from civil date (Howard Hinnant's algorithm, inverse of the one in now_rfc3339).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    ((days * 86_400 + n(11..13) * 3_600 + n(14..16) * 60 + n(17..19)) * 1_000_000) + n(20..26)
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
            role: "player".into(),
            created_at: now_rfc3339(),
        };
        s.accounts.push(a.clone());
        a
    }

    /// Same rule as `db::upsert_developer`: creates or updates (provider "developer", username), role developer.
    pub fn upsert_developer(&self, username: &str, display_name: &str, password_hash: &str) -> Account {
        let mut s = self.lock();
        let a = match s.accounts.iter().position(|a| a.provider == "developer" && a.subject == username) {
            Some(i) => {
                s.accounts[i].display_name = display_name.into();
                s.accounts[i].role = "developer".into();
                s.accounts[i].clone()
            }
            None => {
                let a = Account {
                    id: new_id(),
                    provider: "developer".into(),
                    subject: username.into(),
                    display_name: display_name.into(),
                    role: "developer".into(),
                    created_at: now_rfc3339(),
                };
                s.accounts.push(a.clone());
                a
            }
        };
        s.password_hashes.insert(a.id.clone(), password_hash.into());
        a
    }

    pub fn developer_credentials(&self, username: &str) -> Option<(Account, String)> {
        let s = self.lock();
        let a = s.accounts.iter().find(|a| a.provider == "developer" && a.subject == username && a.role == "developer")?;
        Some((a.clone(), s.password_hashes.get(&a.id)?.clone()))
    }

    pub fn update_display_name(&self, id: &str, display_name: &str) -> Option<Account> {
        let mut s = self.lock();
        let a = s.accounts.iter_mut().find(|a| a.id == id)?;
        a.display_name = display_name.to_string();
        Some(a.clone())
    }

    pub fn create_game(&self, owner_id: &str, title: &str) -> Game {
        let now = now_rfc3339();
        let g = Game {
            id: new_id(),
            owner_id: owner_id.into(),
            owner_name: String::new(),
            title: title.into(),
            description: String::new(),
            has_cover: false,
            listed: false,
            tags: Vec::new(),
            release_notes: String::new(),
            created_at: now.clone(),
            updated_at: now,
        };
        let mut s = self.lock();
        s.games.push(g.clone());
        Self::decorate(&s, &g)
    }

    /// Fills the fields Postgres derives by join: the owner's current display name and whether a cover exists.
    fn decorate(s: &Inner, g: &Game) -> Game {
        let mut g = g.clone();
        g.owner_name = s.accounts.iter().find(|a| a.id == g.owner_id).map(|a| a.display_name.clone()).unwrap_or_default();
        g.has_cover = s.covers.contains_key(&g.id);
        g
    }

    /// In creation order, like the SQL `ORDER BY created_at, id`.
    pub fn list_games_by_owner(&self, owner_id: &str) -> Vec<Game> {
        let s = self.lock();
        s.games.iter().filter(|g| g.owner_id == owner_id).map(|g| Self::decorate(&s, g)).collect()
    }

    pub fn list_all_games(&self) -> Vec<Game> {
        let s = self.lock();
        s.games.iter().map(|g| Self::decorate(&s, g)).collect()
    }

    pub fn get_game(&self, game_id: &str) -> Option<Game> {
        let s = self.lock();
        s.games.iter().find(|g| g.id == game_id).map(|g| Self::decorate(&s, g))
    }

    pub fn update_game_meta(&self, game_id: &str, title: Option<&str>, description: Option<&str>) -> Option<Game> {
        let mut s = self.lock();
        let g = s.games.iter_mut().find(|g| g.id == game_id)?;
        if let Some(t) = title {
            g.title = t.into();
        }
        if let Some(d) = description {
            g.description = d.into();
        }
        g.updated_at = now_rfc3339();
        let g = g.clone();
        Some(Self::decorate(&s, &g))
    }

    pub fn set_listing(&self, game_id: &str, l: &Listing) -> Option<Game> {
        let mut s = self.lock();
        let g = s.games.iter_mut().find(|g| g.id == game_id)?;
        if let Some(v) = l.listed {
            g.listed = v;
        }
        if let Some(t) = &l.tags {
            g.tags = t.clone();
        }
        if let Some(n) = &l.release_notes {
            g.release_notes = n.clone();
        }
        if let Some(d) = &l.description {
            g.description = d.clone();
        }
        g.updated_at = now_rfc3339();
        let g = g.clone();
        Some(Self::decorate(&s, &g))
    }

    pub fn set_cover(&self, game_id: &str, cover: Option<(&str, &[u8])>) -> bool {
        let mut s = self.lock();
        let Some(g) = s.games.iter_mut().find(|g| g.id == game_id) else { return false };
        g.updated_at = now_rfc3339();
        match cover {
            Some((ty, bytes)) => s.covers.insert(game_id.into(), (ty.into(), bytes.to_vec())),
            None => s.covers.remove(game_id),
        };
        true
    }

    pub fn get_cover(&self, game_id: &str) -> Option<(String, Vec<u8>)> {
        self.lock().covers.get(game_id).cloned()
    }

    /// Removes the game and its versions; false when the game does not exist.
    pub fn delete_game(&self, game_id: &str) -> bool {
        let mut s = self.lock();
        let before = s.games.len();
        s.games.retain(|g| g.id != game_id);
        s.covers.remove(game_id);
        s.versions.retain(|v| v.game_id != game_id);
        s.games.len() != before
    }

    pub fn game_owner(&self, game_id: &str) -> Option<String> {
        let s = self.lock();
        s.games.iter().find(|g| g.id == game_id).map(|g| g.owner_id.clone())
    }

    fn friend_ref(s: &Inner, id: &str) -> FriendRef {
        let name = s.accounts.iter().find(|a| a.id == id).map(|a| a.display_name.clone()).unwrap_or_default();
        FriendRef { id: id.into(), name }
    }

    pub fn send_friend_request(&self, me: &str, code: &str) -> RequestOutcome {
        let Some(code) = normalize_code(code) else { return RequestOutcome::NoSuchCode };
        let mut s = self.lock();
        let Some(other) = s.accounts.iter().find(|a| friend_code(&a.id) == code).map(|a| a.id.clone()) else {
            return RequestOutcome::NoSuchCode;
        };
        if other == me {
            return RequestOutcome::OwnCode;
        }
        match s.friendships.iter_mut().find(|f| (f.0 == me && f.1 == other) || (f.0 == other && f.1 == me)) {
            None => {
                s.friendships.push((me.into(), other, false));
                RequestOutcome::Pending
            }
            Some(f) if f.2 => RequestOutcome::Accepted,
            Some(f) if f.0 == me => RequestOutcome::Pending,
            Some(f) => {
                f.2 = true;
                RequestOutcome::Accepted
            }
        }
    }

    pub fn accept_friend(&self, me: &str, requester: &str) -> bool {
        let mut s = self.lock();
        match s.friendships.iter_mut().find(|f| f.0 == requester && f.1 == me && !f.2) {
            Some(f) => {
                f.2 = true;
                true
            }
            None => false,
        }
    }

    pub fn remove_friend(&self, me: &str, other: &str) -> bool {
        let mut s = self.lock();
        let before = s.friendships.len();
        s.friendships.retain(|f| !((f.0 == me && f.1 == other) || (f.0 == other && f.1 == me)));
        s.friendships.len() < before
    }

    pub fn list_friends(&self, me: &str) -> Vec<FriendRef> {
        let s = self.lock();
        let mut out: Vec<FriendRef> = s
            .friendships
            .iter()
            .filter(|f| f.2 && (f.0 == me || f.1 == me))
            .map(|f| Self::friend_ref(&s, if f.0 == me { &f.1 } else { &f.0 }))
            .collect();
        out.sort_by(|a, b| (&a.name, &a.id).cmp(&(&b.name, &b.id)));
        out
    }

    pub fn list_friend_requests(&self, me: &str) -> (Vec<FriendRef>, Vec<FriendRef>) {
        let s = self.lock();
        let incoming = s.friendships.iter().filter(|f| !f.2 && f.1 == me).map(|f| Self::friend_ref(&s, &f.0)).collect();
        let outgoing = s.friendships.iter().filter(|f| !f.2 && f.0 == me).map(|f| Self::friend_ref(&s, &f.1)).collect();
        (incoming, outgoing)
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

    pub fn plugin_author(&self, id: &str) -> Option<Option<String>> {
        self.lock().plugins.iter().find(|p| p.0 == id).map(|p| p.1.clone())
    }

    pub fn latest_plugin_version(&self, id: &str, approved_only: bool) -> Option<PluginVersion> {
        let s = self.lock();
        s.plugin_versions.iter().rev().find(|v| v.plugin_id == id && (!approved_only || v.status == "approved")).cloned()
    }

    pub fn find_plugin_version(&self, id: &str, version: &str) -> Option<PluginVersion> {
        let s = self.lock();
        s.plugin_versions.iter().find(|v| v.plugin_id == id && v.version == version).cloned()
    }

    pub fn insert_plugin_version(&self, author_id: Option<&str>, v: &PluginVersion) {
        let mut s = self.lock();
        if !s.plugins.iter().any(|p| p.0 == v.plugin_id) {
            s.plugins.push((v.plugin_id.clone(), author_id.map(String::from)));
        }
        s.plugin_versions.push(v.clone());
    }

    pub fn set_plugin_version_status(&self, id: &str, version: &str, status: &str) -> bool {
        let mut s = self.lock();
        match s.plugin_versions.iter_mut().find(|v| v.plugin_id == id && v.version == version) {
            Some(v) => {
                v.status = status.into();
                true
            }
            None => false,
        }
    }

    fn installs_of_plugin(s: &Inner, id: &str) -> i64 {
        s.plugin_installs.iter().filter(|i| i.0 == id && i.3).count() as i64
    }

    /// Ordered by id, like the SQL `ORDER BY plugin_id`.
    pub fn list_plugins(&self) -> Vec<PluginSummary> {
        let s = self.lock();
        let mut ids: Vec<&String> = s.plugins.iter().map(|p| &p.0).collect();
        ids.sort();
        ids.into_iter()
            .filter_map(|id| {
                let v = s.plugin_versions.iter().rev().find(|v| &v.plugin_id == id && v.status == "approved")?;
                Some(PluginSummary::from_manifest(id, &v.version, &v.manifest, Self::installs_of_plugin(&s, id)))
            })
            .collect()
    }

    pub fn set_plugin_install(&self, id: &str, account_id: &str, version: Option<&str>) -> Option<i64> {
        let mut s = self.lock();
        if !s.plugins.iter().any(|p| p.0 == id) {
            return None;
        }
        match s.plugin_installs.iter_mut().find(|i| i.0 == id && i.1 == account_id) {
            Some(i) => {
                if let Some(v) = version {
                    i.2 = v.into();
                }
                i.3 = version.is_some();
            }
            None => s.plugin_installs.push((id.into(), account_id.into(), version.unwrap_or_default().into(), version.is_some())),
        }
        Some(Self::installs_of_plugin(&s, id))
    }

    pub fn plugin_installs_of(&self, account_id: &str) -> Vec<InstallRecord> {
        let s = self.lock();
        let mut out: Vec<InstallRecord> = s
            .plugin_installs
            .iter()
            .filter(|i| i.1 == account_id)
            .map(|i| InstallRecord { id: i.0.clone(), version: i.2.clone(), installed: i.3 })
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    pub fn set_model_key(&self, account_id: &str, provider: &str, ciphertext: &str) {
        self.lock().model_keys.insert(account_id.into(), (provider.into(), ciphertext.into()));
    }

    pub fn get_model_key(&self, account_id: &str) -> Option<(String, String)> {
        self.lock().model_keys.get(account_id).cloned()
    }

    pub fn delete_model_key(&self, account_id: &str) {
        self.lock().model_keys.remove(account_id);
    }

    /// Same result as the SQL in `db::list_catalog`: listed games with at least one version, newest-updated
    /// first (then id). An owner with no account row gets an empty author (Postgres has a foreign key).
    pub fn list_catalog(&self) -> Vec<CatalogRow> {
        let s = self.lock();
        let mut games: Vec<&Game> = s.games.iter().collect();
        games.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.id.cmp(&b.id)));
        games
            .into_iter()
            .filter_map(|g| {
                if !g.listed {
                    return None;
                }
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
                    description: g.description.clone(),
                    cover_version: s.covers.contains_key(&g.id).then(|| epoch_micros(&g.updated_at)),
                    tags: g.tags.clone(),
                    release_notes: g.release_notes.clone(),
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

    #[test]
    fn delete_game_removes_it_and_its_versions_only() {
        let m = MemStore::default();
        let g1 = m.create_game("o", "G1");
        let g2 = m.create_game("o", "G2");
        m.insert_game_version(&g1.id, &nv("a")).unwrap();
        m.insert_game_version(&g2.id, &nv("b")).unwrap();
        assert!(m.delete_game(&g1.id));
        assert!(m.game_owner(&g1.id).is_none());
        assert!(m.fetch_game_version(&g1.id, None).is_none());
        assert_eq!(m.fetch_game_version(&g2.id, None).unwrap().scene, json!({"tag": "b"}));
        assert_eq!(m.list_games_by_owner("o").len(), 1);
        assert!(!m.delete_game(&g1.id));
        assert!(!m.delete_game("missing"));
    }

    fn nvs(scene: serde_json::Value, run_mode: &str) -> NewGameVersion {
        NewGameVersion { scene, run_mode: run_mode.into(), ..nv("x") }
    }

    fn list(m: &MemStore, id: &str) {
        m.set_listing(id, &Listing { listed: Some(true), ..Default::default() }).unwrap();
    }

    #[test]
    fn catalog_shows_only_listed_games_and_new_games_default_to_unlisted() {
        let m = MemStore::default();
        let g = m.create_game("o", "G");
        assert!((g.listed, g.tags.is_empty(), g.release_notes.is_empty()) == (false, true, true));
        m.insert_game_version(&g.id, &nv("a")).unwrap();
        assert!(m.list_catalog().is_empty(), "published but unlisted");
        let l = Listing { listed: Some(true), tags: Some(vec!["gps".into()]), release_notes: Some("n".into()), description: Some("d".into()) };
        let got = m.set_listing(&g.id, &l).unwrap();
        assert_eq!((got.listed, got.description.as_str()), (true, "d"));
        let rows = m.list_catalog();
        assert_eq!((rows.len(), rows[0].tags.clone(), rows[0].release_notes.as_str()), (1, vec!["gps".to_string()], "n"));
        // None fields leave values alone; listed=false hides the game again.
        m.set_listing(&g.id, &Listing { listed: Some(false), ..Default::default() }).unwrap();
        assert_eq!(m.get_game(&g.id).unwrap().tags, vec!["gps".to_string()]);
        assert!(m.list_catalog().is_empty());
        assert!(m.set_listing("missing", &l).is_none());
    }

    #[test]
    fn catalog_skips_unpublished_and_latest_version_wins() {
        let m = MemStore::default();
        let ann = m.upsert_account("dev", "s1", "Ann");
        let g = m.create_game(&ann.id, "Mine");
        m.create_game(&ann.id, "Draft");
        list(&m, &g.id);
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
                description: String::new(),
                cover_version: None,
                tags: Vec::new(),
                release_notes: String::new(),
            }
        );
    }

    #[test]
    fn catalog_author_tier_default_and_clamp() {
        let m = MemStore::default();
        let g1 = m.create_game("no-account", "A");
        let g2 = m.create_game("no-account", "B");
        list(&m, &g1.id);
        list(&m, &g2.id);
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
        list(&m, &g1.id);
        list(&m, &g2.id);
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
    fn developer_cover_and_metadata_parity() {
        let m = MemStore::default();
        let d = m.upsert_developer("dev", "Dev", "hash1");
        assert_eq!(d.role, "developer");
        assert_eq!(m.upsert_developer("dev", "Dev 2", "hash2").id, d.id);
        assert_eq!(m.developer_credentials("dev").map(|c| (c.0.display_name, c.1)), Some(("Dev 2".into(), "hash2".into())));
        let p = m.upsert_account("dev", "dev", "Player"); // same subject, other provider: not a developer
        assert_eq!(p.role, "player");
        assert!(m.developer_credentials("nope").is_none());
        let g = m.create_game(&p.id, "G");
        list(&m, &g.id);
        assert_eq!((g.owner_name.as_str(), g.has_cover), ("Player", false));
        m.insert_game_version(&g.id, &nv("a")).unwrap();
        assert_eq!(m.list_catalog()[0].cover_version, None);
        assert!(m.set_cover(&g.id, Some(("image/png", &[1, 2]))));
        assert_eq!(m.get_cover(&g.id), Some(("image/png".into(), vec![1, 2])));
        let after = m.get_game(&g.id).unwrap();
        assert!(after.has_cover);
        assert_eq!(m.list_catalog()[0].cover_version, Some(epoch_micros(&after.updated_at)));
        let g2 = m.update_game_meta(&g.id, Some("T"), Some("D")).unwrap();
        assert_eq!((g2.title.as_str(), g2.description.as_str()), ("T", "D"));
        assert!(m.set_cover(&g.id, None) && m.get_cover(&g.id).is_none());
        assert!(!m.set_cover("missing", None));
        assert_eq!(m.list_all_games().len(), 1);
        assert_eq!(epoch_micros("2024-01-02T03:04:05.123456Z"), 1_704_164_645_123_456);
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
