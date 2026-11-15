# Build Plan

Product name is Pear; code keeps the Pear prefix. Phases 1-5, 8-10, 12 and Cross-Cutting are compressed; finished checklist items are removed (full text in planHistory/, read via grep). Only Phase 6 (stretch), 7, 11 and 13 are open here. Phase 13 opens with the critical state report (2026-11-15).

- Checklist, worked top-to-bottom. Each item is exactly one file with a single responsibility — `stage`/`apply` should be able to touch one checklist item without needing to also change any other file. Phases are ordered by dependency (later phases consume earlier ones).
- Paths are relative to the repo root. Packages use SwiftPM layout: `Packages/<Pkg>/Package.swift`, `Sources/<Pkg>/`, `Tests/<Pkg>Tests/`. Dependency rules come from the package table in `overview.md`; any item that bends them carries a parenthetical note.
- Format: `- [ ] \`path\` — responsibility`.

---

## Phase 1: Workspace Scaffold & Core Runtime (compressed)

Built: every package exists with its dependency boundary enforced in each `Package.swift`; USIS v1 schema and Codable types; `InputSource` / `InputBus` / `OutputSink`; `PearInput` pipeline (validation, clock sync, jitter buffer, calibration, capability tiers, stats); RealityKit `SceneRunner` with triggers and the Phase 1 exit test (hard-coded packet fires a trigger); Studio shell with viewport.

Still open: FLAGGED, not decided: `pencil` channel units (iPad gives a 2D normalized tip and normalized hover, no tilt field; `roll` / `hover` required in the schema but absent on some Pencils). Unscheduled: playback path for `AudioEmitterComponent` / `self.audio.play`. Provisional (needs-tien-review): hand-written `PearStudio.xcodeproj` (regenerate in Xcode before adding targets); `AppModel` placeholder `RecordingOutputSink`; overview.md update for `triggerEntered` / `triggerExited` events pending on user request.

Full text: planHistory/phase-01.md

---

## Phase 2: 3D Device Simulator (compressed)

Built: derived events (look-at, gesture, heart-rate intensity, raycast hit), audio listener, `SceneDescription` / `SceneLoader`; PearSim virtual devices, noise model, recorder / player, presets, sensor rig, gizmos, gaze, `SimOutputSink`; PearScript (`prelude.js`, `SelfBridge`, `ContextBridge`, `ScriptEngine`, `ScriptReloader`, `RemoteChannel`, `ServerScriptEngine`); Studio simulator panel, `LocalTestSession`, debug overlay and capability warning.

Still open: unscheduled: mounting `SimulatorPanelView` in the window; tests for `LocalTestSession`. Provisional (needs-tien-review): presets are hand-authored (pencil preset ~62 Hz, not 240 Hz), `ScriptReloader` / `RemoteChannel` / `ContextBridge` / `SelfBridge` API shapes, `UsisPlayer` leaves validation to `InputPipeline`, `SimOutputSink` queue cap, rig slot positions. Pencil unit decision still open (see Phase 1).

Full text: planHistory/phase-02.md

---

## Phase 3: Live Hardware Bridge (compressed)

Built: wire protocol in PearCore; PearBridge (Bonjour listener, device sessions, bridge source/sink, AirPods source); iOS + watchOS PearCompanion apps; Studio ModeController Sim / Live toggle, device status, calibration.

Still open: FLAGGED, not decided: stale-sample discard / UDP for motion over Wi-Fi; AirPods give no `position`. Provisional (needs-tien-review): clock-sample mapping, per-kind descriptor defaults, watch gesture thresholds.

Full text: planHistory/phase-03.md

---

## Phase 4: Flagship Game (compressed)

Built: Games/Flagship (scene + 3 scripts, published as "Hollow Choir"); Studio script editor, inspector, GameLoader; PearCloud client; Rust backend (axum, sqlx, rquickjs game server, in-memory dev sign-in) with tests.

Still open: sound design / visuals polish and a stranger playtest (not file-bound); editor and inspector views not mounted in the window; sign-in method decided in Phase 9 (Sign in with Apple). Provisional (needs-tien-review): API names in flagship scripts, JS engine rquickjs, JSONB file storage.

Full text: planHistory/phase-04.md

---

## Phase 5: Demo Hardening (compressed)

Built: simulated fallback recording and one-switch DemoMode replay.

Still open: local hotspot, pre-paired devices, recorded fallback video, five clean demo runs (not file-bound). Recording is hand-written, replace with a real capture.

Full text: planHistory/phase-05.md

---

## Phase 8: Pear Web Studio & Live Hosting (compressed)

Built: backend live integration (CORS, static Studio, /debug, memstore, migrations); Web SDK packages (pear-core / runtime / script / sim / cloud); Web Studio app (dockview layout, editor, explorer, inspector, run, debug panel, account); Tauri 2 desktop shell + release workflow; Vultr deploy files; blank template and demo script. (Changed 2026-11-15: the Test panel gained a status header with Play and Playtest, a readable readiness summary and plain device captions; see planHistory/phase-08.md.)

Still open: demo run on the Vultr box from the desktop executable; two people in one server session; brand-kit UI review; Vite watch ignore for src-tauri; macOS desktop untested. Web Studio is now acknowledged in overview.md (no longer a mismatch).

Full text: planHistory/phase-08.md

---

## Phase 9: Player App (compressed)

Built: backend catalog + Sign in with Apple; PearCloud catalog / Apple client; PearLibrary (device profile, playability, session store, library model, stub launcher); PearPlayer iOS + macOS app with sign-in, library, detail and theme.

