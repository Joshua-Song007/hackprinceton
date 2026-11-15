# Build Plan

Product name is Pear; code keeps the Pear prefix. Phases 1-5, 8-10 and Cross-Cutting are compressed (full text in planHistory/, read via grep). Only Phase 6 (stretch), 7, 11 and 12 are open here.

- Checklist, worked top-to-bottom. Each item is exactly one file with a single responsibility — `stage`/`apply` should be able to touch one checklist item without needing to also change any other file. Phases are ordered by dependency (later phases consume earlier ones).
- Paths are relative to the repo root. Packages use SwiftPM layout: `Packages/<Pkg>/Package.swift`, `Sources/<Pkg>/`, `Tests/<Pkg>Tests/`. Dependency rules come from the package table in `overview.md`; any item that bends them carries a parenthetical note.
- Format: `- [ ] \`path\` — responsibility`.

---

## Phase 1: Workspace Scaffold & Core Runtime (compressed)

Built: every package exists with its dependency boundary enforced in each `Package.swift`; USIS v1 schema and Codable types; `InputSource` / `InputBus` / `OutputSink`; `PearInput` pipeline (validation, clock sync, jitter buffer, calibration, capability tiers, stats); RealityKit `SceneRunner` with triggers and the Phase 1 exit test (hard-coded packet fires a trigger); Studio shell with viewport.

Still open: FLAGGED, not decided: `pencil` channel units (iPad gives a 2D normalized tip and normalized hover, no tilt field; `roll` / `hover` required in the schema but absent on some Pencils). Unscheduled: playback path for `AudioEmitterComponent` / `self.audio.play`. Provisional (needs-tien-review): hand-written `PearStudio.xcodeproj` (regenerate in Xcode before adding targets); `AppModel` placeholder `RecordingOutputSink`; overview.md update for `triggerEntered` / `triggerExited` events pending on user request.

### 1.1 Workspace & package scaffold

- [x] `Pear.xcworkspace/contents.xcworkspacedata`
- [x] `Packages/PearCore/Package.swift`
- [x] `Packages/PearInput/Package.swift`
- [x] `Packages/PearOutput/Package.swift`
- [x] `Packages/PearRuntime/Package.swift`
- [x] `Packages/PearScript/Package.swift`
- [x] `Packages/PearScript/Sources/PearScript/Module.swift`
- [x] `Packages/PearSim/Package.swift`
- [x] `Packages/PearSim/Sources/PearSim/Module.swift`
- [x] `Packages/PearBridge/Package.swift`
- [x] `Packages/PearBridge/Sources/PearBridge/Module.swift`
- [x] `Packages/PearCollab/Package.swift`
- [x] `Packages/PearCollab/Sources/PearCollab/Module.swift`
- [x] `Packages/PearAdapters/Package.swift`
- [x] `Packages/PearAdapters/Sources/PearAdapters/Module.swift`
- [x] `.gitignore`

### 1.2 PearCore — math and USIS types (pure, no I/O)

- [x] `Schema/usis.schema.json`
- [x] `Packages/PearCore/Sources/PearCore/Math/Vector3.swift`
- [x] `Packages/PearCore/Sources/PearCore/Math/Quaternion.swift`
- [x] `Packages/PearCore/Sources/PearCore/Math/Pose.swift`
- [x] `Packages/PearCore/Sources/PearCore/USIS/UsisEnums.swift`
- [x] `Packages/PearCore/Sources/PearCore/USIS/UsisChannels.swift`
- [x] `Packages/PearCore/Sources/PearCore/USIS/UsisPacket.swift`
- [x] `Packages/PearCore/Sources/PearCore/Frame/InputFrame.swift`
- [x] `Packages/PearCore/Sources/PearCore/Output/OutputCommand.swift`
- [x] `Packages/PearCore/Tests/PearCoreTests/QuaternionTests.swift`
- [x] `Packages/PearCore/Tests/PearCoreTests/UsisPacketTests.swift`

### 1.3 PearInput — protocols, validation, pipeline

