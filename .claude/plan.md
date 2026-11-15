# Build Plan

Product name is Pear; code keeps the Omni prefix. Phases 1-5, 8-10 and Cross-Cutting are compressed (full text in planHistory/, read via grep). Only Phase 6 (stretch) and 7 are open here.

- Checklist, worked top-to-bottom. Each item is exactly one file with a single responsibility — `stage`/`apply` should be able to touch one checklist item without needing to also change any other file. Phases are ordered by dependency (later phases consume earlier ones).
- Paths are relative to the repo root. Packages use SwiftPM layout: `Packages/<Pkg>/Package.swift`, `Sources/<Pkg>/`, `Tests/<Pkg>Tests/`. Dependency rules come from the package table in `overview.md`; any item that bends them carries a parenthetical note.
- Format: `- [ ] \`path\` — responsibility`.

---

## Phase 1: Workspace Scaffold & Core Runtime (compressed)

Built: every package exists with its dependency boundary enforced in each `Package.swift`; USIS v1 schema and Codable types; `InputSource` / `InputBus` / `OutputSink`; `OmniInput` pipeline (validation, clock sync, jitter buffer, calibration, capability tiers, stats); RealityKit `SceneRunner` with triggers and the Phase 1 exit test (hard-coded packet fires a trigger); Studio shell with viewport.

Still open: FLAGGED, not decided: `pencil` channel units (iPad gives a 2D normalized tip and normalized hover, no tilt field; `roll` / `hover` required in the schema but absent on some Pencils). Unscheduled: playback path for `AudioEmitterComponent` / `self.audio.play`. Provisional (needs-tien-review): hand-written `OmniStudio.xcodeproj` (regenerate in Xcode before adding targets); `AppModel` placeholder `RecordingOutputSink`; overview.md update for `triggerEntered` / `triggerExited` events pending on user request.

### 1.1 Workspace & package scaffold

- [x] `Omni.xcworkspace/contents.xcworkspacedata`
- [x] `Packages/OmniCore/Package.swift`
- [x] `Packages/OmniInput/Package.swift`
- [x] `Packages/OmniOutput/Package.swift`
- [x] `Packages/OmniRuntime/Package.swift`
- [x] `Packages/OmniScript/Package.swift`
- [x] `Packages/OmniScript/Sources/OmniScript/Module.swift`
- [x] `Packages/OmniSim/Package.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/Module.swift`
- [x] `Packages/OmniBridge/Package.swift`
- [x] `Packages/OmniBridge/Sources/OmniBridge/Module.swift`
- [x] `Packages/OmniCollab/Package.swift`
- [x] `Packages/OmniCollab/Sources/OmniCollab/Module.swift`
- [x] `Packages/OmniAdapters/Package.swift`
- [x] `Packages/OmniAdapters/Sources/OmniAdapters/Module.swift`
- [x] `.gitignore`

### 1.2 OmniCore — math and USIS types (pure, no I/O)

- [x] `Schema/usis.schema.json`
- [x] `Packages/OmniCore/Sources/OmniCore/Math/Vector3.swift`
- [x] `Packages/OmniCore/Sources/OmniCore/Math/Quaternion.swift`
- [x] `Packages/OmniCore/Sources/OmniCore/Math/Pose.swift`
- [x] `Packages/OmniCore/Sources/OmniCore/USIS/UsisEnums.swift`
- [x] `Packages/OmniCore/Sources/OmniCore/USIS/UsisChannels.swift`
- [x] `Packages/OmniCore/Sources/OmniCore/USIS/UsisPacket.swift`
- [x] `Packages/OmniCore/Sources/OmniCore/Frame/InputFrame.swift`
- [x] `Packages/OmniCore/Sources/OmniCore/Output/OutputCommand.swift`
- [x] `Packages/OmniCore/Tests/OmniCoreTests/QuaternionTests.swift`
- [x] `Packages/OmniCore/Tests/OmniCoreTests/UsisPacketTests.swift`

### 1.3 OmniInput — protocols, validation, pipeline