Still open: Apple Developer team, bundle id, entitlement. (Changed 2026-11-15: running games on the player was built in commit 1f083b8: GameSession/PlayView, touch input, NetworkRemoteChannel; iOS 18 targets for PearInput / PearRuntime / PearScript / PearOutput / PearSim; not verified end to end.) Player UI never seen rendered. Player apps are now in overview.md scope.

Full text: planHistory/phase-09.md

---

## Phase 10: Marketplace / plugins cloud follow-ups (compressed)

Built: 10.1 to 10.7 (hosted registry, S3 bundles with signatures, authenticated publish, install telemetry, per-account sync, hosted agent runtime, per-account model keys) and the 10.9 fixes.

Still open: Vultr redeploy and bucket (human); live model run for OpenAI and Google (Anthropic passed); Google default model id unverified. Plugin system is now in overview.md.

- [ ] Live model run

Full text: planHistory/phase-10.md

---

## Phase 6: Collaborative Coding Space (stretch)

(Changed 2026-11-14: stretch goal, deferred until Phase 8 is done; come back to it after. Phase 8 below is the active work.)

- [ ] `Packages/PearCollab/Sources/PearCollab/ProjectDocument.swift` — CRDT document holding scene graph and every script's source (Automerge for Swift; track version in `branchDep.md` when added). (Also deletes `Module.swift`.)
- [ ] `Packages/PearCollab/Sources/PearCollab/PeerSync.swift` — Bonjour peer discovery and change exchange.
- [ ] `Packages/PearCollab/Sources/PearCollab/Presence.swift` — collaborator cursors, selections, "who's editing" state. Syncs the project only; never touches input.
- [ ] `Apps/PearStudio/PearStudio/Collab/PresenceOverlayView.swift` — cursors in the script editor, selection highlights in the viewport, entity badges.

---

## Phase 11: Web Studio projects screen follow-ups

Not built from the Projects screen v2 work (see planHistory/phase-08.md, Later changes): sharing and publish state in the game list, Pear styling outside the gallery, small gallery polish. Order is free; the backend items go together. (Changed 2026-11-14: accent, selection and ok colors and the gallery palette are done, so the sheet and menu colors in the `theme.css` item are covered; the `studio-tokens.css` item stays open for the rest of the Pear restyle; see planHistory/phase-08.md.)

- [ ] `Backend/src/db.rs` — `Game` (or the list query) carries owner name, share list and `published` / latest version for `GET /games`; Published stat and real Shared data need it.
- [ ] `Backend/src/memstore.rs` — same fields in the in-memory store, so the dev server matches Postgres.
- [ ] `Backend/src/api/games.rs` — return the new fields from the games list and accept sharing a game with another account.
- [ ] `Web/packages/pear-cloud/src/client.ts` — `Game` gains the new fields; client method for sharing.
- [ ] `Web/studio/src/projectsScreen.ts` — Published stat, a "New project" tile in the grid, Shared section fed by real data.
- [ ] `Web/studio/src/recent.ts` — relative dates in `formatWhen` ("Today, 8:16 PM", "Yesterday").
- [ ] `Web/studio/src/theme.css` — style `dialog.sheet` and menus outside `.scr` in the dark Pear tone while open over the gallery.
- [ ] `Web/studio/src/studio-tokens.css` — move the editor tokens and the light theme (Paper) to the Pear palette; keep the darker tone chosen for the gallery.
- [ ] `Web/studio/index.html` — bundle or link Fraunces and Geist (none are in the repo) and use Fraunces for the 28 px "Projects" heading.

---

## Phase 12: Instructions and agent players (compressed)

Built: 12.1 to 12.5 (instructions data and lint, Deep Agents plugin instructions mode and agent players, observation and pausable clock, playtest report, Instructions panel). Local Play only; instructions win over `scene.json`; cloud saves keep them in `metadata.instructions`. (Changed 2026-11-15: added the lose condition, the New game form, one player limit and an undriven start (12.6, see planHistory/phase-08.md), and an empty Blank template with a Playtest panel for agents (12.7), and New game form layout fixes; see planHistory/phase-12.md.)

Still open: nothing scheduled. Not planned: server or join agent runners; a how-to-play screen in the Player app; published games carrying instructions beyond `metadata` (Phase 11 backend items).

Full text: planHistory/phase-12.md

---

## Critical State Report (2026-11-15)

Written after Quick Draw reached the player app. Evidence: code inspection plus `docs/agents/devkit-wishlist.md`; nothing here was run, and the Quick Draw raise path is unverified on real phones. Not in overview.md (stays unchanged until the user asks).

### What is wrong

The developer environment writes games blind and the pieces that run them have drifted apart. Quick Draw shipped through hand-written code in every layer; the generic path (scene + scripts) did not carry it.

### Where the states are unsynced