- [x] `Packages/PearInput/Sources/PearInput/InputSource.swift`
- [x] `Packages/PearInput/Sources/PearInput/InputBus.swift`
- [x] `Packages/PearInput/Sources/PearInput/PacketValidator.swift`
- [x] `Packages/PearInput/Sources/PearInput/ClockSync.swift`
- [x] `Packages/PearInput/Sources/PearInput/JitterBuffer.swift`
- [x] `Packages/PearInput/Sources/PearInput/Calibration.swift`
- [x] `Packages/PearInput/Sources/PearInput/CapabilityTier.swift`
- [x] `Packages/PearInput/Sources/PearInput/DeviceStats.swift`
- [x] `Packages/PearInput/Sources/PearInput/InputPipeline.swift`
- [x] `Packages/PearInput/Tests/PearInputTests/PacketValidatorTests.swift`
- [x] `Packages/PearInput/Tests/PearInputTests/ClockSyncTests.swift`
- [x] `Packages/PearInput/Tests/PearInputTests/JitterBufferTests.swift`
- [x] `Packages/PearInput/Tests/PearInputTests/CalibrationTests.swift`
- [x] `Packages/PearInput/Tests/PearInputTests/SourceStrippingTests.swift`

### 1.4 PearOutput

- [x] `Packages/PearOutput/Sources/PearOutput/OutputSink.swift`

### 1.5 PearRuntime — scene runner and first trigger

- [x] `Packages/PearRuntime/Sources/PearRuntime/Components/TriggerComponent.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Components/AudioEmitterComponent.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Components/ScriptComponent.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Events/GameEvent.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Events/EventDispatcher.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Events/EventDeriver.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Systems/TriggerSystem.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Output/OutputQueue.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/SceneRunner.swift`
- [x] `Packages/PearRuntime/Tests/PearRuntimeTests/SceneRunnerTriggerTests.swift`

### 1.6 PearStudio shell

- [x] `Apps/PearStudio/PearStudio.xcodeproj/project.pbxproj`
- [x] `Apps/PearStudio/PearStudio/PearStudioApp.swift`
- [x] `Apps/PearStudio/PearStudio/AppModel.swift`
- [x] `Apps/PearStudio/PearStudio/Viewport/ViewportView.swift`

Full text: planHistory/phase-01.md

---

## Phase 2: 3D Device Simulator (compressed)

Built: derived events (look-at, gesture, heart-rate intensity, raycast hit), audio listener, `SceneDescription` / `SceneLoader`; PearSim virtual devices, noise model, recorder / player, presets, sensor rig, gizmos, gaze, `SimOutputSink`; PearScript (`prelude.js`, `SelfBridge`, `ContextBridge`, `ScriptEngine`, `ScriptReloader`, `RemoteChannel`, `ServerScriptEngine`); Studio simulator panel, `LocalTestSession`, debug overlay and capability warning.

Still open: unscheduled: mounting `SimulatorPanelView` in the window; tests for `LocalTestSession`. Provisional (needs-tien-review): presets are hand-authored (pencil preset ~62 Hz, not 240 Hz), `ScriptReloader` / `RemoteChannel` / `ContextBridge` / `SelfBridge` API shapes, `UsisPlayer` leaves validation to `InputPipeline`, `SimOutputSink` queue cap, rig slot positions. Pencil unit decision still open (see Phase 1).

### 2.1 PearRuntime — derived events

- [x] `Packages/PearRuntime/Sources/PearRuntime/Events/LookAtDetector.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Events/GestureEventMapper.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Events/HeartRateIntensity.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Events/RaycastHitDetector.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Systems/AudioListenerSystem.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Scene/SceneDescription.swift`
- [x] `Packages/PearRuntime/Sources/PearRuntime/Scene/SceneLoader.swift`
- [x] `Packages/PearRuntime/Tests/PearRuntimeTests/LookAtDetectorTests.swift`
- [x] `Packages/PearRuntime/Tests/PearRuntimeTests/HeartRateIntensityTests.swift`
- [x] `Packages/PearRuntime/Tests/PearRuntimeTests/GestureEventMapperTests.swift`
- [x] `Packages/PearRuntime/Tests/PearRuntimeTests/RaycastHitDetectorTests.swift`
- [x] `Packages/PearRuntime/Tests/PearRuntimeTests/AudioListenerSystemTests.swift`
- [x] `Packages/PearRuntime/Tests/PearRuntimeTests/SceneLoaderTests.swift`

### 2.2 PearSim — virtual devices and recording

