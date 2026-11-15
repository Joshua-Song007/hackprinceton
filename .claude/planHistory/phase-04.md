## Phase 4: Flagship Game

Goal: a game playable by a stranger in under 60 s using at least two input types, built only through the public runtime and script API. Name and design are unscheduled (`<Flagship>` placeholder). Also: creators sign in and publish from Studio to the Rust backend (4.1, 4.2).

- [x] `Games/Flagship/scene.json` — `SceneDescription` for the game world. (Sets `requiredTier`.) (`SceneDescription` has no mesh component, so no visuals in the scene file [provisional: needs-tien-review].) (Changed 2026-11-14: `requiredTier` 3 → 1; heart rate only scales aggression and the game plays without it, so phones show it playable. Published to Vultr as "Hollow Choir" by dev account "Omni", game `15d5eaa5-5ce8-4f87-a87a-08614e9ac91b` v1.)
- [x] `Games/Flagship/scripts/enemy.js` — enemy behavior: `onLookAt` audio lock-on, `onHeartRate` aggression scaling. (API names `self.name`, `self.speed`, `self.audio.play`, `ctx.haptic` and plain `ctx.state` assumed; server uses `fireAll` only; sound and haptic names invented; same for `player.js` and `game.js` [provisional: needs-tien-review].)
- [x] `Games/Flagship/scripts/player.js` — player abilities: `onGesture` actions, haptic feedback via `ctx`.
- [x] `Games/Flagship/scripts/game.js` — win/lose flow and difficulty tuning.
- [x] `Apps/OmniStudio/OmniStudio/Scripting/ScriptEditorView.swift` — script editor with hot reload through `ScriptReloader`. (Views built but not yet wired into the Studio window, as of #145; same for `InspectorView.swift`.)
- [x] `Apps/OmniStudio/OmniStudio/Inspector/InspectorView.swift` — entity inspector for components and script assignment.
- [x] `Apps/OmniStudio/OmniStudio/Game/GameLoader.swift` — reads a game (scene + client / server script sources) from a folder or a cloud `GameBundle`; `AppModel` loads Flagship from disk at launch and runs it, Game menu = Reload Flagship / Open folder / Open from cloud. (Added 2026-11-14, not in the original plan. One local player + local `ServerScriptEngine` inside `AppModel` through `ModeController`, so Sim / Live / Demo feed the game; `LocalTestSession` still unmounted. Every leaf entity drawn as a gray box (no mesh component in `SceneDescription`). Sim Watch adds Pinch / Flick toolbar buttons. Lookup: env `OMNI_GAME_DIR`, then `Games/Flagship` above cwd, app bundle or `#filePath`. Cloud URL env `OMNI_CLOUD_URL`, else localhost. Checked by a scratch harness (load, lookAt + trigger haptics, pinch adds output, no script errors), not committed; the window was never seen (no screen capture here); Open from cloud not exercised. FLAGGED: AirPods give no `position`, so head triggers never fire in Live; no confirmed live `gesture` source; `GameLoader.fromBundle` is what OmniPlayer needs to run games, move to a package then.)

Not file-bound: sound design, visuals and feedback polish (no gray boxes); playtest with someone who has never seen it.

### 4.1 Accounts & publishing — Studio side (overview.md Modules 7 and 11)
- [x] `Packages/OmniCloud/Package.swift` — OmniCloud manifest, no dependencies; only OmniStudio may depend on it. (Also add it to `Omni.xcworkspace` and link it from the OmniStudio project.)
- [x] `Packages/OmniCloud/Sources/OmniCloud/CloudClient.swift` — `URLSession` client for the backend: sign-in, publish a game version (scene, client and server scripts, assets, metadata incl. run mode), list and fetch the account's games. (Sign-in method not decided; Sign in with Apple preferred.)
- [x] `Packages/OmniCloud/Tests/OmniCloudTests/CloudClientTests.swift` — request encoding and response decoding against a stubbed `URLProtocol`; auth failure surfaces as an error, not a crash.
- [x] `Apps/OmniStudio/OmniStudio/Account/SignInView.swift` — sign-in and signed-in account state. (`AccountModel` lives in this file; token sign-in is provisional [provisional: needs-tien-review].)
- [x] `Apps/OmniStudio/OmniStudio/Publish/PublishView.swift` — packs the open game and publishes it through `CloudClient`; shows the published version or the error.

### 4.2 Backend — Rust (overview.md Module 11)
(Rust, so Windows laptops can build it; Rust crates are tracked in `Backend/Cargo.lock`, not `branchDep.md`, which tracks Swift packages only.)
- [x] `Backend/Cargo.toml` — crate manifest: axum, tokio, sqlx (Postgres), serde, and the JS engine (deno_core or rquickjs, not decided). (JS engine rquickjs 0.9 chosen provisionally, deno_core not picked; `serde_json` added as a JSON helper [provisional: needs-tien-review].)
- [x] `Backend/migrations/0001_init.sql` — `accounts`, `games` (owned by an account), `game_versions` (scene, scripts, assets, metadata). (Game files stored in Postgres on Vultr for now; object storage not decided.) (Account identity = provider + subject; game files as JSONB in Postgres; `run_mode` column duplicates `scene.runMode` [provisional: needs-tien-review].)
- [x] `Backend/src/main.rs` — starts the HTTP API and the WebSocket game server; reads the database URL from the environment. (Test uses raw TCP on loopback instead of tower oneshot; non-numeric PORT falls back to 8080; /api and /play not mounted yet [provisional: needs-tien-review].)
- [x] `Backend/src/db.rs` — Postgres connection pool and queries. (ids/timestamps as text and JSON via serde_json because sqlx has no uuid/json/derive/migrate features; revisit if Cargo.toml features are added [provisional: needs-tien-review].)
- [x] `Backend/src/api/accounts.rs` — sign-in and session tokens. (Sign-in method not decided.) (Dev sign-in gated by OMNI_DEV_SIGNIN=1 with in-memory opaque bearer tokens; sign-in method undecided; token source not a CSPRNG; revisit when sign-in is chosen.)
- [x] `Backend/src/api/games.rs` — publish a version, list games, fetch a version; only the owner may publish. (Fetch requires any signed-in account, not owner-only; public fetch for players undecided. Run mode limited to screen | device.)
- [x] `Backend/src/game_server/session.rs` — one WebSocket session per live game: players join and leave, remote events go into the script host and its `fire` / `fireAll` go out. Lobbies and matchmaking are game code.
- [x] `Backend/src/game_server/script_host.rs` — embedded JS engine running a game's server scripts with the same `serverScript` API as `ServerScriptEngine`. (rquickjs with `parallel`; `factory()` yields `NoopHost` until published server-script sources are reachable; prelude.js shared via `include_str!` from Packages/OmniScript, so Backend no longer builds standalone.)
- [x] `Backend/tests/api.rs` — publish → fetch round-trip; non-owner publish rejected.
- [x] `Backend/tests/script_host.rs` — same server-script fixture as `ServerScriptEngineTests.swift`, same results.

## Later changes

### 2026-11-14 — Delete a game
Paths: `Backend/src/api/games.rs`, `Backend/src/db.rs`, `Backend/src/memstore.rs`, `Backend/src/game_server/session.rs`

`DELETE /api/games/{id}` removes a game. Order: auth (401), valid uuid (400), database present (503), then the owner lookup: unknown game 404, another account's game 403; then the delete (a game removed by a concurrent request is 404) and 204. The versions go with the game (the `game_versions` foreign key already cascades; no other table references games). A live session of the game is closed: the players' senders drop so their sockets end, and the debug bus state is cleared as when the last player leaves. The published catalog is derived from games with versions, so a deleted game leaves it.

Known, not changed: `/play/{id}` never checks that the game exists, so a player who reconnects to a deleted game id starts a session without server scripts. The Postgres branch of `db::delete_game` is covered only by the `DATABASE_URL` round trip, which was not run (no database here); the memory store and the route are covered by tests.

Stale comments flagged, not edited: the header of `Backend/src/api/games.rs` (first line and the `Routes:` list lack `DELETE /api/games/{id}`).
- [x] `Backend/src/api/games.rs` — `DELETE /api/games/{id}` handler and route, route tests on the memory store.
- [x] `Backend/src/db.rs` — `delete_game`; Postgres round trip extended.
- [x] `Backend/src/memstore.rs` — `delete_game` removes the game and its versions.
- [x] `Backend/src/game_server/session.rs` — `Registry::close` and `close`.