1. **Game semantics live in four runtimes with no shared test.** Studio local run (`Web/packages/pear-runtime`, `Web/packages/pear-script/src/server-local.ts`), backend server scripts (`Backend/src/game_server/script_host.rs`, rquickjs, provisional per `Cargo.toml`), the player's client engine (`Packages/PearScript`), and per-game native code (`Apps/PearPlayer/PearPlayer/Play/QuickDraw/*`, 1.3k lines). `ctx.spawn` is documented as "Not simulated in local runs".
2. **Raise thresholds are in five places.** `Games/QuickDraw/scene.json` (60/15), `QDRaiseDetector` in `QuickDrawProtocol.swift` (hard-coded 60/45), `Web/packages/pear-runtime/src/scene.ts` (default 80/10), `SKILL.md` and `docs/creators/scripting-api.md` (default 80/10). The last commit changed two of them by hand.
3. **The player runs the game's rules a second time.** `PlayerModel.isPhoneOnly` decides from the scene alone that any phone-only device game is a Quick Draw (`QuickDrawSession` speaks Quick Draw's wire protocol). A second phone-only game would launch into Quick Draw's screen. The published scripts and what the phone runs are two different things.
4. **Phone UI is outside the package.** `Web/studio/public/qd-phone.html` and `qd-client.js` are hand-placed in Studio; the native screen is hand-written Swift. Neither is in the published version, and the agent plugin cannot write either (`translate.py` forwards only `/scripts/**`, `/scene.json`, `/instructions.json`).
5. **Cues are synthesized twice.** AVAudioEngine buffers in `QuickDrawSounds.swift`, Web Audio in `qd-client.js`. Scripts can only play the built-in beep.
6. **The agent's knowledge is a copy.** `skills/pear-scripting/SKILL.md` (72 lines) duplicates `docs/creators/scripting-api.md` (292 lines) by hand. Script API gaps hit by Quick Draw (no per-player timer, no lobby code in `ctx`, `ctx.cancel` on a fired handle undocumented, no connection quality) are in neither.
7. **Studio, backend and player disagree on what a lobby is.** Lobbies exist only in the backend session map (`(game, lobby)`, in memory). Studio cannot list, join or kick; scripts cannot read the code; friends' `playing.lobby` is the only reader besides the player.
8. **Publish has no proof.** `publishView.ts` verifies the server's copy, not that the game works. The version carries no test result, capability list or controller description, so the launch page cannot show readiness, instructions or cover.
9. **Real hardware is unreachable from the loop.** The simulator has no motion, so the raise path has no automated test on the player; `PearPlayer` has no unit-test target.
10. **Process docs lag the code.** `plan.md` had no Quick Draw entry; `Deploy` still names the database `omni` in places the wishlist flags against newer `pear` compose config; the 2026-11-14 autonomous run spent 75 PRs and 366 comments on coordination (`docs/agents/autonomy-findings.md`) while the authoring loop gained no tools.
11. **Updating a game still means touching the Vultr box (user report 2026-11-15).** The code already hot-reloads live sessions on publish (`session::reload` in `games.rs`), so the refresh is probably for things outside the version: backend code, migrations, and hand-placed static pages like `qd-phone.html` (unverified). Publishing also does not list the game anywhere a player browses beyond the raw catalog, and the demo catalog was filled with placeholder games (`Deploy/seed-library.sh`, now deleted) that list and open but have no game logic.

### Why the LangChain environment is weak

- No validate, simulate or test tool; the Studio rejects a bad scene only after the write.
- Scope stops at scripts and scene: no controller UI, cues, assets or tests.
- No file revisions (stale parallel writes overwrite), and declared plugin scopes are not enforced (`server.py` grants `/**`).
- No publish receipt the agent can read; generation, validation, publication and availability are indistinguishable.
- Runs in Studio only; the Phase 12 playtest agents test written instructions, not script behaviour.

### Order of attack (starting point)

Start at the contract and the check command (13.1, 13.2); everything else consumes them. Do not build more agent plumbing before 13.2 exists. Success test for the phase: a prompt becomes a published game two phones play, with no hand-written Swift or HTML.

---

## Phase 13: One contract, one check (polish)

Not in overview.md; added at user request 2026-11-15. Inspiration: the Quick Draw evidence log in `docs/agents/devkit-wishlist.md`. Decisions: a game is one versioned package; one headless check command is the only definition of "works" (Studio, CI, the agent and publish all call it); the player draws controller screens from data, not per-game Swift; unproven hardware behaviour is reported as untested, never as passing; keep the widget set to what Quick Draw and Hot Potato need.

Scope (2026-11-15): trimmed to what a creator needs to build, check and publish a game: the package, the check command, the agent check tools and one Publish that lists the game. Everything else is kept under "Deferred from Phase 13" at the end of this phase with its checklist lines unchanged; moving a line back reinstates it.

### 13.1 Game package v1

- [x] `Schema/pear-game.schema.json` — package manifest: scene, scripts, `controller` (declarative phone screen: ready button, countdown, status, score, role, cue names), `cues`, `capabilities` (tier, sensors, gestures with thresholds), `players`, `instructions`, `checks`. (Changed 2026-11-15: `controller` and `cues` stay optional fields until the data-driven controller, 13.5, is scheduled again.)
- [x] `Web/packages/pear-runtime/src/manifest.ts` — parse and lint the manifest; single home for gesture defaults, replacing the copies in `scene.ts`, `SKILL.md`, `scripting-api.md`. (Changed 2026-11-15: `RAISE_DEFAULTS` replaces the literals in `scene.ts`; `scene-format.md` and `SKILL.md` keep the numbers in prose, the latter regenerated only if 13.6 `gen-skill.mjs` returns.)
- [x] `Backend/src/bundle.rs` — validate and store the manifest on publish (rejects bad packages; unknown fields kept). (Changed 2026-11-15: `bundle.rs` is plugin tarballs only; the check is `Backend/src/manifest.rs`, called from `games.rs` `valid_version`, and the manifest is stored in `metadata.manifest`, a version without one still publishes.)
- [x] `Web/packages/pear-cloud/src/client.ts` — package type for publish and fetch.
- [x] `Games/QuickDraw/pear-game.json` — Quick Draw as the first package (thresholds live here only). (Changed 2026-11-15: thresholds also stay in `scene.json`, `QDRaiseDetector.swift` and `qd-phone.html` until 13.5; `lintManifest` reports drift with the scene. `Deploy/publish-quickdraw.mjs` now sends the manifest.)

### 13.2 Check command