- [x] `Packages/PearSim/Sources/PearSim/NoiseModel.swift`
- [x] `Packages/PearSim/Sources/PearSim/VirtualDevice.swift`
- [x] `Packages/PearSim/Sources/PearSim/Devices/VirtualAirPods.swift`
- [x] `Packages/PearSim/Sources/PearSim/Devices/VirtualWatch.swift`
- [x] `Packages/PearSim/Sources/PearSim/Devices/VirtualPhone.swift`
- [x] `Packages/PearSim/Sources/PearSim/Devices/VirtualPencil.swift`
- [x] `Packages/PearSim/Sources/PearSim/Recording/UsisRecorder.swift`
- [x] `Packages/PearSim/Sources/PearSim/Recording/UsisPlayer.swift`
- [x] `Packages/PearSim/Sources/PearSim/Presets/PresetLibrary.swift`
- [x] `Packages/PearSim/Sources/PearSim/Presets/airpods-head-pitch.usis.jsonl`
- [x] `Packages/PearSim/Sources/PearSim/Presets/watch-double-tap.usis.jsonl`
- [x] `Packages/PearSim/Sources/PearSim/Presets/watch-flick.usis.jsonl`
- [x] `Packages/PearSim/Sources/PearSim/Presets/pencil-barrel-roll.usis.jsonl`
- [x] `Packages/PearSim/Sources/PearSim/Rig/SensorRigScene.swift`
- [x] `Packages/PearSim/Sources/PearSim/Rig/GizmoController.swift`
- [x] `Packages/PearSim/Sources/PearSim/Rig/GazeRaycaster.swift`
- [x] `Packages/PearSim/Sources/PearSim/Feedback/SimOutputSink.swift`
- [x] `Packages/PearSim/Tests/PearSimTests/UsisRecorderPlayerTests.swift`
- [x] `Packages/PearSim/Tests/PearSimTests/NoiseModelTests.swift`
- [x] `Packages/PearSim/Tests/PearSimTests/SimPipelineTests.swift`

### 2.3 PearScript — creator scripting API

- [x] `Packages/PearScript/Sources/PearScript/Resources/prelude.js`
- [x] `Packages/PearScript/Sources/PearScript/SelfBridge.swift`
- [x] `Packages/PearScript/Sources/PearScript/ContextBridge.swift`
- [x] `Packages/PearScript/Sources/PearScript/ScriptEngine.swift`
- [x] `Packages/PearScript/Sources/PearScript/ScriptReloader.swift`
- [x] `Packages/PearScript/Sources/PearScript/RemoteChannel.swift`
- [x] `Packages/PearScript/Sources/PearScript/ServerScriptEngine.swift`
- [x] `Packages/PearScript/Tests/PearScriptTests/ScriptEngineTests.swift`
- [x] `Packages/PearScript/Tests/PearScriptTests/ServerScriptEngineTests.swift`

### 2.4 PearStudio — simulator UI

- [x] `Apps/PearStudio/PearStudio/Sim/SimulatorPanelView.swift`
- [x] `Apps/PearStudio/PearStudio/Test/LocalTestSession.swift`
- [x] `Apps/PearStudio/PearStudio/Debug/DebugOverlayView.swift`
- [x] `Apps/PearStudio/PearStudio/Debug/CapabilityWarningView.swift`

Full text: planHistory/phase-02.md

---

## Phase 3: Live Hardware Bridge (compressed)

Built: wire protocol in PearCore; PearBridge (Bonjour listener, device sessions, bridge source/sink, AirPods source); iOS + watchOS PearCompanion apps; Studio ModeController Sim / Live toggle, device status, calibration.

Still open: FLAGGED, not decided: stale-sample discard / UDP for motion over Wi-Fi; AirPods give no `position`. Provisional (needs-tien-review): clock-sample mapping, per-kind descriptor defaults, watch gesture thresholds.