- [x] `Packages/OmniInput/Sources/OmniInput/InputSource.swift`
- [x] `Packages/OmniInput/Sources/OmniInput/InputBus.swift`
- [x] `Packages/OmniInput/Sources/OmniInput/PacketValidator.swift`
- [x] `Packages/OmniInput/Sources/OmniInput/ClockSync.swift`
- [x] `Packages/OmniInput/Sources/OmniInput/JitterBuffer.swift`
- [x] `Packages/OmniInput/Sources/OmniInput/Calibration.swift`
- [x] `Packages/OmniInput/Sources/OmniInput/CapabilityTier.swift`
- [x] `Packages/OmniInput/Sources/OmniInput/DeviceStats.swift`
- [x] `Packages/OmniInput/Sources/OmniInput/InputPipeline.swift`
- [x] `Packages/OmniInput/Tests/OmniInputTests/PacketValidatorTests.swift`
- [x] `Packages/OmniInput/Tests/OmniInputTests/ClockSyncTests.swift`
- [x] `Packages/OmniInput/Tests/OmniInputTests/JitterBufferTests.swift`
- [x] `Packages/OmniInput/Tests/OmniInputTests/CalibrationTests.swift`
- [x] `Packages/OmniInput/Tests/OmniInputTests/SourceStrippingTests.swift`

### 1.4 OmniOutput

- [x] `Packages/OmniOutput/Sources/OmniOutput/OutputSink.swift`

### 1.5 OmniRuntime — scene runner and first trigger

- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Components/TriggerComponent.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Components/AudioEmitterComponent.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Components/ScriptComponent.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Events/GameEvent.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Events/EventDispatcher.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Events/EventDeriver.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Systems/TriggerSystem.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Output/OutputQueue.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/SceneRunner.swift`
- [x] `Packages/OmniRuntime/Tests/OmniRuntimeTests/SceneRunnerTriggerTests.swift`

### 1.6 OmniStudio shell

- [x] `Apps/OmniStudio/OmniStudio.xcodeproj/project.pbxproj`
- [x] `Apps/OmniStudio/OmniStudio/OmniStudioApp.swift`
- [x] `Apps/OmniStudio/OmniStudio/AppModel.swift`
- [x] `Apps/OmniStudio/OmniStudio/Viewport/ViewportView.swift`

Full text: planHistory/phase-01.md

---

## Phase 2: 3D Device Simulator (compressed)

Built: derived events (look-at, gesture, heart-rate intensity, raycast hit), audio listener, `SceneDescription` / `SceneLoader`; OmniSim virtual devices, noise model, recorder / player, presets, sensor rig, gizmos, gaze, `SimOutputSink`; OmniScript (`prelude.js`, `SelfBridge`, `ContextBridge`, `ScriptEngine`, `ScriptReloader`, `RemoteChannel`, `ServerScriptEngine`); Studio simulator panel, `LocalTestSession`, debug overlay and capability warning.

Still open: unscheduled: mounting `SimulatorPanelView` in the window; tests for `LocalTestSession`. Provisional (needs-tien-review): presets are hand-authored (pencil preset ~62 Hz, not 240 Hz), `ScriptReloader` / `RemoteChannel` / `ContextBridge` / `SelfBridge` API shapes, `UsisPlayer` leaves validation to `InputPipeline`, `SimOutputSink` queue cap, rig slot positions. Pencil unit decision still open (see Phase 1).

### 2.1 OmniRuntime — derived events

- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Events/LookAtDetector.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Events/GestureEventMapper.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Events/HeartRateIntensity.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Events/RaycastHitDetector.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Systems/AudioListenerSystem.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Scene/SceneDescription.swift`
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Scene/SceneLoader.swift`
- [x] `Packages/OmniRuntime/Tests/OmniRuntimeTests/LookAtDetectorTests.swift`
- [x] `Packages/OmniRuntime/Tests/OmniRuntimeTests/HeartRateIntensityTests.swift`
- [x] `Packages/OmniRuntime/Tests/OmniRuntimeTests/GestureEventMapperTests.swift`
- [x] `Packages/OmniRuntime/Tests/OmniRuntimeTests/RaycastHitDetectorTests.swift`
- [x] `Packages/OmniRuntime/Tests/OmniRuntimeTests/AudioListenerSystemTests.swift`
- [x] `Packages/OmniRuntime/Tests/OmniRuntimeTests/SceneLoaderTests.swift`

### 2.2 OmniSim — virtual devices and recording

- [x] `Packages/OmniSim/Sources/OmniSim/NoiseModel.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/VirtualDevice.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/Devices/VirtualAirPods.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/Devices/VirtualWatch.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/Devices/VirtualPhone.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/Devices/VirtualPencil.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/Recording/UsisRecorder.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/Recording/UsisPlayer.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/Presets/PresetLibrary.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/Presets/airpods-head-pitch.usis.jsonl`
- [x] `Packages/OmniSim/Sources/OmniSim/Presets/watch-double-tap.usis.jsonl`
- [x] `Packages/OmniSim/Sources/OmniSim/Presets/watch-flick.usis.jsonl`
- [x] `Packages/OmniSim/Sources/OmniSim/Presets/pencil-barrel-roll.usis.jsonl`
- [x] `Packages/OmniSim/Sources/OmniSim/Rig/SensorRigScene.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/Rig/GizmoController.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/Rig/GazeRaycaster.swift`
- [x] `Packages/OmniSim/Sources/OmniSim/Feedback/SimOutputSink.swift`
- [x] `Packages/OmniSim/Tests/OmniSimTests/UsisRecorderPlayerTests.swift`
- [x] `Packages/OmniSim/Tests/OmniSimTests/NoiseModelTests.swift`
- [x] `Packages/OmniSim/Tests/OmniSimTests/SimPipelineTests.swift`

### 2.3 OmniScript — creator scripting API

- [x] `Packages/OmniScript/Sources/OmniScript/Resources/prelude.js`
- [x] `Packages/OmniScript/Sources/OmniScript/SelfBridge.swift`
- [x] `Packages/OmniScript/Sources/OmniScript/ContextBridge.swift`
- [x] `Packages/OmniScript/Sources/OmniScript/ScriptEngine.swift`
- [x] `Packages/OmniScript/Sources/OmniScript/ScriptReloader.swift`
- [x] `Packages/OmniScript/Sources/OmniScript/RemoteChannel.swift`
- [x] `Packages/OmniScript/Sources/OmniScript/ServerScriptEngine.swift`
- [x] `Packages/OmniScript/Tests/OmniScriptTests/ScriptEngineTests.swift`
- [x] `Packages/OmniScript/Tests/OmniScriptTests/ServerScriptEngineTests.swift`

### 2.4 OmniStudio — simulator UI

- [x] `Apps/OmniStudio/OmniStudio/Sim/SimulatorPanelView.swift`
- [x] `Apps/OmniStudio/OmniStudio/Test/LocalTestSession.swift`
- [x] `Apps/OmniStudio/OmniStudio/Debug/DebugOverlayView.swift`
- [x] `Apps/OmniStudio/OmniStudio/Debug/CapabilityWarningView.swift`

Full text: planHistory/phase-02.md

---

## Phase 3: Live Hardware Bridge (compressed)

Built: wire protocol in OmniCore; OmniBridge (Bonjour listener, device sessions, bridge source/sink, AirPods source); iOS + watchOS OmniCompanion apps; Studio ModeController Sim / Live toggle, device status, calibration.

Still open: FLAGGED, not decided: stale-sample discard / UDP for motion over Wi-Fi; AirPods give no `position`. Provisional (needs-tien-review): clock-sample mapping, per-kind descriptor defaults, watch gesture thresholds.

- [x] `Packages/OmniCore/Sources/OmniCore/Wire/WireMessage.swift`
- [x] `Packages/OmniCore/Sources/OmniCore/Wire/LineFraming.swift`
- [x] `Packages/OmniCore/Tests/OmniCoreTests/LineFramingTests.swift`
- [x] `Packages/OmniBridge/Sources/OmniBridge/BonjourListener.swift`
- [x] `Packages/OmniBridge/Sources/OmniBridge/DeviceSession.swift`
- [x] `Packages/OmniBridge/Sources/OmniBridge/BridgeInputSource.swift`
- [x] `Packages/OmniBridge/Sources/OmniBridge/BridgeOutputSink.swift`
- [x] `Packages/OmniBridge/Sources/OmniBridge/AirPodsMotionSource.swift`
- [x] `Packages/OmniBridge/Tests/OmniBridgeTests/DeviceSessionTests.swift`
- [x] `Apps/OmniCompanion/OmniCompanion.xcodeproj/project.pbxproj`
- [x] `Apps/OmniCompanion/Shared/BridgeClient.swift`
- [x] `Apps/OmniCompanion/iOS/OmniCompanionApp.swift`
- [x] `Apps/OmniCompanion/iOS/MotionStreamer.swift`
- [x] `Apps/OmniCompanion/iOS/TouchCapture.swift`
- [x] `Apps/OmniCompanion/iOS/HapticPlayer.swift`
- [x] `Apps/OmniCompanion/watchOS/WatchApp.swift`
- [x] `Apps/OmniCompanion/watchOS/HeartRateWorkout.swift`
- [x] `Apps/OmniCompanion/watchOS/WristGestureDetector.swift`
- [x] `Apps/OmniCompanion/watchOS/WatchRelay.swift`
- [x] `Apps/OmniCompanion/iOS/WatchConnectivityReceiver.swift`
- [x] `Apps/OmniStudio/OmniStudio/Mode/ModeController.swift`
- [x] `Apps/OmniStudio/OmniStudio/Mode/ModeToggleView.swift`
- [x] `Apps/OmniStudio/OmniStudio/Devices/DeviceStatusView.swift`
- [x] `Apps/OmniStudio/OmniStudio/Devices/CalibrationControls.swift`

Full text: planHistory/phase-03.md

---

## Phase 4: Flagship Game (compressed)

Built: Games/Flagship (scene + 3 scripts, published as "Hollow Choir"); Studio script editor, inspector, GameLoader; OmniCloud client; Rust backend (axum, sqlx, rquickjs game server, in-memory dev sign-in) with tests.

Still open: sound design / visuals polish and a stranger playtest (not file-bound); editor and inspector views not mounted in the window; sign-in method decided in Phase 9 (Sign in with Apple). Provisional (needs-tien-review): API names in flagship scripts, JS engine rquickjs, JSONB file storage.

- [x] `Games/Flagship/scene.json`
- [x] `Games/Flagship/scripts/enemy.js`
- [x] `Games/Flagship/scripts/player.js`
- [x] `Games/Flagship/scripts/game.js`
- [x] `Apps/OmniStudio/OmniStudio/Scripting/ScriptEditorView.swift`
- [x] `Apps/OmniStudio/OmniStudio/Inspector/InspectorView.swift`
- [x] `Apps/OmniStudio/OmniStudio/Game/GameLoader.swift`
- [x] `Packages/OmniCloud/Package.swift`
- [x] `Packages/OmniCloud/Sources/OmniCloud/CloudClient.swift`
- [x] `Packages/OmniCloud/Tests/OmniCloudTests/CloudClientTests.swift`
- [x] `Apps/OmniStudio/OmniStudio/Account/SignInView.swift`
- [x] `Apps/OmniStudio/OmniStudio/Publish/PublishView.swift`
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
- [x] `Apps/OmniStudio/OmniStudio/Mode/DemoMode.swift`

Full text: planHistory/phase-05.md

---

## Phase 8: Pear Web Studio & Live Hosting (compressed)

Built: backend live integration (CORS, static Studio, /debug, memstore, migrations); Web SDK packages (omni-core / runtime / script / sim / cloud); Web Studio app (dockview layout, editor, explorer, inspector, run, debug panel, account); Tauri 2 desktop shell + release workflow; Vultr deploy files; blank template and demo script.

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
- [x] `Web/packages/omni-core/src/usis.ts`
- [x] `Web/packages/omni-core/test/usis.test.ts`
- [x] `Web/packages/omni-runtime/src/scene.ts`
- [x] `Web/packages/omni-runtime/src/input.ts`
- [x] `Web/packages/omni-runtime/src/events.ts`
- [x] `Web/packages/omni-runtime/src/viewport.ts`
- [x] `Web/packages/omni-runtime/test/runtime.test.ts`
- [x] `Web/packages/omni-script/src/sandbox.ts`
- [x] `Web/packages/omni-script/test/sandbox.test.ts`
- [x] `Web/packages/omni-sim/src/devices.ts`
- [x] `Web/packages/omni-sim/src/playback.ts`
- [x] `Web/packages/omni-cloud/src/client.ts`
- [x] `Web/packages/omni-cloud/test/client.test.ts`
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

Built: backend catalog + Sign in with Apple; OmniCloud catalog / Apple client; OmniLibrary (device profile, playability, session store, library model, stub launcher); OmniPlayer iOS + macOS app with sign-in, library, detail and theme.

Still open: Apple Developer team, bundle id, entitlement; running games on the player (needs iOS on OmniInput / OmniRuntime / OmniScript / OmniOutput). Player UI never seen rendered. Player apps are now in overview.md scope.

- [x] `Backend/Cargo.toml`
- [x] `Backend/src/db.rs`
- [x] `Backend/src/memstore.rs`
- [x] `Backend/src/api/library.rs`
- [x] `Backend/src/api/apple.rs`
- [x] `Backend/src/api/mod.rs`
- [x] `Backend/src/lib.rs`
- [x] `Backend/tests/library.rs`
- [x] `Backend/tests/apple.rs`
- [x] `Packages/OmniCloud/Package.swift`
- [x] `Packages/OmniCloud/Sources/OmniCloud/CloudClient.swift`
- [x] `Packages/OmniCloud/Tests/OmniCloudTests/LibraryAPITests.swift`
- [x] `Packages/OmniLibrary/Package.swift`
- [x] `Packages/OmniLibrary/Sources/OmniLibrary/DeviceProfile.swift`
- [x] `Packages/OmniLibrary/Sources/OmniLibrary/Playability.swift`
- [x] `Packages/OmniLibrary/Sources/OmniLibrary/SessionStore.swift`
- [x] `Packages/OmniLibrary/Sources/OmniLibrary/LibraryModel.swift`
- [x] `Packages/OmniLibrary/Sources/OmniLibrary/GameLauncher.swift`
- [x] `Packages/OmniLibrary/Tests/OmniLibraryTests/DeviceProfileTests.swift`
- [x] `Packages/OmniLibrary/Tests/OmniLibraryTests/PlayabilityTests.swift`
- [x] `Packages/OmniLibrary/Tests/OmniLibraryTests/LibraryModelTests.swift`
- [x] `Omni.xcworkspace/contents.xcworkspacedata`
- [x] `Apps/OmniPlayer/OmniPlayer.xcodeproj/project.pbxproj`
- [x] `Apps/OmniPlayer/OmniPlayer.entitlements`
- [x] `Apps/OmniPlayer/OmniPlayer/OmniPlayerApp.swift`
- [x] `Packages/OmniCloud/Sources/OmniCloud/CloudClient.swift`
- [x] `Apps/OmniPlayer/OmniPlayer/PlayerModel.swift`
- [x] `Apps/OmniPlayer/OmniPlayer/Account/AppleSignInView.swift`
- [x] `Apps/OmniPlayer/OmniPlayer/Library/LibraryView.swift`
- [x] `Apps/OmniPlayer/OmniPlayer/Library/GameDetailView.swift`
- [x] `Apps/OmniPlayer/OmniPlayer/Theme/OmniTheme.swift`
- [x] `Apps/OmniPlayer/OmniPlayer/Theme/OmniGizmoMark.swift`

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

- [ ] `Packages/OmniCollab/Sources/OmniCollab/ProjectDocument.swift` — CRDT document holding scene graph and every script's source (Automerge for Swift; track version in `branchDep.md` when added). (Also deletes `Module.swift`.)
- [ ] `Packages/OmniCollab/Sources/OmniCollab/PeerSync.swift` — Bonjour peer discovery and change exchange.
- [ ] `Packages/OmniCollab/Sources/OmniCollab/Presence.swift` — collaborator cursors, selections, "who's editing" state. Syncs the project only; never touches input.
- [ ] `Apps/OmniStudio/OmniStudio/Collab/PresenceOverlayView.swift` — cursors in the script editor, selection highlights in the viewport, entity badges.

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

Still open: Lua scripting backend; third-party Bluetooth adapters via `OmniAdapters`; iPad / Pencil and Vision Pro input; player apps on iOS / visionOS that connect players to the game server through a `RemoteChannel` (the library shell is Phase 9; running games on the player is open); relay server for remote collaboration; automatic state replication; permissions, version history and moderation for hosted games.

Full text: planHistory/phase-07.md