- [ ] `Tools/pear-check/check.mjs` — CLI: schema, fake-`ctx` self-check, N simulated phones in one lobby with an injected clock and scripted gestures; JSON report listing tested and untested items, with file-specific errors. (Changed 2026-11-15: Studio and publish call this CLI directly; `checkPanel.ts` and `Deploy/smoke-game.mjs` are deferred.)
- [ ] `Games/QuickDraw/check.json` — check spec from `selfcheck.mjs` and `Deploy/smoke-quickdraw.mjs` (offset clocks, delayed and duplicate `raised`, ghost player).
- [ ] `Games/HotPotato/check.json` — second spec, proves the command is not Quick Draw shaped.

### 13.6 Agent tools and knowledge

- [ ] `Plugins/langchain-deepagents/runtime/tools.py` — `validate_game`, `simulate_game` (calls `pear-check`), bounded, structured failures with tested or untested status, no shell.
- [ ] `Plugins/langchain-deepagents/tests/test_tools.py` — scripted model: validate, fix, re-run; stale write rejected; out-of-scope write denied.
- [ ] `Plugins/langchain-deepagents/pear-plugin.json` — version bump; `pyproject.toml` and `uv.lock` kept equal.

### 13.7 Publish and launch page

- [ ] `Backend/src/api/games.rs` — publish gate: manifest valid and `metadata.check` present; receipt carries version, check status, join targets.
- [ ] `Web/studio/src/publishView.ts` — shows the check result and join targets; blocks on a failing check.

### 13.9 Seamless upgrade, publish and listing

Goal: updating a game from Studio never needs a Vultr refresh; one Publish uploads the version, lists it for players and shows the join link. Decisions: the player's Discover catalog is the games marketplace (the Phase 10 marketplace stays plugins only); only games the owner lists appear in the catalog; Flagship and HotPotato stay in the repo as test fixtures (tests and `Deploy/demo.sh` use them) but never appear in a production catalog.

- [ ] `Backend/src/api/library.rs` — catalog lists only `listed` games, with cover, description, tags and release notes; unlisted fixtures never show.
- [ ] `Backend/src/db.rs` — `listed` and listing fields on `Game`; migration `Backend/migrations/0005_listing.sql`. (Changed 2026-11-15: renumber to `0006_listing.sql`; `0005` is taken by 13.10 `0005_developer.sql`.) (Changed 2026-11-15: 13.10 is deferred; keep the number 0006 so numbering is stable when it returns.)
- [ ] `Backend/src/memstore.rs` — same fields, so the dev server matches Postgres.
- [ ] `Backend/src/api/games.rs` — publish accepts listing fields and `listed`; one call creates the version and lists the game.
- [ ] `Web/studio/src/publishView.ts` — one Publish: check (13.2), upload, list, receipt; "Update game" vs "New game" on the same game id; warns when `/api/version` shows a behind server. (Changed 2026-11-15: the behind-server warning is dropped with `/api/version`, deferred.) (Changed 2026-11-15: must carry `metadata.manifest` through; `Project.snapshot` in `project.ts` builds metadata from scratch and drops it today.)
- [ ] Human, needs the Vultr URL and owner token: delete the placeholder games already on the hosted library (`DELETE /api/games/{id}` is owner-only); the repo seeds are gone.

Not planned: a general UI description language beyond the Quick Draw and Hot Potato widget set; Studio-hosted agent runners in a live lobby; recorded audio pipeline (cues stay synthesized); collaborative editing (Phase 6).

### Deferred from Phase 13

Not needed for the first publishable game; none of it is built. Original section numbers are kept so earlier references still hold.

#### 13.2 Check command (rest)

- [ ] `Games/Flagship/check.json` — third spec (screen mode).
- [ ] `Deploy/smoke-game.mjs` — generalizes `smoke-quickdraw.mjs`: any game, lobby-scoped, real sockets against local or hosted.
- [ ] `Web/studio/src/checkPanel.ts` — Studio action "Run N simulated phones in a lobby" with scripted gestures and a fake clock that also drives page-side countdowns.

#### 13.3 Conformance across runtimes

- [ ] `Web/packages/pear-runtime/test/conformance.test.ts` — runs the shared fixtures through the TypeScript runtime and `LocalServer`.
- [ ] `Backend/tests/conformance.rs` — same fixtures through rquickjs `script_host`.
- [ ] `Packages/PearScript/Tests/PearScriptTests/ConformanceTests.swift` — same fixtures through the Swift client and server engines.
- [ ] `docs/creators/scripting-api.md` — every `ctx` member marked supported or unsupported per runtime (`ctx.spawn` etc.); the conformance run is the evidence.

#### 13.4 Script API gaps found by Quick Draw

- [ ] `Backend/src/game_server/script_host.rs` — `ctx.lobby`; per-player timers (`ctx.after(ms, tag, data, playerId?)`); `ctx.players()` with last-seen; `phaseEnteredAt` helper; defined `ctx.cancel` on a fired handle.
- [ ] `Web/packages/pear-script/src/server-local.ts` — the same members in the local server.
- [ ] `Packages/PearScript/Sources/PearScript/ServerScriptEngine.swift` — the same members (Swift server engine).
- [ ] `Backend/src/game_server/session.rs` — connection quality to scripts; owner kick of a ghost player.

#### 13.5 Data-driven phone controller