- [x] `Packages/PearCore/Sources/PearCore/Wire/WireMessage.swift`
- [x] `Packages/PearCore/Sources/PearCore/Wire/LineFraming.swift`
- [x] `Packages/PearCore/Tests/PearCoreTests/LineFramingTests.swift`
- [x] `Packages/PearBridge/Sources/PearBridge/BonjourListener.swift`
- [x] `Packages/PearBridge/Sources/PearBridge/DeviceSession.swift`
- [x] `Packages/PearBridge/Sources/PearBridge/BridgeInputSource.swift`
- [x] `Packages/PearBridge/Sources/PearBridge/BridgeOutputSink.swift`
- [x] `Packages/PearBridge/Sources/PearBridge/AirPodsMotionSource.swift`
- [x] `Packages/PearBridge/Tests/PearBridgeTests/DeviceSessionTests.swift`
- [x] `Apps/PearCompanion/PearCompanion.xcodeproj/project.pbxproj`
- [x] `Apps/PearCompanion/Shared/BridgeClient.swift`
- [x] `Apps/PearCompanion/iOS/PearCompanionApp.swift`
- [x] `Apps/PearCompanion/iOS/MotionStreamer.swift`
- [x] `Apps/PearCompanion/iOS/TouchCapture.swift`
- [x] `Apps/PearCompanion/iOS/HapticPlayer.swift`
- [x] `Apps/PearCompanion/watchOS/WatchApp.swift`
- [x] `Apps/PearCompanion/watchOS/HeartRateWorkout.swift`
- [x] `Apps/PearCompanion/watchOS/WristGestureDetector.swift`
- [x] `Apps/PearCompanion/watchOS/WatchRelay.swift`
- [x] `Apps/PearCompanion/iOS/WatchConnectivityReceiver.swift`
- [x] `Apps/PearStudio/PearStudio/Mode/ModeController.swift`
- [x] `Apps/PearStudio/PearStudio/Mode/ModeToggleView.swift`
- [x] `Apps/PearStudio/PearStudio/Devices/DeviceStatusView.swift`
- [x] `Apps/PearStudio/PearStudio/Devices/CalibrationControls.swift`

Full text: planHistory/phase-03.md

---

## Phase 4: Flagship Game (compressed)

Built: Games/Flagship (scene + 3 scripts, published as "Hollow Choir"); Studio script editor, inspector, GameLoader; PearCloud client; Rust backend (axum, sqlx, rquickjs game server, in-memory dev sign-in) with tests.

Still open: sound design / visuals polish and a stranger playtest (not file-bound); editor and inspector views not mounted in the window; sign-in method decided in Phase 9 (Sign in with Apple). Provisional (needs-tien-review): API names in flagship scripts, JS engine rquickjs, JSONB file storage.

- [x] `Games/Flagship/scene.json`
- [x] `Games/Flagship/scripts/enemy.js`
- [x] `Games/Flagship/scripts/player.js`
- [x] `Games/Flagship/scripts/game.js`
- [x] `Apps/PearStudio/PearStudio/Scripting/ScriptEditorView.swift`
- [x] `Apps/PearStudio/PearStudio/Inspector/InspectorView.swift`
- [x] `Apps/PearStudio/PearStudio/Game/GameLoader.swift`
- [x] `Packages/PearCloud/Package.swift`
- [x] `Packages/PearCloud/Sources/PearCloud/CloudClient.swift`
- [x] `Packages/PearCloud/Tests/PearCloudTests/CloudClientTests.swift`
- [x] `Apps/PearStudio/PearStudio/Account/SignInView.swift`
- [x] `Apps/PearStudio/PearStudio/Publish/PublishView.swift`
- [x] `Backend/Cargo.toml`
- [x] `Backend/migrations/0001_init.sql`
- [x] `Backend/src/main.rs`
- [x] `Backend/src/db.rs`
- [x] `Backend/src/api/accounts.rs`
- [x] `Backend/src/api/games.rs`
- [x] `Backend/src/game_server/session.rs`
- [x] `Backend/src/game_server/script_host.rs`
- [x] `Backend/tests/api.rs`
- [x] `Backend/tests/script_host.rs`

Full text: planHistory/phase-04.md

---

## Phase 5: Demo Hardening (compressed)

Built: simulated fallback recording and one-switch DemoMode replay.

Still open: local hotspot, pre-paired devices, recorded fallback video, five clean demo runs (not file-bound). Recording is hand-written, replace with a real capture.

- [x] `Recordings/demo-fallback.usis.jsonl`
- [x] `Apps/PearStudio/PearStudio/Mode/DemoMode.swift`

Full text: planHistory/phase-05.md

---

## Phase 8: Pear Web Studio & Live Hosting (compressed)

