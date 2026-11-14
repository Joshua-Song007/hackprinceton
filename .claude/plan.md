# Build Plan

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

## Phase 3: Live Hardware Bridge

Goal: real devices stream USIS into the same pipeline; Sim ↔ Live is a one-click toggle with zero game-code changes.

### 3.1 OmniCore — wire protocol (shared with companions)
- [x] `Packages/OmniCore/Sources/OmniCore/Wire/WireMessage.swift` — non-packet messages on the link: `hello`, `ping`, `pong`, `output` (companions depend only on OmniCore, so wire types live here).
- [x] `Packages/OmniCore/Sources/OmniCore/Wire/LineFraming.swift` — newline-delimited JSON framing over a byte stream (pure buffer split/join, no I/O).
- [x] `Packages/OmniCore/Tests/OmniCoreTests/LineFramingTests.swift` — partial reads, multiple messages per read, oversized lines.

### 3.2 OmniBridge — Mac side
- [x] `Packages/OmniBridge/Sources/OmniBridge/BonjourListener.swift` — `NWListener` advertising the Omni Bonjour service on the local network only. (Also deletes `Module.swift`.)
- [x] `Packages/OmniBridge/Sources/OmniBridge/DeviceSession.swift` — one `NWConnection` per device: framing, `hello`, ping/pong for clock sync, packet decode, seq-gap reporting. (From the 2026-11-14 phone probe: set TCP no-delay; over Wi-Fi a moving player gets 100–470 ms stalls followed by a burst of late samples, because TCP never drops. FLAGGED, not decided: discard samples older than the jitter-buffer window on arrival, or later move motion to UDP and keep TCP for `hello` / `ping` / `output`.) (Closes itself on `failed`, `cancelled` or `waiting`. No stale-discard policy and no UDP path yet. Clock samples use `tSend = deviceT`, `tRecv = deviceT + rtt`, `tHost = now` [provisional: needs-tien-review].)
- [x] `Packages/OmniBridge/Sources/OmniBridge/BridgeInputSource.swift` — `InputSource` merging all device sessions onto the `InputBus` (stamps `source: "live"`). (Descriptor sample rate, channels and default slot are per-kind defaults, since `hello` carries neither; extra test file `Tests/OmniBridgeTests/BridgeSourceSinkTests.swift` [provisional: needs-tien-review].)
- [x] `Packages/OmniBridge/Sources/OmniBridge/BridgeOutputSink.swift` — `OutputSink` forwarding `OutputCommand`s to the addressed device session.
- [x] `Packages/OmniBridge/Sources/OmniBridge/AirPodsMotionSource.swift` — `CMHeadphoneMotionManager` → USIS `head` packets directly on the Mac. (From the 2026-11-14 probe: convert Apple Z-up to Omni −Z-forward/+Y-up with `[x, z, −y, w]`; `userAcceleration` is in g, multiply by 9.81 for USIS `accel`; a `sensorLocation` change (bud handoff) jumps orientation 55–90°, so re-anchor by carrying the last pre-handoff orientation over the ~1.4 s gap, or prompt calibration; on `headphoneMotionManagerDidConnect` stop and restart device-motion updates instead of relying on resume; the app target needs `NSMotionUsageDescription`.) (Pure conversions and re-anchoring tested in `AirPodsMotionSourceTests.swift`, an extra test file with the `OmniBridgeTests` testTarget added early; the CoreMotion handler glue is untested; `deviceId` `airpods-mac`, `t` from `CMDeviceMotion.timestamp` [provisional: needs-tien-review].)
- [x] `Packages/OmniBridge/Tests/OmniBridgeTests/DeviceSessionTests.swift` — loopback session: hello, ping/pong, dropped-device goes stale rather than stopping the loop.

### 3.3 OmniCompanion — iOS
- [x] `Apps/OmniCompanion/OmniCompanion.xcodeproj/project.pbxproj` — iOS + watchOS app project depending on OmniCore only (Xcode-generated).
- [x] `Apps/OmniCompanion/Shared/BridgeClient.swift` — Bonjour browse + `NWConnection` to the Mac; auto-reconnect with backoff; answers pings. (From the 2026-11-14 phone probe: iOS suspends the app ~0.5 s after backgrounding or locking and the connection drops; on returning to the foreground cancel the old connection and open a fresh one rather than waiting for it to fail (the probe saw a connect/disconnect flap); treat `.waiting` like a failure and rediscover; Info.plist needs `NSLocalNetworkUsageDescription` and `NSBonjourServices`.)
- [x] `Apps/OmniCompanion/iOS/OmniCompanionApp.swift` — app entry and connection state UI.
- [x] `Apps/OmniCompanion/iOS/MotionStreamer.swift` — CoreMotion orientation + accel → USIS packets (changed channels only). (From the 2026-11-14 phone probe: a 100 Hz request delivers a steady 100 Hz; the phone frame is X right edge / Y top edge / Z out of the screen, so convert with `[x, y, z, w] → [x, z, −y, w]` and vectors `(x, y, z) → (x, z, −y)`, which makes the top edge point along Omni −Z forward; `userAcceleration` is in g, multiply by 9.81; keep the screen awake (`isIdleTimerDisabled`), since streaming stops when the app leaves the foreground.)
- [x] `Apps/OmniCompanion/iOS/TouchCapture.swift` — normalized touch events (began/moved/ended) → USIS `touch` channel. (From the 2026-11-14 phone probe: ~60 events/s while dragging on the tested phone.) (From the 2026-11-14 Pencil probe: read touches in a UIKit view placed as the SwiftUI `.background`, with SwiftUI content `.allowsHitTesting(false)`; a SwiftUI `.overlay` of the UIKit view received nothing; iterate `coalescedTouches(for:)`; ignore finger touches while the Pencil is touching or hovering; for squeeze / double-tap use `UIPencilInteraction`, which needs Squeeze and Double-Tap turned on in Settings → Apple Pencil, a demo-setup item.)
- [x] `Apps/OmniCompanion/iOS/HapticPlayer.swift` — plays Core Haptics patterns from received `output` messages. (From the 2026-11-14 phone probe: a `UIImpactFeedbackGenerator(.heavy)` impact feels like a short bump; use Core Haptics for longer buzzes and patterns; haptics only play while the app is in the foreground.)