- [ ] `Packages/PearInput/Sources/PearInput/RaiseDetector.swift` — raise and lower from gravity with calibrated rest pose, thresholds from the package; replaces `QDRaiseDetector`.
- [ ] `Apps/PearPlayer/PearPlayer/Play/Controller/ControllerView.swift` — draws the manifest's controller screen; server scripts drive it by events.
- [ ] `Apps/PearPlayer/PearPlayer/Play/Controller/ControllerSession.swift` — socket, backoff, calibration, monotonic reaction clock; replaces `QuickDrawSession`.
- [ ] `Packages/PearOutput/Sources/PearOutput/Cues.swift` — shared cue library (tick, arming drone, fire crack, win, lose, fanfare); scripts call `self.audio.play("tick")`.
- [ ] `Web/packages/pear-runtime/src/cues.ts` — the same cue names and sounds for the web phone page.
- [ ] `Apps/PearPlayer/PearPlayer/PlayerModel.swift` — remove the `isPhoneOnly` / `QuickDrawSession` special case; launch from the manifest. (Gate: Quick Draw plays from data with no `Play/QuickDraw/*` code; then delete that folder and `Web/studio/public/qd-*`. (Changed 2026-11-15: the gate also needs the iPad referee screen at parity, see 13.12 `DisplayView.swift`; deleting `Play/QuickDraw/*` earlier removes the master screen.)

#### 13.6 Agent tools and knowledge (rest)

- [ ] `Plugins/langchain-deepagents/runtime/server.py` — expected-revision hashes on writes (stale writes rejected); declared scopes enforced; publish action with explicit approval and a receipt.
- [ ] `Plugins/langchain-deepagents/runtime/translate.py` — forward controller, cues and assets, not only scripts and scene.
- [ ] `Tools/pear-check/gen-skill.mjs` — generates `SKILL.md` and the API summary from `scripting-api.md` and the manifest schema (one source).
- [ ] `Plugins/langchain-deepagents/skills/pear-scripting/SKILL.md` — generated output, plus scaffolds from Quick Draw and Hot Potato.
- [ ] `Plugins/langchain-deepagents/evals/cases.json` — five prompt-to-game cases scored by `pear-check` (opt-in, live model; not in default tests).

#### 13.7 Publish and launch page (rest)

- [ ] `Web/studio/src/lobbiesPanel.ts` — live lobbies per game, players, kick.
- [ ] `Packages/PearLibrary/Sources/PearLibrary/Playability.swift` — playability from the manifest's capabilities, not scene guesses.
- [ ] `Apps/PearPlayer/PearPlayer/Library/GameDetailView.swift` — instructions, live lobbies to join, device readiness.

#### 13.8 Hardware realism and environment

- [ ] `Apps/PearPlayer/PearPlayer/Play/Controller/MotionReplay.swift` — DEBUG replayable gravity script for the simulator (the simulator has no motion).
- [ ] `Apps/PearPlayer/PearPlayer.xcodeproj/project.pbxproj` — a unit-test target for the app (detector, controller, protocol).
- [ ] `Packages/PearLibrary/Sources/PearLibrary/DeviceProfile.swift` — readiness diagnostics: permissions, calibration, connection, distinguishing denied, unsupported and unknown.
- [ ] `Deploy/preflight.sh` — checks service and database names (`omni` vs `pear`) and required env, without printing secrets.

#### 13.9 Seamless upgrade, publish and listing (rest)

- [ ] `Backend/src/api/library.rs` — catalog lists only `listed` games, with cover, description, tags and release notes; unlisted fixtures never show.
- [ ] `Backend/src/db.rs` — `listed` and listing fields on `Game`; migration `Backend/migrations/0005_listing.sql`. (Changed 2026-11-15: renumber to `0006_listing.sql`; `0005` is taken by 13.10 `0005_developer.sql`.)
- [ ] `Backend/src/memstore.rs` — same fields, so the dev server matches Postgres.
- [ ] `Backend/src/api/games.rs` — publish accepts listing fields and `listed`; one call creates the version and lists the game.
- [ ] `Backend/src/game_server/session.rs` — upgrade policy for live lobbies: finish the current match, then move to the new version, instead of restarting mid-match (`session::reload` today).
- [ ] `Backend/src/api/mod.rs` — `GET /api/version` (build, applied migrations) so Studio and the player can tell the server is behind.
- [ ] `Deploy/deploy.sh` — one command (or CI on merge to `main`) that builds, migrates and restarts the Vultr box, so a backend change never needs manual steps; static phone pages ship inside the published version (13.1), not the server image.
- [ ] `Web/studio/src/lobbiesPanel.ts` — shows which live lobbies the new version has reached.
- [ ] `Apps/PearPlayer/PearPlayer/Library/GameDetailView.swift` — "Updated" badge and release notes; the newest version is fetched at launch.

#### Part II: Developer access, Quick Draw in Studio, and the gaps

Not in overview.md; added at user request 2026-11-15. Phase 13 (above) makes games data; this part covers what it left out: an in-house developer login that can edit every hosted game, Quick Draw ported into Studio as an ordinary project, and Studio grown ("reverse engineered" from what Quick Draw needed) to author everything Quick Draw does without hand-written Swift or HTML. Decisions: developer accounts use a password checked by the server (argon2id), never passwordless dev sign-in; a developer may publish, delete and edit the listing of any game; covers and descriptions live in Postgres (durable across redeploys); the iPad is the referee/master screen for phone-only games and must be drawn from data like the phone controller. Success test: a developer signs in to Studio, opens Quick Draw, changes a setting, a text and a cue, previews it with simulated phones and the referee screen, publishes, and the iPad and phones show the change with no Xcode build and no Vultr refresh.

#### 13.10 Developer accounts and game listing basics

- [ ] `Backend/migrations/0005_developer.sql` — `accounts.role` (player | developer), `accounts.password_hash`; `games.description`, `games.cover`, `games.cover_type`.
- [ ] `Backend/src/api/accounts.rs` — developer sign-in (`provider: "developer"`, username + password, argon2id, identical 401 for wrong password and unknown user); the passwordless dev path accepts only `provider: "dev"` (closes signing in as another provider's subject); `role` on every account response.
- [ ] `Backend/src/api/games.rs` — developers pass every owner check; `GET /api/games?all=1`; `PUT /api/games/{id}` (title, description); cover `PUT`/`DELETE`/public `GET`.
- [ ] `Backend/src/db.rs` — role, password hash, description and cover queries.
- [ ] `Backend/src/memstore.rs` — same fields, so the dev server matches Postgres.
- [ ] `Backend/src/api/library.rs` — `description` and `coverUrl` on catalog entries.
- [ ] `Backend/src/main.rs` — `create-developer <username> "<display name>"` CLI (password from `PEAR_DEVELOPER_PASSWORD`, never argv).
- [ ] `Web/packages/pear-cloud/src/client.ts` — developer sign-in, `role`, all games, game metadata and cover calls.
- [ ] `Web/studio/src/loginScreen.ts` — Developer sign-in (username + password).
- [ ] `Web/studio/src/allGamesSection.ts` — developers see every hosted game and Open any of them as a project linked to its game id.
- [ ] `Web/studio/src/aboutPanel.ts` — title, description and cover editor for a cloud-linked game.
- [ ] `Packages/PearCloud/Sources/PearCloud/CloudClient.swift` — `description` and `coverURL` on `CatalogEntry`.
- [ ] `Apps/PearPlayer/PearPlayer/Library/GameDetailView.swift` — real cover and description, generated art as fallback.
- [ ] Human: create the developer account on the Vultr database (`docker compose run --rm -e PEAR_DEVELOPER_PASSWORD backend /app/pear-backend create-developer ...`) and share the login privately.

#### 13.11 Port Quick Draw into Studio

Quick Draw stops being a repo folder published by script and becomes a Studio project like any other.

- [ ] `Web/studio/src/templates/quickdraw.ts` — "New game from Quick Draw" template (scene, scripts, instructions), so the team can fork it.
- [ ] `Web/studio/src/phonePlay.ts` — phone-only Play hosts a lobby code, shows phone join links with `&lobby=` and an iPad referee link, instead of the shared `OPEN` lobby.
- [ ] `Games/QuickDraw/README.md` — the repo copy is a test fixture exported from Studio; Studio's published version is the source of truth.
- [ ] `Deploy/publish-quickdraw.mjs` — retired once Studio Publish (13.9) is the only path; until then it signs in with the developer login, not a dev subject.
- [ ] `Deploy/smoke-quickdraw.mjs` — developer login instead of dev sign-in, so the hosted box can turn dev sign-in off.

#### 13.12 Studio parity with Quick Draw (gaps in Phase 13)

Each item is something Quick Draw needed that Phase 13 does not schedule.

- [ ] `Schema/pear-game.schema.json` — `settings` (typed tunables with default, min, max: wins needed, arming delay, countdown, idle kick, thresholds) and `display` (master-screen widgets: lobby slots, scoreboard, countdown, result bars, how-to-play from instructions). Extends 13.1.
- [ ] `Backend/src/game_server/script_host.rs` — read-only `ctx.settings` from the version's manifest. Extends 13.4.
- [ ] `Web/packages/pear-script/src/server-local.ts` — the same `ctx.settings`.
- [ ] `Packages/PearScript/Sources/PearScript/ServerScriptEngine.swift` — the same `ctx.settings`.
- [ ] `Games/QuickDraw/scripts/game.js` — constants (wins, arming window, countdown, idle kick) read from `ctx.settings`.
- [ ] `Web/studio/src/settingsPanel.ts` — edit settings within their ranges; applied live in local runs.
- [ ] `Web/studio/src/cuesPanel.ts` — pick and preview the cue played for each event (consumes 13.5 `cues.ts`).
- [ ] `Web/studio/src/controllerPreview.ts` — draws the phone controller and the referee display from the manifest next to 13.2's simulated phones.
- [ ] `Apps/PearPlayer/PearPlayer/Play/Controller/DisplayView.swift` — iPad referee/master screen drawn from `display` and the version's instructions; replaces `QuickDrawRefereeView`.
- [ ] `Backend/src/api/games.rs` — per-game editors (share edit rights with one account) for collaborators who are not developers.
- [ ] `Backend/src/blobs.rs` — durable storage on the hosted box (S3 or Postgres fallback); avatars are lost on every redeploy today because `PEAR_S3_*` is unset.
- [ ] `Deploy/vultr-bootstrap.sh` — hosted default `PEAR_DEV_SIGNIN=0` once publish and smoke scripts use the developer login (passwordless sign-in lets anyone act as any dev account).
- [ ] `docs/creators/scripting-api.md` — `ctx.settings`, referee role, lobby and display contract.

Not planned: multiple developer roles or audit log (one developer role for the hackathon); editing another account's profile picture.

---

## Phase 14: Agent-built games: PearUI, headless sim, Pear MCP (MAJOR SYSTEMATIC UPDATE, agreed 2026-11-15)

### Status: PAUSED (2026-11-15 03:30, by user). Do not resume without the user saying so.
- Built on main: 14.1 (`07b267f`), 14.3 (`f62b61f`), 14.5 (`a434312`). Built on a pushed branch, not merged: 14.2 `feat/pearui-swift` (`72cf8d2`, iOS Simulator build passes, not run on a device).
- Not built: 14.4, 14.6, 14.7, plus `Schema/pearui.schema.json`. Partial, uncommitted work from stopped workers: `.claude/worktrees/agent-afb58de7c51f3c48b` (14.4), `agent-a0ae30f8a66da0dad` (14.6), `agent-a075703c3defe4511` (14.7, game.js edit started). Local only; inspect before reuse, else restart from the briefs below.
- Resume order: merge `feat/pearui-swift` → 14.4 (unblocks 14.5 end to end) → 14.7 (needs the `aim` server path) → 14.6 → schema file.
- Workers for resume: run on the 2 remote laptops (V2 autonomy, `.claude/instructions.md` Speed Rules). This laptop orchestrates only.

### Agreements (Socratic session, binding)
- A1 Users: 4-person team, demo speed. No public sign-up, quotas, review.
- A2 Agent writes the full game (scripts, scene, instructions, ui) in a self-iterating loop: write → headless sim → read report → fix; human verifies in Studio Live Preview, then publishes.
- A3 MCP both ways: Pear MCP server exposes prepackaged tools + kit reference; agent may also call external MCP servers.
- A5 Native screens = server-driven UI only (iOS forbids downloaded code). Fixed component kit "PearUI": Swift renderer in PearPlayer, web renderer in Studio, same JSON → 1:1.
- A6 Agent sim is headless (Node), no browser.
- A7 Closed source = API boundary: agents/games see only kit + MCP tools, never backend source. Pear Studio is packaged/distributed. Repo stays public.
- A8 Map: MapLibre + OSM tiles (no key). Later: marketplace map plugin with hand-made iOS look.
- Deadline 05:00 2026-11-15. Validation target: Quick Draw rebuilt in PearUI matches native screens.

### Contract C1: PearUI v1 (`ui.json`, a game version file next to scene.json/scripts)
- Root: `{"pearui":1,"route":[{"when":"<expr>","screen":"<id>"}...],"screens":{"<id>":Node}}`; first matching `route` wins, last entry has no `when`.
- View state (read-only to UI): `ev.<name>` = latest `data` of each script→client event (e.g. `ev.state.phase` from `ctx.remote.fireAll("state",…)`); `me` = `_welcome` data `{id,name,lobby}`; `local.<k>` = values set by `set` actions; `device` = `{kind:"phone"|"ipad"|"watch"}`.
- Bindings: any string prop may contain `{{expr}}`; expr = dotted path, optional `==`/`!=` literal, `!` prefix, `||` fallback. No arbitrary JS.
- Common props on every Node: `type`, `if` (expr), `id`, `style` (`tone`: neutral|accent|good|bad|warn; `size`: s|m|l|xl|huge; `align`: start|center|end; `pad`: 0-4; `grow`: bool).
- Nodes: `column`/`row`/`stack` (`children`), `text` (`value`), `button` (`label`, `action`), `image` (`src` = asset name), `timer` (`until` epoch ms expr, counts down), `list` (`items` expr → array, `item` Node; inside it `item.<k>`), `gauge` (`value` 0..1), `spacer`, `map` (`markers` expr → [{lat,lng,label,tone}], `follow`: "me"), `sensor` (invisible; `kind`: motion|location; `event`; `hz` ≤30; streams `{pitch,roll,yaw}` or `{lat,lng,acc}` as a client→server event), `effect` (invisible; `on` expr change → `haptic`: light|heavy|success|fail, `sound`: asset name).
- Action: `{"send":"<event>","data":{…bindings}}` → client sends `{name,data}`; or `{"set":"<local key>","value":…}`.
- Unknown `type` renders nothing (forward compatible). Schema file: `Schema/pearui.schema.json`.

### C1 amendments (as built, binding)
- Storage: a version has no extra-file slot. `ui.json` (and any non-script file, e.g. `scenario.json`) is a version ASSET: upload `PUT /api/games/{id}/assets/ui.json`, list it in the version's `assets` map under `"ui.json"`; clients read it via `GET /api/assets/{sha256}`. PearPlayer looks for an asset named `ui.json` or ending in `/ui.json`.
- Join hello: a PearUI client sends `{"name":"role","data":{"role":"referee"|"phone","kind":"ipad"|"phone"}}` on socket open/reload (same as native Quick Draw). Scripts that ignore `role` are unaffected.
- Expr: Swift also supports `.length` on arrays/strings; web `@pear/ui` does not yet (add to `Web/packages/pear-ui/src/expr.ts` on resume). Equality is loose on number vs string (`2 == '2'`).
- Raise detection: PearUI has no client logic, so Quick Draw's 60/45 pitch hysteresis must move server side: client streams `aim {pitch,roll,yaw}` from a `sensor` node; game.js gets an additive `aim` handler feeding the existing raised/lowered path (14.7).
- Swift renderer limits: effect `sound` ignored (haptics only); one motion and one location stream per screen; map marker colors good=green, bad=red, else orange; macOS falls back to existing paths.

### Contract C2: headless sim `runScenario(scenario, opts) → report`
- Scenario JSON: `{"game":"<id>","version"?:n,"lobby"?:"CODE","durationMs":n,"devices":[{"name","kind":"phone"|"ipad"|"watch","role"?,"script":[{"at":ms,"send":{name,data}}|{"at":ms,"motion":{pitch,roll,yaw}}|{"at":ms,"gps":{lat,lng}}|{"at":ms,"tap":true}]}],"expect":[{"by":ms,"expr":"<C1 expr on a device's view state>","device":"<name>"}]}`.
- Report JSON: `{"ok":bool,"expect":[{…,"pass":bool,"actual"}],"frames":[{"t","device","dir":"in"|"out","name","data"}],"logs":[…from /debug],"final":{"<device>":viewState}}`.
- Reactive rules (C2 extension, as built): device `rules: [{on:"<event>", when?:"<expr on {data, ...viewState}>", after?:ms, send:{name,data}, once?:bool}]`; `{{expr}}` in `send.data` resolves against the same scope. Needed because cues arrive at random times (Quick Draw `fire`). Device `role` sends `role {role}` after `_welcome`. Timed `motion`/`gps` steps send `aim`/`location` (override with scenario `motionEvent`/`gpsEvent`).
- Runner: from `Web/`: `npx vite-node packages/pear-sim/bin/pear-sim-run.ts <scenario.json> [--cloud URL] [--token T] [--full]` (no tsx installed). Prints report JSON (frames trimmed to last 200 unless --full); exit 0 ok, 1 expectations failed, 2 usage. Debug logs only with `--token` of an owner/developer.
- Auth: dev sign-in per device name (hosted `PEAR_DEV_SIGNIN=1`); server URL from `PEAR_CLOUD_URL` (default hosted).

### Contract C3: Pear MCP tools (stdio; env `PEAR_CLOUD_URL`, `PEAR_TOKEN` developer token)
- `run_scenario` spawns the runner above (cwd `Web/`); `save_version` uploads non-script files as assets (C1 amendments); `get_game` returns them by fetching each asset.
- `kit_reference` (C1 + script API + scenario format), `list_games`, `get_game {id}` → files, `create_game {title}`, `save_version {id, files}` → version n, `run_scenario {scenario}` → C2 report, `read_logs {id, lobby?}`, `publish {id, version}`. No source-code or shell tools.

### 14.1 PearUI web renderer + schema
- [x] `Web/packages/pear-ui/` — types, expr eval, validate, DOM renderer (`mount(el, ui, viewState, onAction)`); vitest (Built 2026-11-15 `07b267f`: `mount(el, ui, state, onAction, hooks?, assetUrl?)`, `reduceFrame`, `emptyState`, `pickScreen`, `validate`; map node is a text placeholder, Studio supplies MapLibre; 4 tests in `Web/packages/pear-ui/test/pearui.test.ts`)
- [ ] `Schema/pearui.schema.json`
### 14.2 PearUI Swift renderer in PearPlayer
- [ ] `Apps/PearPlayer/PearPlayer/Play/PearUI/` — (Built on branch `feat/pearui-swift` `72cf8d2`, NOT merged; hooks in `Apps/PearPlayer/PearPlayer/PlayerModel.swift` (`pearUI` session, ui.json checked before Quick Draw), `Apps/PearPlayer/PearPlayer/Library/LibraryView.swift` (full-screen cover), `Apps/PearPlayer/Info.plist` (location text); nodes kept as raw `JSONValue`, no typed enum) Codable model, expr eval, SwiftUI renderer, CoreMotion/CoreLocation sensor nodes, haptics; used by play screen when version has `ui.json`
### 14.3 Headless sim
- [x] `Web/packages/pear-sim/src/headless.ts` + `bin/pear-sim-run` — C2 over real `/play` sockets; Quick Draw scenario passes (Built 2026-11-15 `f62b61f`: `Web/packages/pear-sim/bin/pear-sim-run.ts`, `Games/QuickDraw/scenario.json` (2 phones + iPad referee, reactive rules) passed on hosted in 19 s; pear-sim depends on `@pear/ui` for expr, recorded in architecture.md)
### 14.4 Pear MCP server
- [ ] `Tools/pear-mcp/` — C3 over `@modelcontextprotocol/sdk` stdio
### 14.5 Deep Agents uses Pear MCP + loop
- [x] `Plugins/langchain-deepagents/runtime/` — MCP client (langchain-mcp-adapters), loop prompt: write → run_scenario → fix until expect passes; external MCP servers from config (Built 2026-11-15 `a434312`: `runtime/pear_tools.py` (env `PEAR_MCP_COMMAND`, `PEAR_MCP_ARGS`, `PEAR_EXTRA_MCP`), mode `game` in `runtime/server.py`, CLI `runtime/game_cli.py` (`uv run python runtime/game_cli.py "<prompt>"`), `tests/test_game_mode.py`; 70 pytest pass; never run against a real MCP server since 14.4 is not built)
### 14.6 Studio Live Preview tab
- [ ] `Web/studio/src/livePreview/` — device frames rendering PearUI from live session, MapLibre GPS map of devices, terminal of /debug frames + tool calls
### 14.7 Quick Draw in PearUI (validation)
- [ ] `Games/QuickDraw/ui.json` — referee (ipad) + gun (phone) screens matching native; `Games/QuickDraw/scenario.json` passes in 14.3
### 14.8 Later (not scheduled tonight)
- [ ] thumbnails + gameplay image carousel; developer web About edit; marketplace map plugin with iOS look; iOS Simulator stream check

## Cross-Cutting: Hardware verification (compressed)

Built: AirPods, iPhone / iPad / Pencil probes and host in Tools/ with measured results.

Still open: AirPods Pro, venue Wi-Fi and hotspot untested; Pencil units FLAGGED (see Phase 1).

Full text: planHistory/cross-hardware.md

---

## Phase 7: After the Hackathon (compressed, no checklist)

Built: nothing; this phase has no checklist.

Still open: Lua scripting backend; third-party Bluetooth adapters via `PearAdapters`; iPad / Pencil and Vision Pro input; player apps on iOS / visionOS that connect players to the game server through a `RemoteChannel` (the library shell is Phase 9; running games on the player is open); relay server for remote collaboration; automatic state replication; permissions, version history and moderation for hosted games.

Full text: planHistory/phase-07.md