Built: backend live integration (CORS, static Studio, /debug, memstore, migrations); Web SDK packages (pear-core / runtime / script / sim / cloud); Web Studio app (dockview layout, editor, explorer, inspector, run, debug panel, account); Tauri 2 desktop shell + release workflow; Vultr deploy files; blank template and demo script.

Still open: demo run on the Vultr box from the desktop executable; two people in one server session; brand-kit UI review; Vite watch ignore for src-tauri; macOS desktop untested. Web Studio is now acknowledged in overview.md (no longer a mismatch).

- [x] `Backend/Cargo.toml`
- [x] `Backend/src/main.rs`
- [x] `Backend/src/lib.rs`
- [x] `Backend/src/api/accounts.rs`
- [x] `Backend/src/game_server/session.rs`
- [x] `Backend/src/game_server/script_host.rs`
- [x] `Backend/src/game_server/debug.rs`
- [x] `Backend/src/memstore.rs`
- [x] `Backend/tests/live.rs`
- [x] `Web/package.json`
- [x] `Web/tsconfig.base.json`
- [x] `Web/packages/pear-core/src/usis.ts`
- [x] `Web/packages/pear-core/test/usis.test.ts`
- [x] `Web/packages/pear-runtime/src/scene.ts`
- [x] `Web/packages/pear-runtime/src/input.ts`
- [x] `Web/packages/pear-runtime/src/events.ts`
- [x] `Web/packages/pear-runtime/src/viewport.ts`
- [x] `Web/packages/pear-runtime/test/runtime.test.ts`
- [x] `Web/packages/pear-script/src/sandbox.ts`
- [x] `Web/packages/pear-script/test/sandbox.test.ts`
- [x] `Web/packages/pear-sim/src/devices.ts`
- [x] `Web/packages/pear-sim/src/playback.ts`
- [x] `Web/packages/pear-cloud/src/client.ts`
- [x] `Web/packages/pear-cloud/test/client.test.ts`
- [x] `Web/studio/index.html`
- [x] `Web/studio/src/layout.ts`
- [x] `Web/studio/src/preferences.ts`
- [x] `Web/studio/src/theme.css`
- [x] `Web/studio/src/project.ts`
- [x] `Web/studio/src/editor.ts`
- [x] `Web/studio/src/explorer.ts`
- [x] `Web/studio/src/inspector.ts`
- [x] `Web/studio/src/run.ts`
- [x] `Web/studio/src/debug-panel.ts`
- [x] `Web/studio/src/account.ts`
- [x] `Web/studio/src/main.ts`
- [x] `Web/studio/test/e2e.test.ts`
- [x] `Web/studio/src-tauri/Cargo.toml`
- [x] `Web/studio/src-tauri/tauri.conf.json`
- [x] `Web/studio/src-tauri/src/main.rs`
- [x] `.github/workflows/studio-release.yml`
- [x] `Deploy/download.html`
- [x] `Deploy/Dockerfile`
- [x] `Deploy/docker-compose.yml`
- [x] `Deploy/Caddyfile`
- [x] `Deploy/vultr-bootstrap.sh`
- [x] `Deploy/dev.sh`
- [x] `Web/studio/src/templates/blank.ts`
- [x] `Deploy/demo.sh`

Full text: planHistory/phase-08.md

---

## Phase 9: Player App (compressed)

Built: backend catalog + Sign in with Apple; PearCloud catalog / Apple client; PearLibrary (device profile, playability, session store, library model, stub launcher); PearPlayer iOS + macOS app with sign-in, library, detail and theme.

Still open: Apple Developer team, bundle id, entitlement; running games on the player (needs iOS on PearInput / PearRuntime / PearScript / PearOutput). Player UI never seen rendered. Player apps are now in overview.md scope.