### 3.4 OmniCompanion — watchOS (P1, if time allows)
- [x] `Apps/OmniCompanion/watchOS/WatchApp.swift` — watchOS app entry.
- [x] `Apps/OmniCompanion/watchOS/HeartRateWorkout.swift` — HealthKit workout session streaming heart rate.
- [x] `Apps/OmniCompanion/watchOS/WristGestureDetector.swift` — wrist gestures (tap, double-tap, flick, squeeze, pinch) from motion/accessibility APIs. (Flick from motion only; double-tap via handGestureShortcut; slot leftWrist, axis mapping and thresholds provisional.)
- [x] `Apps/OmniCompanion/watchOS/WatchRelay.swift` — sends Watch packets to the phone via WatchConnectivity. (Packets relayed unchanged over the phone's BridgeClient; OmniWatch target in OmniCompanion.xcodeproj with a HealthKit entitlement.)
- [x] `Apps/OmniCompanion/iOS/WatchConnectivityReceiver.swift` — receives Watch packets on the phone and forwards them over `BridgeClient`.

### 3.5 OmniStudio — Live mode
- [x] `Apps/OmniStudio/OmniStudio/Mode/ModeController.swift` — Sim / Live toggle: swaps the active `InputSource`/`OutputSink` pair on the `InputBus`; nothing in the runtime changes. (Source/sink selection moves here from `AppModel`'s default sim pair.) (Live = BridgeInputSource + BonjourListener + BridgeOutputSink; AirPods opt-in until NSMotionUsageDescription is added to the Studio target.)
- [x] `Apps/OmniStudio/OmniStudio/Mode/ModeToggleView.swift` — toolbar toggle bound to `ModeController`.
- [x] `Apps/OmniStudio/OmniStudio/Devices/DeviceStatusView.swift` — connected devices, battery/rate/latency, stale indicators. (Battery not shown: USIS v1 has no battery channel; the calibration tap is the Calibrate button [provisional: needs-tien-review].)
- [x] `Apps/OmniStudio/OmniStudio/Devices/CalibrationControls.swift` — "face forward and tap" calibration flow; yaw-only for AirPods.

---

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
- [x] `Backend/migrations/0001_init.sql` — `accounts`, `games` (owned by an account), `game_versions` (scene, scripts, assets, metadata). (Game files stored in TigerData for now; object storage not decided.) (Account identity = provider + subject; game files as JSONB in TigerData; `run_mode` column duplicates `scene.runMode` [provisional: needs-tien-review].)
- [x] `Backend/src/main.rs` — starts the HTTP API and the WebSocket game server; reads the TigerData URL from the environment. (Test uses raw TCP on loopback instead of tower oneshot; non-numeric PORT falls back to 8080; /api and /play not mounted yet [provisional: needs-tien-review].)
- [x] `Backend/src/db.rs` — TigerData connection pool and queries. (ids/timestamps as text and JSON via serde_json because sqlx has no uuid/json/derive/migrate features; revisit if Cargo.toml features are added [provisional: needs-tien-review].)
- [x] `Backend/src/api/accounts.rs` — sign-in and session tokens. (Sign-in method not decided.) (Dev sign-in gated by OMNI_DEV_SIGNIN=1 with in-memory opaque bearer tokens; sign-in method undecided; token source not a CSPRNG; revisit when sign-in is chosen.)
- [x] `Backend/src/api/games.rs` — publish a version, list games, fetch a version; only the owner may publish. (Fetch requires any signed-in account, not owner-only; public fetch for players undecided. Run mode limited to screen | device.)
- [x] `Backend/src/game_server/session.rs` — one WebSocket session per live game: players join and leave, remote events go into the script host and its `fire` / `fireAll` go out. Lobbies and matchmaking are game code.
- [x] `Backend/src/game_server/script_host.rs` — embedded JS engine running a game's server scripts with the same `serverScript` API as `ServerScriptEngine`. (rquickjs with `parallel`; `factory()` yields `NoopHost` until published server-script sources are reachable; prelude.js shared via `include_str!` from Packages/OmniScript, so Backend no longer builds standalone.)
- [x] `Backend/tests/api.rs` — publish → fetch round-trip; non-owner publish rejected.
- [x] `Backend/tests/script_host.rs` — same server-script fixture as `ServerScriptEngineTests.swift`, same results.

---

## Phase 5: Demo Hardening

- [x] `Recordings/demo-fallback.usis.jsonl` — recorded full-play input session for the offline fallback demo. (Simulated, hand-written 60 s session against Games/Flagship/scene.json; replace with a real capture if one is recorded [provisional: needs-tien-review].)
- [x] `Apps/OmniStudio/OmniStudio/Mode/DemoMode.swift` — one-switch replay of the fallback recording through `UsisPlayer`. (Replays through a `ModeController.setInputOverride` input override; recording lookup order env `OMNI_DEMO_RECORDING` → bundle → `Recordings/` in cwd or bundle ancestors [provisional: needs-tien-review].) (Wired into AppModel and ModeToggleView Demo switch, #152; Sim/Live picker not disabled while Demo is on.)

Not file-bound: local hotspot setup, pre-paired devices, recorded fallback video, five clean demo runs in a row.

---

## Phase 8: Omni Web Studio & Live Hosting (active, 2026-11-14)

(Numbered 8, placed here because it is the active work; Phase 6 is deferred and Phase 7 stays unscheduled, so existing 6/7 references keep their numbers.)

Goal: a live code editor people can use today, wired to everything `Backend/` already does: sign in, create a game, edit scene and scripts, run it locally against simulated peripherals, run its server scripts on the hosted game server, debug that live session (state, events, errors, logs), and publish. Packaged as its own native executable, installed and distributed like Roblox Studio (installer, versioned download, auto-update), and the same build is served by the backend on Vultr for browser use. Every window region is a dockable, resizable, hideable panel the developer arranges to fit their needs; layouts and accessibility preferences persist per user.

FLAGGED (overview.md mismatch, not decided): overview.md Module 7 defines Omni Studio as a native macOS SwiftUI app. Phase 8 adds a second, web-technology Studio (browser + desktop executable) next to it; it does not replace `Apps/OmniStudio`. Needs a user decision to update overview.md.

Roblox Studio is the model: Roblox ships a Studio, an engine API, templates (Baseplate), a local test server, Publish, and a live server console. Omni's equivalents:

| Roblox Studio | Phase 8 |
|---|---|
| Studio app | `Web/studio` (browser) + `Web/studio/src-tauri` (desktop executable) |
| Engine + Luau API | `Web/packages/*` SDK (`@omni/core`, `@omni/runtime`, `@omni/script`, `@omni/sim`, `@omni/cloud`), same contracts as the Swift packages |
| Baseplate templates | `Games/Flagship` (and a blank template) opened straight from the repo, never copied |
| Play / Play Solo | Run local: scene + client scripts in the browser, simulated devices |
| Start Server + Players | Run on server: server scripts run in `Backend/` QuickJS session on Vultr, N simulated players in tabs |
| Developer Console (server) | Debug panel: live `ctx.state`, remote events in/out, joins, script errors, `console.log` from server scripts |
| Publish to Roblox | Publish: `POST /api/games/{id}/versions` |

Rules for every Phase 8 item:
- Shared contracts are files, not copies: `Schema/usis.schema.json`, `Packages/OmniScript/Sources/OmniScript/Resources/prelude.js`, the `scene.json` shape of `SceneLoader.swift`, the `/play` frame `{"name","data"}`. The TS SDK imports them (Vite `?raw` / JSON import), so a contract change reaches Swift, Rust and TS at once.
- Hardware-blind rule holds in TS: `@omni/runtime` and `@omni/script` never depend on `@omni/sim`; the input layer strips `source` before the runtime; only the Studio debug panel sees it. Enforced by each `package.json` `dependencies`.
- Network Rule holds: sensor data (USIS) never goes to Vultr. Simulated devices run inside the Studio process; only remote events (game content) reach `/play`. Live iPhone / AirPods input stays in `Apps/OmniStudio` (macOS) for now.
- UI derives from `docs/brand-kit/`: `tokens.css` + `components/bundle.css` imported as-is, StudioWindow layout as the default layout (sidebar 240px, inspector 280px, debug area 200px, viewport takes the rest; user can rearrange from there), sentence case, numbers over adjectives, `live` orange only for real hardware (never in Phase 8 since all input is simulated), no emoji.
- Server is authoritative for game state: `ctx.state` lives in the backend session; Studio only displays it.
- Customizable windows (accessibility): every panel (Explorer, Viewport, Inspector, Script editor, Output, Server, State, Packets, Devices) docks, splits, tabs, resizes, collapses, pops out into its own OS window (desktop) and can be reset; full keyboard path for all of it (move focus between panels, resize splitters with arrow keys); preferences for UI scale (90-200%), editor font size, theme (dark / light / high contrast from brand-kit tokens), reduced motion, and focus-ring always on. Saved layouts: default StudioWindow, Script focus, Debug focus, plus user-named ones.
- Stack: TypeScript + Vite, npm workspaces, vitest, three.js (viewport), CodeMirror 6 (editor), dockview-core (docking panels, no framework), Tauri 2 (native executable, updater plugin). JS deps tracked in `Web/package-lock.json`, Rust in each `Cargo.lock`; `branchDep.md` stays Swift-only.
- Done = `npm test` and `cargo test` pass, and the item is exercised by `Deploy/dev.sh` end to end.

### 8.1 Backend — live integration (changes to Phase 4.2 files)
- [x] `Backend/Cargo.toml` — add `tower-http` (features `cors`, `fs`) for CORS and static Studio serving; nothing else.
- [x] `Backend/src/main.rs` — run `db::migrate` at startup when a pool exists (log and continue on failure); read `OMNI_STUDIO_DIR`. (migrate awaits before bind: unreachable DB delays startup ~30 s.)
- [x] `Backend/src/lib.rs` — CORS layer (origins from `OMNI_CORS_ORIGINS`, default allows the Tauri origins and `http://localhost:5173`); serve the built Studio from `OMNI_STUDIO_DIR` at `/` with SPA fallback; mount `game_server::debug::routes()`. (`app_with_studio(db, dir)` added; `app(db)` unchanged.)
- [x] `Backend/src/api/accounts.rs` — `authenticate` also accepts `?token=` (browsers cannot set headers on a WebSocket); header wins when both are present. (Token in a URL can reach proxy logs; TLS via Caddy only [provisional: needs-tien-review].) (new `authenticate_request(headers, query)`; REST stays header-only; bad header never falls back to query.)
- [x] `Backend/src/game_server/session.rs` — before `join`, fetch the game's latest version and pass its `server_scripts` sources to the registry (replaces the `NoopHost`-only factory); `?version=<n>` picks a version; a newer version for a game with a live session restarts that session's host (`reload` event `{"name":"_reload"}` to players); emits every join, leave, inbound and outbound frame to the debug bus. (after `_reload` the new host gets `onPlayerJoin` per connected player with empty `ctx.state`; joiners enter the live session whatever `?version` [provisional: needs-tien-review]; old NoopHost header lines now stale, FLAGGED.)
- [x] `Backend/src/game_server/script_host.rs` — `factory()` takes sources from the session (no lookup stub); `console.log/warn/error` inside server scripts captured (capped like `errors()`); after each handler, state JSON and new errors/logs published to the debug bus. (`HostFactory` = `(game_id, sources)`, `factory_with` removed; console capture max 100 events/call, 2000 chars; `state` sent only on change.) (fix: a line-leading `export default` after comments is rewritten, same rule as ScriptEngine.swift, so unmodified Flagship `game.js` loads; load failure printed to stderr and kept in the `/debug` snapshot until the session ends.)
- [x] `Backend/src/game_server/debug.rs` — owner-only WebSocket `GET /debug/{game_id}`: on connect sends a snapshot (players, version, `ctx.state`, last 100 logs/errors), then streams `{"kind":"join|leave|in|out|log|error|state|reload", "t", ...}`; bounded per-subscriber queue (drop oldest), never blocks the session. (256-frame queue per subscriber; 400 non-uuid id, 404 unknown game, 503 no DB.)
- [x] `Backend/src/memstore.rs` — in-memory store used when `DATABASE_URL` is unset (accounts, games, versions behind the same db.rs function signatures), so `Deploy/dev.sh` runs locally with no Postgres or Docker; data lost on restart. (Vultr uses TigerData; local demo needs nothing installed beyond cargo + node.) (`db::Db { Pg, Mem }` enum, db.rs query fns take `&Db`; `app(None)` still = no DB / 503, memory only when main sees DATABASE_URL unset; invalid DATABASE_URL still starts with no DB [provisional: needs-tien-review].)
- [x] `Backend/tests/live.rs` — publish a server script, open `/play` with `?token=`, send a remote, get the reply; `/debug` sees `join`, `in`, `out`, `state`; non-owner `/debug` is 403. Skips without `DATABASE_URL` like `tests/api.rs`.

### 8.2 Web SDK packages (`Web/packages/*`, mirror the Swift package boundaries)
- [x] `Web/package.json` — npm workspaces (`packages/*`, `studio`), scripts `dev`, `build`, `test`; dev deps typescript, vite, vitest.
- [x] `Web/tsconfig.base.json` — strict TS shared by every package.
- [x] `Web/packages/omni-core/src/usis.ts` — USIS v1 packet types and validator generated by hand from `Schema/usis.schema.json` (imported, checked in a test); `Pose`, vec3, quaternion helpers. No I/O, no deps. (also enforces 128-char deviceId and 0.01 quaternion tolerance from PacketValidator.swift, not in the schema file.)
- [x] `Web/packages/omni-core/test/usis.test.ts` — valid packets from `Recordings/demo-fallback.usis.jsonl` pass; each schema rule has a failing case.
- [x] `Web/packages/omni-runtime/src/scene.ts` — load `scene.json` (same shape and errors as `SceneLoader.swift`): entity tree, transforms, components `trigger`, `audioEmitter`, `script`; `runMode`, `clientScripts`, `serverScripts`.
- [x] `Web/packages/omni-runtime/src/input.ts` — `InputBus`: latest sample per slot, strips `source`, stale after 500 ms; one `InputFrame` per tick.
- [x] `Web/packages/omni-runtime/src/events.ts` — derived events from `InputFrame` + scene: head-probe `onTriggerEnter` / `onTriggerExit` (sphere, box), `onLookAt` (head forward ray vs entity bounds), `onGesture`, `onHeartRate`. (lookAt = forward ray vs unit box, 0.5 s dwell, Swift uses 15° cone; head probe falls back to `playerOrigin` without position [provisional: needs-tien-review].)
- [x] `Web/packages/omni-runtime/src/viewport.ts` — three.js render of the scene: boxes for entities, floor grid, axis gizmo, selection outline, head-pose camera; colors from brand-kit tokens (`viewport`, `viewport-grid`, `accent`, axis colors). (no test: no WebGL in Node.)
- [x] `Web/packages/omni-runtime/test/runtime.test.ts` — `Games/Flagship/scene.json` loads; trigger enter/exit and lookAt fire from scripted head poses.
- [x] `Web/packages/omni-script/src/sandbox.ts` — client scripts in one Web Worker per run: evaluates shared `prelude.js` (`?raw` import), same leading `export default` rewrite as `ScriptEngine.swift`; handlers get `(self, ctx, ...)`; `ctx.haptic`, `ctx.remote.fire(name, data)`, `self.audio.play`, `self.position`; per-call 250 ms watchdog (worker terminated, error reported); errors and `console.*` routed to the Studio Output tab. (`new Function` + `with`: Tauri CSP needs `unsafe-eval`; killed worker restarts with scripts reloaded, per-entity state lost; isolation = worker has no DOM, not a security boundary, FLAGGED.)
- [x] `Web/packages/omni-script/test/sandbox.test.ts` — Flagship `player.js` / `enemy.js` load; an unknown handler is rejected with prelude's message; an infinite loop is stopped.
- [x] `Web/packages/omni-sim/src/devices.ts` — virtual AirPods (head yaw/pitch from viewport mouse-look), phone (gesture keys: tap, flick, pinch), watch (heart-rate slider); emit USIS packets with `source: "sim"` at 50 Hz.
- [x] `Web/packages/omni-sim/src/playback.ts` — `.usis.jsonl` playback on the device clock (demo fallback recording), loop option.
- [x] `Web/packages/omni-cloud/src/client.ts` — typed client for every backend route: signin, me, signout, games list/create, publish, fetch version, `/play` socket (auto-reconnect with backoff), `/debug` socket. Server URL configurable (default: same origin; desktop default from settings).
- [x] `Web/packages/omni-cloud/test/client.test.ts` — request shapes and error mapping against a stubbed `fetch`; 401 surfaces as a typed error, not a throw-loop.

### 8.3 Web Studio app (`Web/studio`)
- [x] `Web/studio/index.html` — window shell: toolbar, dock area (panels mounted by `layout.ts`), status bar. (fix round 1 from the brand-kit/a11y review: UI scale on sheets/menus, collapse panel Ctrl+Alt+C, split Ctrl+Alt+Shift+arrows, focus kept across live re-renders, roving packet rows, token-only CodeMirror, gesture keys on the canvas only; skipped review items 14, 18, 20, 22-25, 27; none checked visually.)
- [x] `Web/studio/src/layout.ts` — docking layout manager on dockview-core: register panels, default StudioWindow layout + presets (Script focus, Debug focus), save / load / reset named layouts (localStorage), keyboard focus cycling between panels (F6 / Shift+F6) and arrow-key splitter resize, pop-out to a separate window on desktop. (Panel ids are stable strings so saved layouts survive upgrades.) (every debug tab is its own dockview panel, tabbed in the StudioWindow regions by default; arrow-key splitter resize via a synthesized drag; extra keys Ctrl+Alt+arrows move panel, Alt+PgUp/PgDn tabs, Ctrl+Alt+M maximize, F5/Shift+F5 run/stop; pop-out = `popOut` hook, hidden in the browser [provisional: needs-tien-review].)
- [x] `Web/studio/src/preferences.ts` — per-user settings: UI scale, editor font size, theme (dark / light / high contrast), reduced motion (also honors `prefers-reduced-motion`), server URL; applied as CSS variables on `:root`; Settings sheet. (UI scale via CSS `zoom`; server URL defaults to http://localhost:8080 in dev, page origin in the built app.)
- [x] `Web/studio/src/theme.css` — imports `docs/brand-kit/project/tokens.css` and `components/bundle.css`; layout sizes from the brand kit; no new colors. (high contrast = dark tokens remapped, no new colors.)
- [x] `Web/studio/src/project.ts` — project model: scene + client/server script sources + metadata; open template (`Games/Flagship`, blank), open from cloud (latest version), dirty tracking, local autosave (IndexedDB).
- [x] `Web/studio/src/editor.ts` — CodeMirror 6 JS editor per script, tabs, inline error markers from sandbox and server errors, Ctrl+S saves. (sandbox errors carry no line numbers: markers go on the named handler's line or line 1; Ctrl+S = local recovery copy, not publish.)
- [x] `Web/studio/src/explorer.ts` — entity tree + Scripts (client, server) list; add / rename / delete script; select entity. (viewport has no picking: select from Explorer only.)
- [x] `Web/studio/src/inspector.ts` — selected entity: name, Vector3 fields (position, scale; drag-to-scrub, brand-kit Vector3Field), components; edits update the scene JSON. (no rotation field: scene rotation is a quaternion.)
- [x] `Web/studio/src/run.ts` — Run local (runtime + sandbox + sim devices in the page) and Run on server (publish draft version, join `/play/{id}` as player 1; "Add test player" opens another session in a new tab); Stop; status bar shows rate, latency, players. (Run on server publishes a new version each run; test player = `/?join=<game>&version=n&as=<name>`, a second in-memory dev account; its tab cannot see `/debug` (owner-only) [provisional: needs-tien-review].)
- [x] `Web/studio/src/debug-panel.ts` — debug area tabs: Output (client logs/errors), Server (`/debug` stream: logs, errors, events in/out), State (live `ctx.state` JSON tree), Packets (USIS log with `source`, brand-kit PacketLog).
- [x] `Web/studio/src/account.ts` — sign-in sheet (dev sign-in: provider `dev` + name), server URL setting, game picker, Publish with version shown.
- [x] `Web/studio/src/main.ts` — composition root: wires SDK packages to panels (the only file that imports `@omni/sim` and `@omni/cloud` together with the runtime).
- [x] `Web/studio/test/e2e.test.ts` — headless: open Flagship template, Run local, simulated head pose enters Sanctuary, `player.js` handler runs; against a running backend (skip if `OMNI_E2E_URL` unset): sign in, publish, Run on server, `banish` x3 gives `round: won` in the State tab data. (server part passes against the real in-memory backend from `Deploy/dev.sh`: 60/60 with `OMNI_E2E_URL=http://localhost:8080`.)

### 8.4 Desktop executable
(DECISION 2026-11-14, Tien: keep Tauri 2. UI renders in the OS webview (WebView2 / WKWebView), distributed as a native installer; native-control UI (SwiftUI/WinUI) not pursued for this Studio.)
- [x] `Web/studio/src-tauri/Cargo.toml` — Tauri 2 shell crate (separate Cargo project, not a Backend dependency). (crate `omni-studio`; `cargo check` exits 0, Jev gate 0.70 < 0.8 only because the evidence is one `Finished` line.)
- [x] `Web/studio/src-tauri/tauri.conf.json` — app id `dev.omni.studio`, product name `Omni Studio`, window 1440x900 min 1024x640, remembers size/position, bundles `nsis` (Windows installer .exe, per-user install, Start menu entry) and `app`/`dmg` (macOS); brand-kit gizmo icon; updater endpoint on the Vultr host. (updater endpoint = GitHub `releases/latest/download/latest.json`, no Vultr domain yet [provisional: needs-tien-review]; pubkey embedded, private key `~/.tauri/omni-studio.key` outside the repo; CSP allows `unsafe-eval`, `blob:` workers, any http/ws `connect-src`; NSIS built locally: `src-tauri/target/release/bundle/nsis/Omni Studio_0.1.0_x64-setup.exe`, 2.6 MiB, unsigned.)
- [x] `Web/studio/src-tauri/src/main.rs` — starts the window on the built Studio; registers the updater and window-state plugins; one command to open a popped-out panel window; no other Rust logic (all logic stays in the web build so browser and desktop are one code path). (pop-out = dockview `addPopoutGroup` + `public/popout.html`, `window.open` allowed by an `on_new_window` handler (main window built in `setup`); `open_panel_window` registered but unused; pop-out unverified (headless), macOS untested.)
- [x] `.github/workflows/studio-release.yml` — on tag `studio-v*`: build the Windows installer and macOS dmg, sign if secrets exist (unsigned otherwise, flagged), attach to a GitHub Release and publish the updater manifest the desktop app polls. (Code-signing certificates are a human purchase; not decided.) (tauri-action@v0, macOS universal, `latest.json` attached to the GitHub Release; missing secrets = `::warning::`, not a failure; only YAML-parse checked, never run on CI.)
- [x] `Deploy/download.html` — download page served by the backend at `/download`: latest installer per OS, version, release notes link (brand-kit Cover styling). (Dockerfile copies it to `<studio>/download/index.html` + `tokens.css`; release list fetched client-side from the GitHub API, tags `studio-v*`; not served by `dev.sh`.)

### 8.5 Hosting on Vultr (deploy, live debug, run)
- [x] `Deploy/Dockerfile` — multi-stage: Node builds `Web/studio`, Rust builds `Backend/` (whole repo context: `prelude.js` edge), slim runtime image with the binary + Studio at `OMNI_STUDIO_DIR`. (never built: no Docker in this session.)
- [x] `Deploy/docker-compose.yml` — `backend`, `postgres` (local / single-box Vultr; skipped when `DATABASE_URL` points at TigerData via profile), `caddy`; health checks; restart unless-stopped. (never run; a `$` in `DATABASE_URL` may be mangled by `env_file`, untested.)
- [x] `Deploy/Caddyfile` — HTTPS for `$OMNI_DOMAIN` (or IP with internal TLS), reverse proxy with WebSocket upgrade for `/play/*` and `/debug/*`. (IP case via `OMNI_CADDY_GLOBAL=local_certs` written by bootstrap; never run.)
- [x] `Deploy/vultr-bootstrap.sh` — run once on a fresh Vultr Ubuntu 24.04 instance over ssh: install Docker, open 80/443, clone the repo, write `.env` (prompted `DATABASE_URL`, `OMNI_DOMAIN`, `OMNI_DEV_SIGNIN`), `docker compose up -d --build`; re-run = update (git pull + rebuild). Human-only steps: create the instance and DNS record, paste secrets. (dev sign-in prompt defaults to 0, demo needs 1; curl-pipe from GitHub `main` needs the repo public; ufw vs Docker-published ports unverified; never run.)
- [x] `Deploy/dev.sh` — one local command, no Docker: `cargo run` backend (in-memory store unless `DATABASE_URL` is set) (`OMNI_DEV_SIGNIN=1`), Vite dev server; prints the Studio URL. Same env names as Vultr so local = hosted. (Vite dev server crashed with `EBUSY` watching `Web/studio/src-tauri/target` while cargo built the desktop app; fix = `server.watch.ignored: ['**/src-tauri/**']` in `Web/studio/vite.config.ts`, not applied, FLAGGED.)

### 8.6 Live demo (humans see the backend working)
- [x] `Web/studio/src/templates/blank.ts` — blank template: floor, one cube with a client script and a server script that counts clicks into `ctx.state` (shows Run on server + State tab in under a minute).
- [x] `Deploy/demo.sh` — scripted check of the hosted or local stack: health, dev sign-in, create game, publish Flagship, open `/play` as 2 players + `/debug`, play a round (`banish` x3), print the event log and final `ctx.state`; exit non-zero on any mismatch. (Node `fetch`/`WebSocket` after a curl `/health`; `OMNI_INSECURE=1` for a self-signed IP box; passes locally against the in-memory backend with Flagship scripts unmodified.)

Not file-bound: demo run on the Vultr box from the desktop executable; two people on two machines in one server session; first-pass UI review against the brand kit, then iterate the frontend from what humans see.

---

## Phase 9: Player App (consumer, iOS + macOS)

(Numbered 9, placed here after Phase 8 because it is the next active work; Phase 6 stays deferred and Phase 7 unscheduled, so existing 6/7 references keep their numbers.)

Goal: a multiplatform (iOS + macOS) Omni player app where a person signs in with Apple, browses the cloud game library and sees which games this device can play. Play fetches the published game and stops there: running it (runtime, game-server WebSocket, Mac bridge input) is the next round. Games stay cloud-hosted as data; they run on the player's device and sensor data never goes to the cloud (overview.md Network Rule).

FLAGGED (overview.md mismatch, not decided): overview.md lists player apps in Phase 7 (after the hackathon) and Module 11 says only Studio (the composition root) fetches from the backend. Phase 9 adds a second composition root, `Apps/OmniPlayer`, that also talks to the backend through `OmniCloud`. Needs a user decision to update overview.md (a Player App module, Phase 7 wording, Module 11 boundary).

Rules for every Phase 9 item:
- Identity is Sign in with Apple. The device profile (kind, sensors, tier it can meet) only decides which games are flagged playable; it is not an identity.
- `OmniLibrary` depends on `OmniCloud` only. It never depends on OmniRuntime, OmniScript, OmniInput, OmniSim or OmniBridge this round, so the hardware-blind property and the Network Rule hold by package dependencies.
- Lanes: 9.1 is backend work (`jacob-e-lee`'s lane); 9.2 to 9.4 are Swift, and `Apps/**` items need a Mac worker with `xcodebuild` output (iOS Simulator and macOS) in the PR. The lane table in `.agents/ORCHESTRATOR.md` has no row for `OmniLibrary` or `Apps/OmniPlayer` yet.
- Re-listing an existing file is allowed for a follow-up change, as in 8.1.

### 9.1 Backend — catalog and Apple sign-in (changes to Phase 4.2 / 8.1 files, plus new files; blocks 9.2 and 9.4)
- [x] `Backend/Cargo.toml` — add an RS256 JWT verifier and an HTTPS client (to fetch Apple's signing keys); nothing else. (Crate names not decided [provisional: needs-tien-review]; accounts.rs currently says "no new crates".) (Chosen: `jsonwebtoken` 12 with `rust_crypto` and `reqwest` 0.12 with `rustls-tls` + `json`, both default-features off; no aws-lc, which needs a C toolchain on Windows; `ring` was already in the tree via sqlx. `jsonwebtoken` 12 needs rustc 1.88+; checked on 1.95 only, no toolchain pin. `Cargo.lock` grew by ~840 lines. The "no new crates" comment in accounts.rs is now stale: flagged, not edited.) (Also `getrandom` 0.3 for `accounts.rs::new_token`; already in `Cargo.lock`, so no new package.)
- [x] `Backend/src/db.rs` — `list_catalog(&Db)`: one row per game with id, title, owner `display_name`, latest version, `run_mode` and the scene JSON (the tier is read from `requiredTier`, default 1). Postgres query and `Db::Mem` arm. (Diverges: returns `required_tier` (`catalog_tier`: JSON integer clamped to 1..=3, anything else 1) and not the scene JSON, so the catalog never ships full scenes; games with no version are not listed; no paging or cap, undecided. The Postgres query has not run: no `DATABASE_URL` here, only the in-memory path is tested; `db_round_trip` covers it when `DATABASE_URL` is set.)
- [x] `Backend/src/memstore.rs` — `MemStore::list_catalog`, same result as `db.rs`. (An owner with no account row gets author ""; Postgres has a foreign key.)
- [x] `Backend/src/api/library.rs` — `GET /api/library`, any signed-in account: id, title, author, latestVersion, runMode, requiredTier per game. (No description: `GameBundle` carries none. Every published game is listed; permissions and moderation undecided [provisional: needs-tien-review].) (4 in-file tests plus `tests/library.rs`.)
- [x] `Backend/src/api/apple.rs` — `POST /api/accounts/apple` `{identityToken, displayName?}`: verify RS256 against Apple's keys, iss `https://appleid.apple.com`, aud in env `OMNI_APPLE_AUDIENCES`, not expired; `upsert_account` with provider `apple` and subject = `sub`, name from the request only (Apple omits it from the token and sends it once, at first authorization; `upsert_account` keeps the stored name when the new one is empty); returns the same `{token, account}` as dev sign-in. The key source is a trait so tests inject keys. (Check `store_session` visibility in `accounts.rs`; if private, make it `pub(crate)` in this item.) (Done: `store_session` was private, now `pub(crate)`. Verified by 5 in-file tests (audience parsing, 400, 503 without a database or audiences, 401 for an undecodable token with no key lookup) and `tests/apple.rs`. Also added `HttpAppleKeys::with_url` so tests can point the real key source at a local server. `HttpAppleKeys` honors `HTTP_PROXY`, so a bad proxy setting on the server turns every Apple sign-in into a 502. Two checks are defence in depth, not gaps: the early `alg != RS256` check (the library's validation also refuses other algorithms) and `sub` in the required claims (the claims struct already rejects a missing `sub`). `OMNI_APPLE_AUDIENCES` unset means the route answers 503. Not built: nonce check (a stolen identity token can be replayed until it expires, ~10 min) and a rate limit. Also changed: `accounts.rs::new_token` now uses `getrandom` (OS randomness, fails closed), as that file's own comment required before any real sign-in; the comment above `new_token` is now stale, flagged, not edited. FLAGGED, not scheduled: `Deploy/vultr-bootstrap.sh` never asks for `OMNI_APPLE_AUDIENCES` and rewrites `.env` on re-run, so the hosted route answers 503 until that is fixed.) (Changed 2026-11-14: `Deploy/vultr-bootstrap.sh` now asks for `OMNI_APPLE_AUDIENCES` and appends it to an existing `.env` when passed; the flag's "rewrites `.env` on re-run" was wrong, the script keeps an existing `.env`. Bundle id not chosen (9.4), so the hosted Apple route still answers 503 until it is set.)
- [x] `Backend/src/api/mod.rs` — declare the `library` and `apple` modules.
- [x] `Backend/src/lib.rs` — mount both routers.
- [x] `Backend/tests/library.rs` — catalog fields; signed-out rejected; newest version wins. In-memory store, so it runs without `DATABASE_URL`. (One test function on purpose: it sets `OMNI_DEV_SIGNIN`, and `set_var` must not race other test threads.)
- [x] `Backend/tests/apple.rs` — valid token signs in; wrong audience, expired and bad signature rejected; a repeat sign-in without a name keeps the name. In-memory store, injected keys. (8 tests. Section A: valid sign-in and `/api/accounts/me` + `/api/library` with the issued session; repeat sign-in, blank name and rename; different `sub`; several audiences; 401 with no session for wrong audience, expired (1 h; default leeway is 60 s), bad signature, wrong issuer, HS256, unknown key id, missing `sub`, empty `sub`, garbage; 502 for a down key source; 503 with no audiences. Section B, one test fn because it sets `NO_PROXY` (reqwest honors `HTTP_PROXY`), runs the real `HttpAppleKeys` against a local server: one fetch then cache hits, no refetch for an unknown key id inside 60 s, 502 for a dead server, an error status and a non-key-set body. Test RSA key is a hex constant generated for this file. Mutation check in a scratch copy: audience, expiry and issuer checks, name trimming, key cache, fetch throttle, empty-audiences 503 and the empty-`sub` check each fail a test. Not testable without waiting: the 1 h cache expiry and the 60 s throttle release. Scratch builds must use their own `CARGO_TARGET_DIR`: sharing `Backend/target` made the repo run a stale mutated library.)

### 9.2 OmniCloud — catalog and Apple sign-in client
- [x] `Packages/OmniCloud/Package.swift` — add `.iOS(.v18)`. (OmniCloud was macOS-only; the iOS app needs it.) (Before the change the iOS Simulator build failed on one error, `URL.append(path:)` needs iOS 16; after it, `xcodebuild build -scheme OmniCloud -destination 'generic/platform=iOS Simulator'` succeeds. Build only: no iOS test run until 9.4.)
- [x] `Packages/OmniCloud/Sources/OmniCloud/CloudClient.swift` — `CatalogEntry`; `listCatalog()`; `signInWithApple(identityToken:displayName:)`. (Same file as the client: `sessionToken` and `send` are `private`, so an extension in another file cannot use them.) (The new methods call the backend's real routes, `POST /api/accounts/apple` and `GET /api/library`, and read its real sign-in response (`{token, account}` with snake_case `display_name`). The existing methods (`signIn`, `publish`, `listGames`, `fetchGame`) still use the provisional `/v1` routes of `docs/agents/cloud-api.md`, which the backend does not serve: FLAGGED, not scheduled, and it breaks Studio's publish and sign-in against the real backend and the `fetchGame` the Play stub in 9.3 relies on. The file header comment ("routes provisional") and the `signIn` doc comment are now stale, flagged, not edited; `cloud-api.md` does not list the new routes.) (Fixed 2026-11-14: `signIn`, `publish`, `listGames`, `fetchGame` now use the backend's `/api` routes with its snake_case shapes; public Swift signatures unchanged. `signIn(token:)` adopts a pasted session token and checks it with `GET /api/accounts/me`; new `signInDev(name:)` = web Studio dev sign-in; `publish` without a game id creates it first (`POST /api/games`); `listGames` takes the latest version from `/api/library` (0 if never published); a version's title comes from `metadata.title`, else `metadata.name` (web Studio), else ""; assets travel as `{name: {contentType, data}}` base64, a plan decision. 22 OmniCloud tests pass; a scratch Swift client ran sign-in, create, publish x2, list, fetch and catalog against a local backend. Stale, flagged not edited: the file header comment ("routes provisional; see cloud-api.md") and the `signIn` doc comment; Studio's `SignInView` still asks for a pasted token rather than using `signInDev`.)
- [x] `Packages/OmniCloud/Tests/OmniCloudTests/LibraryAPITests.swift` — request and response coding against a stubbed `URLProtocol`; a 401 surfaces as `CloudError.unauthorized`. (11 tests; full OmniCloud suite 20 passed on macOS. Uses its own `LibraryStub`, not `StubProtocol`: Swift Testing runs separate suites in parallel and `StubProtocol`'s statics are shared. Mutation check in a scratch copy: wrong route, session token not stored, missing `display_name` mapping, and no auth on `listCatalog` each fail named tests.)

### 9.3 OmniLibrary — device profile and library model (new package; depends on OmniCloud only; macOS 15 + iOS 18; testTarget `OmniLibraryTests`)
- [x] `Packages/OmniLibrary/Package.swift` — OmniLibrary manifest, depends on OmniCloud only. (The test target also lists the OmniCloud product, since the tests build `CatalogEntry` and `FetchedGame`.)
- [x] `Packages/OmniLibrary/Sources/OmniLibrary/DeviceProfile.swift` — device kind (iPhone / iPad / Mac), model, OS, sensors, and `maxTier` (a plain Int 1…3, like `SceneDescription.requiredTier`, so OmniLibrary stays off OmniInput). (Presets: iPhone and iPad = display + touch + motion, Mac = display only; `maxTier` is 1 for every kind because Tier 2 (LiDAR) and Tier 3 (Watch) cannot be detected without ARKit, so `needsTier(2|3)` shows on every real device today; callers with better knowledge pass their own `maxTier`, clamped to 1…3. `current()` reads `hw.model` / `hw.machine` (or `SIMULATOR_MODEL_IDENTIFIER`) with no UIKit; a non-iPad iOS machine counts as iPhone. Not decided, no revisit scheduled.)
- [x] `Packages/OmniLibrary/Sources/OmniLibrary/Playability.swift` — pure function (catalog entry, device profile) → playable / needsController / needsTier(n) / needsDisplay. `device` games need a phone; `screen` games need a display plus controllers (overview.md Module 7 Run Mode). (Diverges: a fifth outcome `needsPhone`, because a `device` game on a Mac or iPad fits none of the four listed. Check order: `device` needs an iPhone; `screen` and any unknown run mode need a display, then motion or touch; then the tier. A Mac has no built-in motion, so every screen game is `needsController` there until the Mac bridge input lands. [provisional: needs-tien-review])
- [x] `Packages/OmniLibrary/Sources/OmniLibrary/SessionStore.swift` — `SessionStore` protocol; Keychain implementation; in-memory implementation for tests. (Stores a `StoredSession` (token + `Account`) as JSON in one generic-password item; save adds then updates on a duplicate; undecodable data is deleted and read as signed out; no `kSecUseDataProtectionKeychain`. FLAGGED, not built: `CloudClient` cannot export or restore its session token, so nothing can feed a stored session back into it; see the follow-up item in 9.4.)
- [x] `Packages/OmniLibrary/Sources/OmniLibrary/LibraryModel.swift` — main-actor observable model: loads the catalog through a `CatalogSource` protocol (`CloudClient` conforms), search, refresh, error state, per-entry playability. (`load()` only from idle, `refresh()` always, both ignored while loading; a failure keeps the old entries; 401 or not signed in = `.failed(.signedOut)`; a cancelled task is not a failure; `reset()` bumps a generation so a request in flight at sign-out cannot refill the next user's library. Search is case and diacritic insensitive on title and author and keeps server order.)
- [x] `Packages/OmniLibrary/Sources/OmniLibrary/GameLauncher.swift` — `GameLauncher` protocol plus `StubGameLauncher` (fetches the `FetchedGame`, records it, no runtime). This is the seam the runtime plugs into in the next round. (Adds a `GameSource` protocol that `CloudClient` conforms to, and `LaunchResult { game, started }`, always `started: false`. Fetches the entry's `latestVersion`, throws `LaunchError.mismatch` if the server returns another game or version, keeps the last 10. FLAGGED: `CloudClient.fetchGame` still calls the provisional `/v1` routes, so this works against fakes only until those are fixed; see 9.2.) (Changed 2026-11-14: `CloudClient` now uses the backend's `/api` routes (commit 122eeae), so the flag above is resolved and Play works against the real backend.)
- [x] `Packages/OmniLibrary/Tests/OmniLibraryTests/DeviceProfileTests.swift` — each device kind maps to its sensors and `maxTier`. (Also tier clamping, machine-string parsing and `current()` on macOS.)
- [x] `Packages/OmniLibrary/Tests/OmniLibraryTests/PlayabilityTests.swift` — every outcome for both run modes and tiers 1 to 3. (The 18-case matrix is written out, plus unknown run mode, tier below 1, custom profiles and check order.)
- [x] `Packages/OmniLibrary/Tests/OmniLibraryTests/LibraryModelTests.swift` — load, search, error and empty states; `StubGameLauncher` and the in-memory session store. (36 tests across the package pass on macOS, OmniCloud's 20 still pass, the iOS Simulator build succeeds. Also covers cancellation, reset during a request in flight, the Keychain store (it works inside macOS `swift test`) and corrupt Keychain data. Mutation check in scratch copies: case-sensitive search, tier check first, tier off by one, refresh unguarded, failure wiping entries, no generation check, no mismatch check, nil version, corrupt data not cleared, no task-cancel check, uncapped history and no update on a duplicate each fail a named test; two of these first survived or hung and were fixed in the tests (gate valve and all-waiters fake, direct Keychain lookup). Not tested: iOS device Keychain, `DeviceProfile.current()` on iOS.)

### 9.4 OmniPlayer — iOS + macOS app (Mac worker; `xcodebuild` iOS Simulator and macOS builds in the PR)
- [x] `Omni.xcworkspace/contents.xcworkspacedata` — reference `Packages/OmniLibrary` and `Apps/OmniPlayer/OmniPlayer.xcodeproj`. (Xcode-generated; commit as-is.) (Edited by hand: two `FileRef` entries. `xcodebuild -workspace Omni.xcworkspace -scheme OmniPlayer` builds for the iOS Simulator and macOS.)
- [x] `Apps/OmniPlayer/OmniPlayer.xcodeproj/project.pbxproj` — multiplatform SwiftUI app (iOS 18 + macOS 15), one bundle id, links OmniLibrary and OmniCloud. (Hand-written like Studio's [provisional: needs-tien-review].) (One target, `SDKROOT = auto`, `com.omni.OmniPlayer` (an assumption: the human registers it), ad-hoc signing. Built for the iOS Simulator and macOS, Debug and Release, each with no warnings beyond the harmless "AppIntents metadata extraction skipped" line. Extra file `Apps/OmniPlayer/Info.plist`, merged with the generated one, carries `OmniCloudURL = $(OMNI_CLOUD_URL)` (build setting `OMNI_CLOUD_URL`, empty by default): a custom `INFOPLIST_KEY_` setting is not emitted, and an app launched from the home screen has no environment variables. `SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG` is set for Debug: a hand-written project does not define it, which hid the dev sign-in until the run check caught it. The entitlement is wired for iOS only (`CODE_SIGN_ENTITLEMENTS[sdk=iphone*]`): with ad-hoc signing it fails the macOS Release build ("requires a development certificate"), so Sign in with Apple on the Mac needs the human to pick a team and add `CODE_SIGN_ENTITLEMENTS[sdk=macosx*]`. No App Sandbox (Studio has none either); App Store distribution needs it plus `network.client`. `http://localhost` works from the simulator with no ATS entry; an `http://` LAN or public host on a device would be blocked, and Caddy's local CA on a bare IP is not trusted on a device, so a hosted backend needs a domain.)
- [x] `Apps/OmniPlayer/OmniPlayer.entitlements` — `com.apple.developer.applesignin`. (`Default`; applied to iOS builds only, see the project item. Present in the simulator build's entitlements; macOS builds carry none.)
- [x] `Apps/OmniPlayer/OmniPlayer/OmniPlayerApp.swift` — SwiftUI app entry. (A private `RootView` switches between a spinner, `AppleSignInView` and `LibraryView`; `start()` runs once per launch.)
- [x] `Packages/OmniCloud/Sources/OmniCloud/CloudClient.swift` — follow-up to 9.2, needed before `PlayerModel.swift` can keep a player signed in: `currentSession()` returning the token and account, and `restoreSession(token:account:)`; plus a test in `Packages/OmniCloud/Tests/OmniCloudTests/LibraryAPITests.swift`. (Added at the 9.3 apply: `sessionToken` is private with no setter, so the stored session in `SessionStore` cannot be fed back into the client. Backend sessions are in memory, so a stored token stops working when the backend restarts and the client then clears it on the 401.) (Narrowed at the 9.4 stage: `signIn(token:)` already adopts a session token and checks it with `GET /api/accounts/me`, so it is the restore call. Only the read side was missing: `sessionToken` is now `public private(set)`, with the test `sessionTokenIsReadableAfterSignIn` (23 OmniCloud tests pass). No `currentSession()` or `restoreSession` was added.)
- [x] `Apps/OmniPlayer/OmniPlayer/PlayerModel.swift` — the second composition root: `CloudClient` (base URL from env `OMNI_CLOUD_URL`), session store, `DeviceProfile`, `LibraryModel`, `StubGameLauncher`. (Base URL = env `OMNI_CLOUD_URL`, then Info.plist `OmniCloudURL`, then `http://localhost:8080`; unusable values (blank, not http / https, no host) fall through. Restore on launch: a rejected session is cleared, an offline or 5xx start keeps it and offers "Try again", a successful one refreshes the stored account. A failed Keychain save does not fail a sign-in. Sign-out clears the store and the library but does not call the backend's `/api/accounts/signout` (no `CloudClient` method); the server-side session lives until the backend restarts. FLAGGED: no app test target in the plan, so the logic was tested in a scratch SwiftPM package outside the repo, not committed: 14 tests, and a mutation check where offline clearing the store, no re-save, sign-out or rejection not clearing the store, a failed save failing the sign-in, any URL scheme accepted and `sessionExpired` without its guard each fail a named test. Offer an app test target later if wanted.)
- [x] `Apps/OmniPlayer/OmniPlayer/Account/AppleSignInView.swift` — `SignInWithAppleButton` → `signInWithApple`, passing the name from the first authorization; `#if DEBUG` dev-token fallback for the simulator. (Requests only the full name; a cancelled sheet shows no message; the identity token and name are read out of the non-Sendable authorization before the task starts. The debug fallback is a name field calling `signInDev` (the server needs `OMNI_DEV_SIGNIN=1`; a 404 reads "Dev sign-in is off on this server."), and is absent from Release binaries (checked by string search). No nonce is sent; the backend does not check one. NOT exercised: tapping Apple sign-in (needs a team, a registered bundle id, entitled signing and `OMNI_APPLE_AUDIENCES=com.omni.OmniPlayer` on the server) or the dev sign-in button (no UI automation here).)
- [x] `Apps/OmniPlayer/OmniPlayer/Library/LibraryView.swift` — grid / list, search, tier badge, playable flag. (Adaptive grid, one column on a phone; flag is a symbol plus words. Handles loading, empty, no-search-results and error states, and sends an expired session back to sign-in. Seen running only as far as the sign-in screen on the iOS Simulator and a macOS Debug launch that stayed alive 6 s: the library and detail screens were never rendered, because nothing here can tap through sign-in.)
- [x] `Apps/OmniPlayer/OmniPlayer/Library/GameDetailView.swift` — metadata, run mode and Play (shows the stub result). (Play is disabled unless the game is playable; the result reads "Fetched version N: X client scripts, Y server scripts, Z assets. Running games on this device is not available yet." Shared helpers `Playability.summary`, `CatalogEntry.runModeLabel` and `runModeExplanation` live in `LibraryView.swift`.)
- [x] `Apps/OmniPlayer/OmniPlayer/Theme/OmniTheme.swift` — colour tokens (light and dark), spacing / radius / control metrics and the `OmniPrimaryButtonStyle`, `OmniSecondaryButtonStyle` and `OmniFilterToggleStyle` styles for the Player. (Added 2026-11-14. Token names follow `docs/brand-kit`; the colour values are the supplied five-colour palette (Tea Green, Sandy Clay, Emerald Depths, Clay Soil, Powder Blue) and tints of them, so the Player's colours differ from the Studio kit's grey and blue: FLAGGED, not decided; `docs/brand-kit` and Studio are unchanged. Two values are derived, not palette: dark `error` E8907F (Clay Soil lightened) and the tints. Contrast was computed per pair, all text pairs 4.5:1 or better; the card edge is only 1.07 to 1.5:1 against the ground (decorative) and may need the stronger border noted in the audit. `controlHeight` is 44 pt on iOS, 24 pt on macOS. Colours are in code (`Color(light:dark:)`), not Color Sets as the kit README says. Not seen rendered: no screen capture here.)
- [x] `Apps/OmniPlayer/OmniPlayer/Theme/OmniGizmoMark.swift` — the Omni gizmo mark drawn in SwiftUI with the kit's per-appearance axis colours; used on the sign-in screen. (Added 2026-11-14; no asset catalog. The macOS / iOS app icon is not made: a human step in Icon Composer.)

Not file-bound: Apple Developer team, the Sign in with Apple capability and bundle id registration; the next round (runtime on the player, game-server WebSocket, Mac bridge input) needs `.iOS(.v18)` on OmniInput, OmniRuntime, OmniScript and OmniOutput first.

---

## Phase 10: Marketplace cloud follow-ups (after PR #161)

Goal: move the plugin marketplace from the dev box (in-memory store, `OMNI_PLUGIN_SEED_DIR`, per-browser state, local model key) to hosted, per-account services. Nothing here is built; each item lists what it touches and when it is done. Source: WISHLIST and Debt in `docs/agents/progress/omni-marketplace.md`.

### 10.1 Hosted registry on Vultr
Goal: the plugins routes run against Postgres on the Vultr host, filled by a publish/seed job instead of `OMNI_PLUGIN_SEED_DIR`.
- Touches: `Backend/src/api/marketplace.rs` (seed path, blocking `std::fs` at :89), `Backend/src/db.rs`, `Backend/migrations/0002_plugins.sql`, `Deploy/docker-compose.yml`, `Deploy/vultr-bootstrap.sh`.
- Done when: the hosted backend lists and installs `langchain-deepagents` with `DATABASE_URL` set and no seed dir; the seed job is idempotent (a second run changes nothing) and applies the `[a-z0-9-]` id rule; a `Backend/tests` case runs against Postgres.
- Status (2026-11-14): built. `omni-backend seed <dir>` job (also run by `vultr-bootstrap.sh` when `OMNI_S3_*` is in `.env`); migration `0003_marketplace_cloud.sql` replaces the 0002 table (old rows dropped, re-seed); the seed refuses Postgres without S3. Verified locally against Postgres 17 + an S3-compatible server (SeaweedFS): listed and fetched with no seed dir, second seed run unchanged, bad id skipped; `tests/marketplace.rs` runs on Postgres when `DATABASE_URL` is set. NOT DONE: run on the Vultr box (needs push + redeploy). `OMNI_PLUGIN_SEED_DIR` kept for the dev box only.

### 10.2 Bundle object storage
Goal: bundles are tarballs in Vultr Object Storage with content hashes and signatures, not JSON file maps in a JSONB column.
- Touches: `Backend/src/api/marketplace.rs`, `Backend/src/db.rs`, a new migration (hash, signature, object key), `Web/studio/src/marketplace`, `Web/studio/src-tauri/src/plugins.rs` (verify before unpack).
- Done when: install downloads the tarball, checks the SHA-256 and signature, and refuses a tampered bundle (test with one flipped byte); `uv.lock` and dotfiles are included, so the 256 KiB per-file rule no longer drops them.
- Status (2026-11-14): built. Deterministic gzip tarballs (`Backend/src/bundle.rs`), `plugins/<id>/<sha256>.tar.gz` in S3 via hand-rolled SigV4 (`blobs.rs`, checked against the AWS doc vector and a real S3 server; memory store when `OMNI_S3_*` unset), Ed25519 signature over id/version/sha (`crypto.rs`). Tauri `install_plugin` verifies hash + signature + manifest before writing; the browser installer verifies with WebCrypto. One-flipped-byte tests in `plugins.rs` and `marketplace.test.ts`. The public key is fetched from the registry (`/api/plugin-signing-key`): covers tampered storage/transit, not a compromised registry; pin the key at build time to cover that. NOT DONE: Vultr bucket (human, paid).

### 10.3 Authenticated publish API
Goal: authors publish plugins with an account; versions are kept and installed plugins can update.
- Touches: `Backend/src/api/marketplace.rs`, `Backend/src/api/accounts.rs`, `Backend/src/db.rs`, a new migration (author, version, status), `Web/studio/src/marketplace` (update button, version shown).
- Done when: unauthenticated publish returns 401; a second publish of the same id needs a higher version; the Studio shows "update available" and updates in place; review/moderation state is stored and unreviewed plugins are not listed.
- Status (2026-11-14): built. `POST /api/plugins` takes a gzip tarball; new versions are `pending` until an account in `OMNI_PLUGIN_REVIEWERS` approves; seeded plugins have no author and cannot be published over. Versions are numeric dotted only (`1.2.3`, no pre-release tags). Studio shows "Update to vX" and reinstalls in place. No publish UI in Studio: authors use curl.

### 10.4 Install telemetry
Goal: installs are recorded per account, and uninstall lowers the count (today it only goes up and counts reinstalls).
- Touches: `Backend/src/api/marketplace.rs`, `Backend/src/db.rs`, a new migration (install records per account and plugin), `Web/studio/src/marketplace`.
- Done when: install, reinstall and uninstall leave the count equal to the number of accounts with the plugin installed; a test covers all three.
- Status (2026-11-14): built. `plugin_installs` row per (plugin, account); uninstall marks the row; count = accounts installed now. Signed-out installs are not counted.

### 10.5 Installed-plugin sync across devices
Goal: installed plugins follow the account (cloud projects) instead of per-browser localStorage.
- Touches: `Backend/src/api/marketplace.rs` (list my installs, built on 10.4 records), `Web/studio/src/marketplace`, `Web/studio/src-tauri/src/plugins.rs` (install on a second device).
- Done when: installing on device A shows the plugin as installed on device B after sign-in, and uninstalling on A removes it on B after refresh.
- Status (2026-11-14): built. `GET /api/me/plugins`; Studio syncs on boot, on Refresh and on sign-in; auto-install skips a plugin the account uninstalled elsewhere. Records are per account, not per project.

### 10.6 Hosted agent runtime for browser mode
Goal: browser mode works without a local `uv` process on :9410.
- Touches: `Plugins/langchain-deepagents/runtime`, `Deploy/` (run the runtime beside the backend), `Web/studio/src/marketplace` (runtime URL), `Backend/src/lib.rs` (proxy and auth).
- Done when: a signed-in browser user with no local runtime gets an agent reply; the runtime accepts only authenticated requests; one runtime per project still holds.
- Status (2026-11-14): built. `Deploy/runtime.Dockerfile` + compose `runtime` service (no published port); backend `/agent/ws` + `/agent/health` proxy; runtime hosted mode needs `OMNI_RUNTIME_SECRET`, dir per account/project, per-project lock kept. Signed-in browsers use it; desktop keeps the local runtime with env keys. Checked end to end locally (signed-in client -> backend -> runtime container -> Anthropic answered 401 to a fake key). NOT DONE: a real reply (needs a key, 10.8) and a run on Vultr.

### 10.7 Per-account model API keys
Goal: the model API key is stored per account on the server, not in a local env var.
- Touches: `Backend/src/api/accounts.rs` or a new route, `Backend/src/db.rs`, a new migration (encrypted secret), `Plugins/langchain-deepagents/runtime` (read the key per request), `Web/studio/src/marketplace` (key form).
- Done when: a key saved by one account is used only for that account's requests; it is encrypted at rest and never returned by any API; a test checks both.
- Status (2026-11-14): built. `PUT/GET/DELETE /api/me/model-key`, AES-256-GCM under `OMNI_SECRET_KEY`, key never returned; key form in the Marketplace panel. Used by the hosted runtime only (desktop local runtime still reads env keys).

### 10.8 Live-model verification
Goal: the live AI path is run once for real; today only `OMNI_AGENT_FAKE=1` is exercised.
- Touches: `Plugins/langchain-deepagents/runtime` (default model ids), `docs/agents/progress/omni-marketplace.md` (record results).
- Status: Anthropic and Google keys are untested; OpenAI is blocked on account credits; the Google default model id is unverified.
- Done when: one prompt succeeds per provider (or is recorded as blocked with the reason), the Google default model id is confirmed against the provider's model list, and the demo notes say which providers were run live.
- Status (2026-11-14): Anthropic PASSED on the hosted Vultr runtime (account key saved in the Marketplace panel, real model reply). OpenAI and Google not run yet; Google default model id still unverified. Recorded in `docs/agents/progress/omni-marketplace.md`.

### 10.9 Remaining marketplace fixes (open after PR #162)
- [x] Ship `uv.lock` in bundles: raise `MAX_FILE_BYTES` to 1 MiB in `Backend/src/api/marketplace.rs` (done and tested on branch `agent/tienvu-lol/omni-ws1-registry`; needs review and merge). (2026-11-14: done on main instead: tarball bundles, 1 MiB per file, dotfiles kept; that branch is not on the remote.)
- [x] Seed-time plugin id rule `^[a-z0-9-]{1,64}$` in `read_plugin`; skip and log bad ids.
- [x] `src-tauri/src/plugins.rs`: key `Runtimes` by (project, plugin); `write_bundle` clears the old plugin dir after validation (no stale files on reinstall).
- [x] `Web/studio/src/marketplace/installer.ts`: browser start hint still mentions `OMNI_AGENT_FAKE=1`; remove it (fake mode is gone).
- [x] Runtime: sanitise provider exception text in `error` events (a provider could echo a key); do not hold the project lock while sending to a slow socket.
- [x] Non-Windows `stop_runtime` kills only the direct child; use process groups so `uv` leaves no orphaned python.
- [x] Postgres paths (0002 migrate guard, upsert, installs) have no CI run; add a `DATABASE_URL` job. (2026-11-14: `.github/workflows/backend-postgres.yml`, never run on CI; same tests pass locally on Postgres 17.)
- [ ] Live model run: OpenAI key has no credits; Anthropic and Google untested; Google default model id unverified.

---

## Phase 6: Collaborative Coding Space (stretch)

(Changed 2026-11-14: stretch goal, deferred until Phase 8 is done; come back to it after. Phase 8 below is the active work.)

- [ ] `Packages/OmniCollab/Sources/OmniCollab/ProjectDocument.swift` — CRDT document holding scene graph and every script's source (Automerge for Swift; track version in `branchDep.md` when added). (Also deletes `Module.swift`.)
- [ ] `Packages/OmniCollab/Sources/OmniCollab/PeerSync.swift` — Bonjour peer discovery and change exchange.
- [ ] `Packages/OmniCollab/Sources/OmniCollab/Presence.swift` — collaborator cursors, selections, "who's editing" state. Syncs the project only; never touches input.
- [ ] `Apps/OmniStudio/OmniStudio/Collab/PresenceOverlayView.swift` — cursors in the script editor, selection highlights in the viewport, entity badges.

---

## Cross-Cutting: Hardware verification

Throwaway probes that confirm what each real device delivers before its Phase 3 source is built (not in overview.md's module list; no Omni package deps; results feed `AirPodsMotionSource` and `NoiseModel`; delete or keep after Phase 3).

- [x] `Tools/AirPodsProbe/Package.swift` — standalone SwiftPM executable, macOS 14, embeds `Info.plist` via linker `-sectcreate`.
- [x] `Tools/AirPodsProbe/Info.plist` — bundle id + `NSMotionUsageDescription` for the probe.
- [x] `Tools/AirPodsProbe/Sources/AirPodsProbe/main.swift` — `CMHeadphoneMotionManager` probe: logs raw samples to `.jsonl`, prints rate / interval / gap / latency stats every 2 s and per session, connect/disconnect events, `--selftest` for the stats. (A bare CLI run aborts in TCC — the terminal is the responsible process, so the embedded plist is ignored; launch through `bundle.sh` instead.) (Results 2026-11-14, AirPods 4 on macOS (last run confirmed as product ID 0x201B; earlier runs' pair not recorded): rate 50.0 Hz, interval 20 ms p50/p95; delivery latency p50 ≈20 ms, p95 ≈50 ms (one run p95 112 ms); noise while still: rotation sd ≤0.03 rad/s, user accel sd ≤0.003 g; yaw drift ≈7° over 55 s still, 4° error returning to forward; axes X right / Y forward / Z up (nod +X = up, turn left +Z, left ear down −Y); bud handoff works both ways, with a ~1.3–1.4 s gap, disconnect/connect flapping and a 55–90° orientation jump; case test: first run the AirPods auto-switched to the iPhone and never returned to the Mac (Mac and iPhone auto-switching set off), second run never disconnected (unclear whether the buds reached the closed case), so resume-from-case is unverified and covered by the restart-on-connect note on `AirPodsMotionSource`. FLAGGED: jitter delay D for AirPods could drop to 20–30 ms (fresh sample every 20 ms); not decided. AirPods Pro not tested.)
- [x] `Tools/PhoneProbe.swiftpm/Package.swift` — Xcode app package (`AppleProductTypes` `.iOSApplication`, iOS 17, iPhone + iPad (iPad added 2026-11-14 for the Pencil probe)) with local-network (`_omniprobe._tcp`) and motion purpose strings. (Folder must keep the `.swiftpm` suffix or Xcode builds a bare executable instead of an app; throwaway probe, `_omniprobe._tcp` is not the production service type; results feed `BridgeClient` / `DeviceSession` / `MotionStreamer` and the phone frame conversion.) (Results 2026-11-14, one iPhone on home Wi-Fi and USB: Bonjour + TCP connects automatically in 1–3 s, over the USB cable too (link-local `en7`/`en8`), so unplug it to test Wi-Fi; motion 100.5 Hz at a 100 Hz request, 10 ms device intervals, 0 seq drops in every run; Wi-Fi RTT p50 7–8 ms / p95 17 ms standing, Mac-side arrival gaps p50 10 / p99 22 ms with rare 100–300 ms stalls; walking between rooms: no disconnect and no loss, but bursty delivery (gaps up to 471 ms, RTT up to 318 ms) while moving; axes X right edge / Y top edge / Z out of the screen, same mapping as AirPods; touch 60 events/s; heavy impact haptic delivered every time (ack 8.5 ms Wi-Fi) and felt as a bump; launched from the home screen, backgrounding or locking drops the connection within ~0.5 s and it reconnects ~1 s after returning, with one connect/disconnect flap; with Xcode's debugger attached the app keeps streaming in the background, so test background behavior without it. Not tested: venue Wi-Fi, phone hotspot. Xcode rewrites `Package.swift` when a team is chosen, removing comments and adding `teamIdentifier`.)
- [x] `Tools/PhoneProbe.swiftpm/Sources/PhoneProbe/PhoneProbeApp.swift` — iPhone side: Bonjour browse + TCP (no-delay) to the host, retry on drop; streams `CMMotionManager` device motion at a requested 100 Hz (raw Apple frame, `seq` numbered), touches, scene-phase changes; answers pings and plays a heavy impact haptic per host request with an ack. (2026-11-14: touch moved from a SwiftUI `DragGesture` to a UIKit `TouchSurface` so it also streams Apple Pencil coalesced samples (position, force 0–1, altitude, azimuth, barrel roll on iPadOS 17.5+), hover (`UIHoverGestureRecognizer` zOffset, tilt) and `UIPencilInteraction` squeeze / double-tap; finger touches keep the `touch` message. Pencil results 2026-11-14 on an iPad (M4) with Apple Pencil Pro, iPadOS ≥17.5: contact samples 240 Hz (4.17 ms) via coalesced touches; force covers 0–1; altitude 14–85°, azimuth unstable near vertical; barrel roll works on contact (219° swing tracked), not reported while hovering; hover 60 Hz with `zOffset` normalized 0–1 (not meters); squeeze arrives as began → changed… → ended in ~0.2 s, often twice ~0.25 s apart per squeeze; double-tap one event each; both gestures came through `UIPencilInteraction` only after turning Squeeze and Double-Tap on in Settings → Apple Pencil (both were Off). A SwiftUI `.overlay` of the UIKit surface received no touches at all; the fix was the surface as `.background` with the labels `.allowsHitTesting(false)`. A resting hand shows up as finger touches. Added a `hello` message (device model) and an on-screen surface counter for diagnosis.)
- [x] `Tools/PhoneProbeHost/Package.swift` — standalone SwiftPM executable, macOS 14, no Omni deps.
- [x] `Tools/PhoneProbeHost/Sources/PhoneProbeHost/main.swift` — Mac side: `NWListener` advertising `_omniprobe._tcp`, one phone at a time, newline-JSON logging to `.jsonl`; pings every 0.5 s (RTT, clock offset), haptic every 3 s (ack RTT); prints motion rate / gaps / seq drops / estimated motion latency / touch rate every 2 s and per session; `--selftest` for stats and line splitting. (2026-11-14: also reports Pencil rate / interval, force, altitude and roll ranges, hover z range, squeeze and tap counts when an iPad sends them.)
- [x] `Tools/AirPodsProbe/bundle.sh` — builds the probe into a minimal ad-hoc-signed `.app` and launches it with `open` so TCC reads the probe's own `Info.plist`; tails the log; Ctrl-C stops with a session summary.

---

## Phase 7: After the Hackathon (unscheduled — no checklist)

Open, not scheduled: Lua scripting backend; third-party Bluetooth adapters (Joy-Cons, haptic gloves, ESP32 bands) via `OmniAdapters`; iPad / Pencil and Vision Pro input; player apps on iOS / visionOS (they connect players to the game server, 4.2, through a `RemoteChannel`); relay server for remote collaboration; automatic state replication; permissions, version history and moderation for hosted games. (Changed 2026-11-14: the iOS + macOS library shell moved to Phase 9; running games on the player is still open.)
