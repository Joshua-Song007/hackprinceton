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

Built: backend live integration (CORS, static Studio, /debug, memstore, migrations); Web SDK packages (pear-core / runtime / script / sim / cloud); Web Studio app (dockview layout, editor, explorer, inspector, run, debug panel, account); Tauri 2 desktop shell + release workflow; Vultr deploy files; blank template and demo script.

Still open: demo run on the Vultr box from the desktop executable; two people in one server session; brand-kit UI review; Vite watch ignore for src-tauri; macOS desktop untested. Web Studio is now acknowledged in overview.md (no longer a mismatch).

Full text: planHistory/phase-08.md

---

## Phase 9: Player App (compressed)

Built: backend catalog + Sign in with Apple; PearCloud catalog / Apple client; PearLibrary (device profile, playability, session store, library model, stub launcher); PearPlayer iOS + macOS app with sign-in, library, detail and theme.

Still open: Apple Developer team, bundle id, entitlement; running games on the player (needs iOS on PearInput / PearRuntime / PearScript / PearOutput). Player UI never seen rendered. Player apps are now in overview.md scope.

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

Built: 12.1 to 12.5 (instructions data and lint, Deep Agents plugin instructions mode and agent players, observation and pausable clock, playtest report, Instructions panel). Local Play only; instructions win over `scene.json`; cloud saves keep them in `metadata.instructions`.

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

### 13.1 Game package v1

- [ ] `Schema/pear-game.schema.json` — package manifest: scene, scripts, `controller` (declarative phone screen: ready button, countdown, status, score, role, cue names), `cues`, `capabilities` (tier, sensors, gestures with thresholds), `players`, `instructions`, `checks`.
- [ ] `Web/packages/pear-runtime/src/manifest.ts` — parse and lint the manifest; single home for gesture defaults, replacing the copies in `scene.ts`, `SKILL.md`, `scripting-api.md`.
- [ ] `Backend/src/bundle.rs` — validate and store the manifest on publish (rejects bad packages; unknown fields kept).
- [ ] `Web/packages/pear-cloud/src/client.ts` — package type for publish and fetch.
- [ ] `Games/QuickDraw/pear-game.json` — Quick Draw as the first package (thresholds live here only).

### 13.2 Check command

- [ ] `Tools/pear-check/check.mjs` — CLI: schema, fake-`ctx` self-check, N simulated phones in one lobby with an injected clock and scripted gestures; JSON report listing tested and untested items, with file-specific errors.
- [ ] `Games/QuickDraw/check.json` — check spec from `selfcheck.mjs` and `Deploy/smoke-quickdraw.mjs` (offset clocks, delayed and duplicate `raised`, ghost player).
- [ ] `Games/HotPotato/check.json` — second spec, proves the command is not Quick Draw shaped.
- [ ] `Games/Flagship/check.json` — third spec (screen mode).
- [ ] `Deploy/smoke-game.mjs` — generalizes `smoke-quickdraw.mjs`: any game, lobby-scoped, real sockets against local or hosted.
- [ ] `Web/studio/src/checkPanel.ts` — Studio action "Run N simulated phones in a lobby" with scripted gestures and a fake clock that also drives page-side countdowns.

### 13.3 Conformance across runtimes

- [ ] `Web/packages/pear-runtime/test/conformance.test.ts` — runs the shared fixtures through the TypeScript runtime and `LocalServer`.
- [ ] `Backend/tests/conformance.rs` — same fixtures through rquickjs `script_host`.
- [ ] `Packages/PearScript/Tests/PearScriptTests/ConformanceTests.swift` — same fixtures through the Swift client and server engines.
- [ ] `docs/creators/scripting-api.md` — every `ctx` member marked supported or unsupported per runtime (`ctx.spawn` etc.); the conformance run is the evidence.

### 13.4 Script API gaps found by Quick Draw

- [ ] `Backend/src/game_server/script_host.rs` — `ctx.lobby`; per-player timers (`ctx.after(ms, tag, data, playerId?)`); `ctx.players()` with last-seen; `phaseEnteredAt` helper; defined `ctx.cancel` on a fired handle.
- [ ] `Web/packages/pear-script/src/server-local.ts` — the same members in the local server.
- [ ] `Packages/PearScript/Sources/PearScript/ServerScriptEngine.swift` — the same members (Swift server engine).
- [ ] `Backend/src/game_server/session.rs` — connection quality to scripts; owner kick of a ghost player.

### 13.5 Data-driven phone controller