- [x] `Backend/Cargo.toml`
- [x] `Backend/src/db.rs`
- [x] `Backend/src/memstore.rs`
- [x] `Backend/src/api/library.rs`
- [x] `Backend/src/api/apple.rs`
- [x] `Backend/src/api/mod.rs`
- [x] `Backend/src/lib.rs`
- [x] `Backend/tests/library.rs`
- [x] `Backend/tests/apple.rs`
- [x] `Packages/PearCloud/Package.swift`
- [x] `Packages/PearCloud/Sources/PearCloud/CloudClient.swift`
- [x] `Packages/PearCloud/Tests/PearCloudTests/LibraryAPITests.swift`
- [x] `Packages/PearLibrary/Package.swift`
- [x] `Packages/PearLibrary/Sources/PearLibrary/DeviceProfile.swift`
- [x] `Packages/PearLibrary/Sources/PearLibrary/Playability.swift`
- [x] `Packages/PearLibrary/Sources/PearLibrary/SessionStore.swift`
- [x] `Packages/PearLibrary/Sources/PearLibrary/LibraryModel.swift`
- [x] `Packages/PearLibrary/Sources/PearLibrary/GameLauncher.swift`
- [x] `Packages/PearLibrary/Tests/PearLibraryTests/DeviceProfileTests.swift`
- [x] `Packages/PearLibrary/Tests/PearLibraryTests/PlayabilityTests.swift`
- [x] `Packages/PearLibrary/Tests/PearLibraryTests/LibraryModelTests.swift`
- [x] `Pear.xcworkspace/contents.xcworkspacedata`
- [x] `Apps/PearPlayer/PearPlayer.xcodeproj/project.pbxproj`
- [x] `Apps/PearPlayer/PearPlayer.entitlements`
- [x] `Apps/PearPlayer/PearPlayer/PearPlayerApp.swift`
- [x] `Packages/PearCloud/Sources/PearCloud/CloudClient.swift`
- [x] `Apps/PearPlayer/PearPlayer/PlayerModel.swift`
- [x] `Apps/PearPlayer/PearPlayer/Account/AppleSignInView.swift`
- [x] `Apps/PearPlayer/PearPlayer/Library/LibraryView.swift`
- [x] `Apps/PearPlayer/PearPlayer/Library/GameDetailView.swift`
- [x] `Apps/PearPlayer/PearPlayer/Theme/PearTheme.swift`
- [x] `Apps/PearPlayer/PearPlayer/Theme/PearGizmoMark.swift`

Full text: planHistory/phase-09.md

---

## Phase 10: Marketplace / plugins cloud follow-ups (compressed)

Built: 10.1 to 10.7 (hosted registry, S3 bundles with signatures, authenticated publish, install telemetry, per-account sync, hosted agent runtime, per-account model keys) and the 10.9 fixes.

Still open: Vultr redeploy and bucket (human); live model run for OpenAI and Google (Anthropic passed); Google default model id unverified. Plugin system is now in overview.md.

- [x] Ship `uv.lock` in bundles
- [x] Seed-time plugin id rule `^[a-z0-9-]{1,64}$` in `read_plugin`; skip and log bad ids.
- [x] `src-tauri/src/plugins.rs`
- [x] `Web/studio/src/marketplace/installer.ts`
- [x] Runtime
- [x] Non-Windows `stop_runtime` kills only the direct child; use process groups so `uv` leaves no orphaned python.
- [x] Postgres paths
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

## Phase 12: Instructions and agent players

Not in overview.md; added at user request 2026-11-14 (overview.md stays unchanged until the user asks). Games are played in the real world, so a game carries written instructions (setup, roles, phases) and Studio can playtest them with simulated players driven by LangChain Deep Agents. Order is 12.1 to 12.5; local Play only (no server or join agent runners). Decisions: the instructions win over `scene.json` (lint flags the scene as out of sync); the simulation pauses while any agent is deciding; an agent sees only what a person would perceive; agents test the instructions and do not replace real players. Cloud saves keep the instructions in the version's `metadata.instructions` (no backend change). The Deep Agents plugin still runs in Studio only, never inside a running game (overview.md unchanged on that).

### 12.1 Instructions data

- [x] `Web/packages/pear-runtime/src/instructions.ts` — `Instructions` type (title, summary, players {min,max}, space, setup[], roles[{id,name,brief,kind}], devices {kind: own/free/passed}, phases[{id,title,text,steps[{role,do}]}], win), lenient `parseInstructions`, and `lintInstructions(instructions, scene)` warnings: player count vs `inputs.players`, gestures vs `inputs.gestures`, devices vs `ownership`, step role undeclared, phase without steps; the scene is the side flagged out of sync. Role `kind` is `player` or `ref` and sets `ctx.player.role`.
- [x] `Web/packages/pear-runtime/src/index.ts` — export instructions.
- [x] `Web/packages/pear-runtime/test/instructions.test.ts` — parse, bad input dropped not thrown, each lint code.
- [x] `Web/studio/src/project.ts` — `ProjectSnapshot.instructions?` (optional); `snapshot`, `load` and `setInstructions` (one undo step); `toVersion` writes `metadata.instructions`, `snapshotOfVersion` reads it; a pending proposal with accept and reject.
- [x] `Web/studio/src/projectFile.ts` — serialize and parse the optional `instructions` (validated by `parseInstructions`); `FILE_VERSION` unchanged, files without it still open.
- [x] `Web/studio/test/menu-save.test.ts` — round trip with instructions; an old file without the field; bad instructions refused with a sentence.
- [x] `Web/studio/test/instructions.test.ts` — project cases: `setInstructions` undo, snapshot and cloud metadata round trip, proposal accept, reject and load.

### 12.2 Plugin (Plugins/langchain-deepagents)

- [x] `Plugins/langchain-deepagents/runtime/translate.py` — forward `/instructions.json` writes and a successful `submit_instructions` as `file_written` (today only `/scripts/**` and `/scene.json` pass).
- [x] `Plugins/langchain-deepagents/tests/test_translate.py` — instructions.json forwarded; other paths still dropped.
- [x] `Plugins/langchain-deepagents/runtime/instructions.py` — prompts and schema check; modes `author` (plain text to instructions) and `revise` (current instructions plus a chat message to a full proposal). Prompts live in code, no new .md.
- [x] `Plugins/langchain-deepagents/runtime/players.py` — a deep agent per (run, player) thread; personas (follows rules, skims, cheats, confused); `decide` (instructions, role, persona, observation) returns actions plus `unsure` notes; `report`; filesystem tools denied (or a plain structured-output call if the deny form is unavailable).
- [x] `Plugins/langchain-deepagents/runtime/server.py` — `prepare_project` also writes `instructions.json`; `prompt` with `mode: 'instructions'`; `decide` to `plan` and `report` outside `PROJECT_LOCKS`; every reply keeps the id; per-run call cap on the server side.
- [x] `Plugins/langchain-deepagents/tests/test_instructions.py` — scripted model: author, revise, invalid output rejected.
- [x] `Plugins/langchain-deepagents/tests/test_players.py` — scripted model: valid actions, memory per player thread, persona applied, invalid action dropped, no file access.
- [x] `Plugins/langchain-deepagents/pear-plugin.json` — version 0.7.42 (a seed at the same version fails; `pyproject.toml` and `uv.lock` kept equal); permission `filesystem:project_instructions`.
- [x] `Web/studio/src/panels/deep-agent.ts` — send `instructions` in the project; mode selector (Scripts / Instructions); a `file_written` of `instructions.json` becomes a pending proposal, never applied directly, with Accept and Reject buttons until the 12.5 diff; an instructions run applies no script or scene write.
- [x] `Web/studio/test/deep-agent.test.ts` — proposal not applied until accepted; scripts and `scene.json` unchanged.

### 12.3 Agent players