- [ ] `Packages/PearInput/Sources/PearInput/RaiseDetector.swift` — raise and lower from gravity with calibrated rest pose, thresholds from the package; replaces `QDRaiseDetector`.
- [ ] `Apps/PearPlayer/PearPlayer/Play/Controller/ControllerView.swift` — draws the manifest's controller screen; server scripts drive it by events.
- [ ] `Apps/PearPlayer/PearPlayer/Play/Controller/ControllerSession.swift` — socket, backoff, calibration, monotonic reaction clock; replaces `QuickDrawSession`.
- [ ] `Packages/PearOutput/Sources/PearOutput/Cues.swift` — shared cue library (tick, arming drone, fire crack, win, lose, fanfare); scripts call `self.audio.play("tick")`.
- [ ] `Web/packages/pear-runtime/src/cues.ts` — the same cue names and sounds for the web phone page.
- [ ] `Apps/PearPlayer/PearPlayer/PlayerModel.swift` — remove the `isPhoneOnly` / `QuickDrawSession` special case; launch from the manifest. (Gate: Quick Draw plays from data with no `Play/QuickDraw/*` code; then delete that folder and `Web/studio/public/qd-*`.)

### 13.6 Agent tools and knowledge

- [ ] `Plugins/langchain-deepagents/runtime/tools.py` — `validate_game`, `simulate_game` (calls `pear-check`), bounded, structured failures with tested or untested status, no shell.
- [ ] `Plugins/langchain-deepagents/runtime/server.py` — expected-revision hashes on writes (stale writes rejected); declared scopes enforced; publish action with explicit approval and a receipt.
- [ ] `Plugins/langchain-deepagents/runtime/translate.py` — forward controller, cues and assets, not only scripts and scene.
- [ ] `Tools/pear-check/gen-skill.mjs` — generates `SKILL.md` and the API summary from `scripting-api.md` and the manifest schema (one source).
- [ ] `Plugins/langchain-deepagents/skills/pear-scripting/SKILL.md` — generated output, plus scaffolds from Quick Draw and Hot Potato.
- [ ] `Plugins/langchain-deepagents/tests/test_tools.py` — scripted model: validate, fix, re-run; stale write rejected; out-of-scope write denied.
- [ ] `Plugins/langchain-deepagents/evals/cases.json` — five prompt-to-game cases scored by `pear-check` (opt-in, live model; not in default tests).
- [ ] `Plugins/langchain-deepagents/pear-plugin.json` — version bump; `pyproject.toml` and `uv.lock` kept equal.

### 13.7 Publish and launch page

- [ ] `Backend/src/api/games.rs` — publish gate: manifest valid and `metadata.check` present; receipt carries version, check status, join targets.
- [ ] `Web/studio/src/publishView.ts` — shows the check result and join targets; blocks on a failing check.
- [ ] `Web/studio/src/lobbiesPanel.ts` — live lobbies per game, players, kick.
- [ ] `Packages/PearLibrary/Sources/PearLibrary/Playability.swift` — playability from the manifest's capabilities, not scene guesses.
- [ ] `Apps/PearPlayer/PearPlayer/Library/GameDetailView.swift` — instructions, live lobbies to join, device readiness.

### 13.8 Hardware realism and environment

- [ ] `Apps/PearPlayer/PearPlayer/Play/Controller/MotionReplay.swift` — DEBUG replayable gravity script for the simulator (the simulator has no motion).
- [ ] `Apps/PearPlayer/PearPlayer.xcodeproj/project.pbxproj` — a unit-test target for the app (detector, controller, protocol).
- [ ] `Packages/PearLibrary/Sources/PearLibrary/DeviceProfile.swift` — readiness diagnostics: permissions, calibration, connection, distinguishing denied, unsupported and unknown.
- [ ] `Deploy/preflight.sh` — checks service and database names (`omni` vs `pear`) and required env, without printing secrets.

Not planned: a general UI description language beyond the Quick Draw and Hot Potato widget set; Studio-hosted agent runners in a live lobby; recorded audio pipeline (cues stay synthesized); collaborative editing (Phase 6).

---

## Cross-Cutting: Hardware verification (compressed)

Built: AirPods, iPhone / iPad / Pencil probes and host in Tools/ with measured results.

Still open: AirPods Pro, venue Wi-Fi and hotspot untested; Pencil units FLAGGED (see Phase 1).

Full text: planHistory/cross-hardware.md

---

## Phase 7: After the Hackathon (compressed, no checklist)

Built: nothing; this phase has no checklist.

Still open: Lua scripting backend; third-party Bluetooth adapters via `PearAdapters`; iPad / Pencil and Vision Pro input; player apps on iOS / visionOS that connect players to the game server through a `RemoteChannel` (the library shell is Phase 9; running games on the player is open); relay server for remote collaboration; automatic state replication; permissions, version history and moderation for hosted games.

Full text: planHistory/phase-07.md