- [x] `Web/packages/pear-runtime/src/observation.ts` — pure `buildObservation` from an `AvatarView` plus a cue list: own haptics, audio and speech cues heard, notes on actions that failed, devices in hand, game time, other players inside 8 m and in front (distance, bearing, gaze); no scene or server state, no phase (nothing in a run knows it). `Action` union (walk_to, look_at, gesture, give_device, say, wait) and `parseActions` (valid only, max 5, coordinates clamped to the arena, wait 0.5 to 10 s).
- [x] `Web/packages/pear-runtime/src/index.ts` — export observation (second change to this file).
- [x] `Web/packages/pear-runtime/test/observation.test.ts` — visible vs hidden, behind and out of range, bearing sign, invalid actions, clamps, and agreement with `players.py` (action names, gestures, limits).
- [x] `Web/studio/src/pauseClock.ts` — pure pausable clock: `now`, `epoch`, `setTimer`, `clearTimer`, `hold`, `release`, `reset`; time and timers stand still while held, holds nest.
- [x] `Web/studio/test/pauseClock.test.ts` — now frozen while held, timers fire after release with the remaining time, clear works, reset.
- [x] `Web/studio/src/run.ts` — `RunController.hold()`, `release()` and `held` (the pause clock goes into LocalRun, SimDevices and `createPlayServer`; wander and walk skip while held); per-player `agent` driver (instead of a `control` field: idle already means standing still); per-player cue log (speak, audio, haptic, notes); `observationFor(id)`; `setAgent` with error sentences; the agent's actions applied through the run. Local Play only. (`timeScale` alone cannot pause: it only scales `dt` in `LocalRun.step` and `walk`; agent pacing is on the unscaled pause clock.)
- [x] `Web/studio/src/agentTransport.ts` — socket to the Deep Agent runtime for `decide` and `report` (lazy, matched by id, timeouts, no auto-reconnect, URL read at each open).
- [x] `Web/studio/src/agentPlayers.ts` — a driver per agent player: decide every 1.5 s of game time; one action per tick (walk waits for arrival, wait counts clock seconds); `hold()` while a request is in flight; 20 s transport timeout and a 10 s backoff after an error; call cap per player (default 60); calls counter (no tokens are reported) and `unsure` notes kept for 12.4. The `report` call at the end of a run belongs to 12.4.
- [x] `Web/studio/src/marketplace/controller.ts` — `runtimeUrlOf(id)`: the runtime URLs of an installed plugin.
- [x] `Web/studio/src/main.ts` — `agentUrl` for the run controller.
- [x] `Web/studio/src/testPanel.ts` — per-player Agent toggle, persona select, instructions role select, status and calls line (Thinking, Acting, Waiting); hidden for the driven player and outside local Play; `structureKey` includes the seat.
- [x] `Web/studio/test/agentPlayers.test.ts` — fake transport and clock: held while thinking and released after (also on error), two agents, plan order, walk wait, backoff, cap, dispose mid-flight, invalid actions; pause in `LocalRun` and the in-page server.
- [x] `Web/studio/test/agentTransport.test.ts` — id matching, errors, close, timeout, reopen, URL per open.
- [x] `Web/studio/test/agentRun.test.ts` — `RunController` with stub deps: observation holds no hidden state, actions, `setAgent` sentences, hold and release.

### 12.4 Playtest report

- [ ] `Web/studio/src/playtestReport.ts` — pure: collect `unsure` notes (phase, line, why) and the run outcome into a report; prefill text for a revise prompt.
- [ ] `Web/studio/src/playtestView.ts` — renders the report; "Send to chat" button.
- [ ] `Web/studio/test/playtestReport.test.ts` — grouping, empty run, prefill text.

### 12.5 Panel

- [ ] `Web/studio/src/instructionsPanel.ts` — edit fields, lint list, proposal diff with Accept and Reject, playtest report; direct edits stay the creator's.
- [ ] `Web/studio/src/main.ts` — register the panel and its menu entry.
- [ ] `Web/studio/test/instructions.test.ts` — panel cases added to the existing file: lint shown, proposal diff accept and reject, report shown.

Not planned: server or join agent runners; a how-to-play screen in the Player app; published games carrying instructions beyond `metadata` (Phase 11 backend items).

---

## Cross-Cutting: Hardware verification (compressed)

Built: AirPods, iPhone / iPad / Pencil probes and host in Tools/ with measured results.

Still open: AirPods Pro, venue Wi-Fi and hotspot untested; Pencil units FLAGGED (see Phase 1).

- [x] `Tools/AirPodsProbe/Package.swift`
- [x] `Tools/AirPodsProbe/Info.plist`
- [x] `Tools/AirPodsProbe/Sources/AirPodsProbe/main.swift`
- [x] `Tools/PhoneProbe.swiftpm/Package.swift`
- [x] `Tools/PhoneProbe.swiftpm/Sources/PhoneProbe/PhoneProbeApp.swift`
- [x] `Tools/PhoneProbeHost/Package.swift`
- [x] `Tools/PhoneProbeHost/Sources/PhoneProbeHost/main.swift`
- [x] `Tools/AirPodsProbe/bundle.sh`

Full text: planHistory/cross-hardware.md

---

## Phase 7: After the Hackathon (compressed, no checklist)

Built: nothing; this phase has no checklist.

Still open: Lua scripting backend; third-party Bluetooth adapters via `PearAdapters`; iPad / Pencil and Vision Pro input; player apps on iOS / visionOS that connect players to the game server through a `RemoteChannel` (the library shell is Phase 9; running games on the player is open); relay server for remote collaboration; automatic state replication; permissions, version history and moderation for hosted games.

Full text: planHistory/phase-07.md
