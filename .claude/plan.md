# Build Plan

- Checklist, worked top-to-bottom. Each item is exactly one file with a single responsibility — `stage`/`apply` should be able to touch one checklist item without needing to also change any other file. Phases are ordered by dependency (later phases consume earlier ones).
- Paths are relative to the repo root. Packages use SwiftPM layout: `Packages/<Pkg>/Package.swift`, `Sources/<Pkg>/`, `Tests/<Pkg>Tests/`. Dependency rules come from the package table in `overview.md`; any item that bends them carries a parenthetical note.
- Format: `- [ ] \`path\` — responsibility`.

---

## Phase 1: Workspace Scaffold & Core Runtime

Goal: every package exists with its dependency boundary enforced, USIS v1 is defined, and a RealityKit trigger fires from a hard-coded packet.

### 1.1 Workspace & package scaffold
- [x] `Omni.xcworkspace/contents.xcworkspacedata` — workspace referencing every local package and both app projects (Xcode-generated; commit as-is).
- [x] `Packages/OmniCore/Package.swift` — OmniCore manifest, no dependencies. (testTarget `OmniCoreTests` added in Phase 1.2 so `swift test` can run; no other package has a testTarget yet.)
- [x] `Packages/OmniInput/Package.swift` — OmniInput manifest, depends on OmniCore.
- [x] `Packages/OmniOutput/Package.swift` — OmniOutput manifest, depends on OmniCore.
- [x] `Packages/OmniRuntime/Package.swift` — OmniRuntime manifest, depends on OmniCore and OmniInput only.
- [x] `Packages/OmniScript/Package.swift` — OmniScript manifest, depends on OmniRuntime.
- [x] `Packages/OmniScript/Sources/OmniScript/Module.swift` — empty module marker so the target compiles; removed when the first real OmniScript file lands (Phase 2).
- [x] `Packages/OmniSim/Package.swift` — OmniSim manifest, depends on OmniCore, OmniInput, OmniOutput.
- [x] `Packages/OmniSim/Sources/OmniSim/Module.swift` — empty module marker; removed in Phase 2.
- [x] `Packages/OmniBridge/Package.swift` — OmniBridge manifest, depends on OmniCore, OmniInput, OmniOutput.
- [x] `Packages/OmniBridge/Sources/OmniBridge/Module.swift` — empty module marker; removed in Phase 3.
- [x] `Packages/OmniCollab/Package.swift` — OmniCollab manifest (stretch), depends on OmniCore.
- [x] `Packages/OmniCollab/Sources/OmniCollab/Module.swift` — empty module marker; removed in Phase 6.
- [x] `Packages/OmniAdapters/Package.swift` — OmniAdapters manifest (stretch), depends on OmniCore and OmniInput.
- [x] `Packages/OmniAdapters/Sources/OmniAdapters/Module.swift` — empty module marker; stays until Phase 7.

### 1.2 OmniCore — math and USIS types (pure, no I/O)
- [x] `Schema/usis.schema.json` — USIS v1 JSON Schema: envelope (`v`, `deviceId`, `kind`, `slot`, `source`, `t`, `seq`) and channels (orientation, position, accel, touch, gesture, heartRate, pencil). Source of truth for companions, sim and adapters.
- [x] `Packages/OmniCore/Sources/OmniCore/Math/Vector3.swift` — 3-vector value type with lerp, dot, normalize, length. (Double precision, no `simd`, to keep OmniCore Foundation-only; OmniRuntime converts to Float at the RealityKit edge; no direct Vector3 tests scheduled.)
- [x] `Packages/OmniCore/Sources/OmniCore/Math/Quaternion.swift` — unit quaternion `[x,y,z,w]` with multiply, inverse, slerp, yaw-only extraction, angle-between. (Up axis is +Y — a plan decision, not stated in overview.md; CoreMotion reference frames are Z-up, so companions and `AirPodsMotionSource` must convert; yaw-only reads the +Z axis heading, exact for Ry·Rx·Rz with |pitch| < 90°, yaw 0 when +Z is vertical; revisit when Phase 3 sources land.)
- [x] `Packages/OmniCore/Sources/OmniCore/Math/Pose.swift` — position + orientation value type.
- [x] `Packages/OmniCore/Sources/OmniCore/USIS/UsisEnums.swift` — `DeviceKind`, `Slot`, `PacketSource`, `GestureType`, `TouchPhase` string-backed enums matching the schema.
- [x] `Packages/OmniCore/Sources/OmniCore/USIS/UsisChannels.swift` — optional-per-channel Codable struct (a packet carries only changed channels; unknown channels ignored on decode). (`pencil.tip` modelled as Vector3 meters and `hover` as scalar meters — overview.md says only "Meters"; no revisit scheduled.)
- [x] `Packages/OmniCore/Sources/OmniCore/USIS/UsisPacket.swift` — Codable envelope + channels, `v` field versioning. (Decode does not reject `v != 1`; version policy is `PacketValidator` in 1.3.)
- [x] `Packages/OmniCore/Sources/OmniCore/Frame/InputFrame.swift` — world-space per-frame snapshot, no `source` field (InputFrame lives in OmniCore, not OmniInput, so OmniRuntime can consume it without depending on more than OmniInput's protocols — overview.md names the type but not its package; no revisit scheduled). (Shape is `InputFrame { timestamp, devices: [DeviceSample] }` with per-device world-space channels and a `stale` flag — overview.md does not specify it; no revisit scheduled.)
- [x] `Packages/OmniCore/Sources/OmniCore/Output/OutputCommand.swift` — `{ target, type: haptic|audio, pattern, intensity, durationMs }` Codable (lives in OmniCore so OmniRuntime can queue commands without depending on OmniOutput; the `OutputSink` protocol stays in OmniOutput per overview.md). (No envelope fields (`v`/`t`/`seq`) — overview.md says "same envelope rules as USIS" without listing them; intensity clamped to 0–1 and durationMs floored at 0 on init and decode; revisit if the wire protocol in 3.1 needs sequencing.)
- [x] `Packages/OmniCore/Tests/OmniCoreTests/QuaternionTests.swift` — slerp, inverse, yaw-only extraction against known values.
- [x] `Packages/OmniCore/Tests/OmniCoreTests/UsisPacketTests.swift` — encode/decode round-trip of the overview.md example packet; unknown channels ignored; partial channels. (Also covers `OutputCommand` round-trip and clamping, since no separate test item exists for it.)

### 1.3 OmniInput — protocols, validation, pipeline
- [ ] `Packages/OmniInput/Sources/OmniInput/InputSource.swift` — `InputSource` protocol: emits `UsisPacket`s, declares device descriptor (kind, slot, sample rate).
- [ ] `Packages/OmniInput/Sources/OmniInput/InputBus.swift` — `InputBus` protocol: accepts packets from any source, serves `InputFrame`s.
- [ ] `Packages/OmniInput/Sources/OmniInput/PacketValidator.swift` — decode + schema-conformance check of raw JSON; invalid packets dropped and counted (hand-written Swift mirror of `Schema/usis.schema.json`, kept honest by the validator test).
- [ ] `Packages/OmniInput/Sources/OmniInput/ClockSync.swift` — ping-exchange offset estimate `t_host − (t_send + rtt/2)`, periodic re-estimate, device→host time conversion.
- [ ] `Packages/OmniInput/Sources/OmniInput/JitterBuffer.swift` — per-device ring buffer; sample at `t_render = now − D` (D=50 ms default, tunable); slerp orientation, lerp vectors, sample-and-hold + EMA scalars; stale after 500 ms.
- [ ] `Packages/OmniInput/Sources/OmniInput/Calibration.swift` — capture `q_cal`, apply `q_world = q_cal⁻¹ · q_raw`; yaw-only mode for AirPods.
- [ ] `Packages/OmniInput/Sources/OmniInput/CapabilityTier.swift` — Tier 1/2/3 definitions and "can these devices satisfy tier N" check.
- [ ] `Packages/OmniInput/Sources/OmniInput/DeviceStats.swift` — per-device rate, latency, seq-gap count, stale flag, schema-error count (feeds Studio debug overlay; the only place `source` is retained).
- [ ] `Packages/OmniInput/Sources/OmniInput/InputPipeline.swift` — concrete `InputBus`: ingest → validate → clock-convert → buffer; per-frame sample → calibrate → build `InputFrame` with `source` stripped.
- [ ] `Packages/OmniInput/Tests/OmniInputTests/PacketValidatorTests.swift` — valid/invalid packets, versioning, drop counting.
- [ ] `Packages/OmniInput/Tests/OmniInputTests/ClockSyncTests.swift` — offset estimate with synthetic rtt and skew.
- [ ] `Packages/OmniInput/Tests/OmniInputTests/JitterBufferTests.swift` — interpolation at mixed rates, hold, stale-freeze.
- [ ] `Packages/OmniInput/Tests/OmniInputTests/CalibrationTests.swift` — world-frame result after a calibration tap; yaw-only.
- [ ] `Packages/OmniInput/Tests/OmniInputTests/SourceStrippingTests.swift` — asserts `InputFrame` carries no source information.

### 1.4 OmniOutput
- [ ] `Packages/OmniOutput/Sources/OmniOutput/OutputSink.swift` — `OutputSink` protocol: receives `OutputCommand`s and delivers them to live devices or the simulator.

### 1.5 OmniRuntime — scene runner and first trigger
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Components/TriggerComponent.swift` — RealityKit component: collision-volume trigger with enter/exit callbacks.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Components/AudioEmitterComponent.swift` — RealityKit component: named spatial sound attached to an entity.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Components/ScriptComponent.swift` — RealityKit component: names the script attached to an entity.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Events/GameEvent.swift` — `onLookAt`, `onGesture`, `onHeartRate`, `onRaycastHit` event enum.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Events/EventDispatcher.swift` — protocol the runtime calls to deliver events to a script backend (lets OmniScript plug in without the runtime depending on it).
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Systems/TriggerSystem.swift` — RealityKit system resolving trigger overlaps each update.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Output/OutputQueue.swift` — collects `OutputCommand`s during a frame; flushed once at end of frame.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/SceneRunner.swift` — per-frame loop: take `InputFrame` → derive events → dispatch → resolve triggers → flush output queue. Never reads sockets, device APIs or sim state.
- [ ] `Packages/OmniRuntime/Tests/OmniRuntimeTests/SceneRunnerTriggerTests.swift` — hard-coded USIS packet through `InputPipeline` into `SceneRunner` fires a trigger (Phase 1 exit test).

### 1.6 OmniStudio shell
- [ ] `Apps/OmniStudio/OmniStudio.xcodeproj/project.pbxproj` — macOS app project linking the local packages (Xcode-generated).
- [ ] `Apps/OmniStudio/OmniStudio/OmniStudioApp.swift` — SwiftUI app entry, single window.
- [ ] `Apps/OmniStudio/OmniStudio/Viewport/ViewportView.swift` — `RealityView` hosting the `SceneRunner` scene; shows the hard-coded-packet trigger firing.

---

## Phase 2: 3D Device Simulator

Goal: a creator can exercise every mechanic on a Mac alone; jitter buffer and derived events are proven against simulated input before any live device exists. Also covers OmniScript, which `overview.md` does not assign to a phase (scheduled here so Phase 4 builds on a finished API; revisit only if scope forces it later).

### 2.1 OmniRuntime — derived events
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Events/LookAtDetector.swift` — head forward `f` vs direction to entity `ŝ`; fires `onLookAt` when `acos(f·ŝ) < θ_lock` (15°) held for 0.5 s.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Events/GestureEventMapper.swift` — maps gesture channels from any device to `onGesture(type, dir?)`.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Events/HeartRateIntensity.swift` — `d = clamp((HR − HR_rest)/(HR_max − HR_rest), 0, 1)` and `onHeartRate` emission.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Events/RaycastHitDetector.swift` — `onRaycastHit` from phone aim or simulator gaze via RealityKit raycast.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Systems/AudioListenerSystem.swift` — moves the RealityKit audio listener with head pose from `InputFrame`.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Scene/SceneDescription.swift` — Codable declarative scene (entities, transforms, components, script names) (scene file format is not specified in overview.md; proposed here, confirm before building on it).
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Scene/SceneLoader.swift` — builds RealityKit entities and components from a `SceneDescription`.
- [ ] `Packages/OmniRuntime/Tests/OmniRuntimeTests/LookAtDetectorTests.swift` — threshold, dwell time, reset when gaze leaves.
- [ ] `Packages/OmniRuntime/Tests/OmniRuntimeTests/HeartRateIntensityTests.swift` — clamping and normalization.

### 2.2 OmniSim — virtual devices and recording
- [ ] `Packages/OmniSim/Sources/OmniSim/NoiseModel.swift` — per-device sample rate and noise parameters roughly matching real hardware (AirPods ~50 Hz, Watch 1–10 Hz, phone 60–120 Hz).
- [ ] `Packages/OmniSim/Sources/OmniSim/VirtualDevice.swift` — base `InputSource` + `OutputSink`-receiving virtual device; stamps `source: "sim"`, advances `seq`, emits at its sample rate.
- [ ] `Packages/OmniSim/Sources/OmniSim/Devices/VirtualAirPods.swift` — head orientation source, slot `head`.
- [ ] `Packages/OmniSim/Sources/OmniSim/Devices/VirtualWatch.swift` — wrist orientation, heart rate, gesture source.
- [ ] `Packages/OmniSim/Sources/OmniSim/Devices/VirtualPhone.swift` — orientation, accel, touch source.
- [ ] `Packages/OmniSim/Sources/OmniSim/Devices/VirtualPencil.swift` — tip, pressure, roll, hover source.
- [ ] `Packages/OmniSim/Sources/OmniSim/Recording/UsisRecorder.swift` — writes packets to `.usis.jsonl`, one per line.
- [ ] `Packages/OmniSim/Sources/OmniSim/Recording/UsisPlayer.swift` — replays a `.usis.jsonl` file as an `InputSource` with original timing.
- [ ] `Packages/OmniSim/Sources/OmniSim/Presets/PresetLibrary.swift` — lists and loads bundled gesture presets.
- [ ] `Packages/OmniSim/Sources/OmniSim/Presets/airpods-head-pitch.usis.jsonl` — recorded preset: AirPods head pitch.
- [ ] `Packages/OmniSim/Sources/OmniSim/Presets/watch-double-tap.usis.jsonl` — recorded preset: Watch double-tap.
- [ ] `Packages/OmniSim/Sources/OmniSim/Presets/watch-flick.usis.jsonl` — recorded preset: Watch flick.
- [ ] `Packages/OmniSim/Sources/OmniSim/Presets/pencil-barrel-roll.usis.jsonl` — recorded preset: Pencil barrel roll.
- [ ] `Packages/OmniSim/Sources/OmniSim/Rig/SensorRigScene.swift` — RealityKit avatar with device slots (head, wrists, hand, pocket, stylus); clicking a slot spawns a virtual device.
- [ ] `Packages/OmniSim/Sources/OmniSim/Rig/GizmoController.swift` — transform gizmos and sliders driving a virtual device's orientation and position.
- [ ] `Packages/OmniSim/Sources/OmniSim/Rig/GazeRaycaster.swift` — mouse-driven gaze ray from the head; click emits pinch.
- [ ] `Packages/OmniSim/Sources/OmniSim/Feedback/SimOutputSink.swift` — `OutputSink` that shows haptic and audio commands on the virtual device (pulse ring, vibration icon, sound cone).
- [ ] `Packages/OmniSim/Tests/OmniSimTests/UsisRecorderPlayerTests.swift` — record → replay round-trip preserves packets and timing.
- [ ] `Packages/OmniSim/Tests/OmniSimTests/NoiseModelTests.swift` — emitted rates and noise within tolerance of the declared model (exercises the jitter buffer in Sim mode).

### 2.3 OmniScript — creator scripting API
- [ ] `Packages/OmniScript/Sources/OmniScript/Resources/prelude.js` — defines `script({...})` and handles `export default` for JavaScriptCore (which has no ES module loader).
- [ ] `Packages/OmniScript/Sources/OmniScript/SelfBridge.swift` — `JSExport` surface for `self` (audio, speed, entity state).
- [ ] `Packages/OmniScript/Sources/OmniScript/ContextBridge.swift` — `JSExport` surface for `ctx` (`spawn`, `intensity`, output commands); no file, network or raw USIS access.
- [ ] `Packages/OmniScript/Sources/OmniScript/ScriptEngine.swift` — sandboxed `JSContext`; implements `EventDispatcher` to call `onLookAt`/`onGesture`/`onHeartRate`/`onRaycastHit` handlers.
- [ ] `Packages/OmniScript/Sources/OmniScript/ScriptReloader.swift` — recompiles a script on source change without restarting the scene.
- [ ] `Packages/OmniScript/Tests/OmniScriptTests/ScriptEngineTests.swift` — handler dispatch, sandbox isolation, error containment, hot reload.

### 2.4 OmniStudio — simulator UI
- [ ] `Apps/OmniStudio/OmniStudio/Sim/SimulatorPanelView.swift` — device slot picker, gizmos/sliders, heart-rate slider, "spike" button, preset buttons, record/replay controls.
- [ ] `Apps/OmniStudio/OmniStudio/Debug/DebugOverlayView.swift` — live raw USIS JSON per device: rate, latency, stale flags, source, schema errors.
- [ ] `Apps/OmniStudio/OmniStudio/Debug/CapabilityWarningView.swift` — warns when connected or simulated devices cannot satisfy the game's declared capability tier.

---

## Phase 3: Live Hardware Bridge

Goal: real devices stream USIS into the same pipeline; Sim ↔ Live is a one-click toggle with zero game-code changes.

### 3.1 OmniCore — wire protocol (shared with companions)
- [ ] `Packages/OmniCore/Sources/OmniCore/Wire/WireMessage.swift` — non-packet messages on the link: `hello`, `ping`, `pong`, `output` (companions depend only on OmniCore, so wire types live here).
- [ ] `Packages/OmniCore/Sources/OmniCore/Wire/LineFraming.swift` — newline-delimited JSON framing over a byte stream (pure buffer split/join, no I/O).
- [ ] `Packages/OmniCore/Tests/OmniCoreTests/LineFramingTests.swift` — partial reads, multiple messages per read, oversized lines.

### 3.2 OmniBridge — Mac side
- [ ] `Packages/OmniBridge/Sources/OmniBridge/BonjourListener.swift` — `NWListener` advertising the Omni Bonjour service on the local network only.
- [ ] `Packages/OmniBridge/Sources/OmniBridge/DeviceSession.swift` — one `NWConnection` per device: framing, `hello`, ping/pong for clock sync, packet decode, seq-gap reporting.
- [ ] `Packages/OmniBridge/Sources/OmniBridge/BridgeInputSource.swift` — `InputSource` merging all device sessions onto the `InputBus` (stamps `source: "live"`).
- [ ] `Packages/OmniBridge/Sources/OmniBridge/BridgeOutputSink.swift` — `OutputSink` forwarding `OutputCommand`s to the addressed device session.
- [ ] `Packages/OmniBridge/Sources/OmniBridge/AirPodsMotionSource.swift` — `CMHeadphoneMotionManager` → USIS `head` packets directly on the Mac.
- [ ] `Packages/OmniBridge/Tests/OmniBridgeTests/DeviceSessionTests.swift` — loopback session: hello, ping/pong, dropped-device goes stale rather than stopping the loop.

### 3.3 OmniCompanion — iOS
- [ ] `Apps/OmniCompanion/OmniCompanion.xcodeproj/project.pbxproj` — iOS + watchOS app project depending on OmniCore only (Xcode-generated).
- [ ] `Apps/OmniCompanion/Shared/BridgeClient.swift` — Bonjour browse + `NWConnection` to the Mac; auto-reconnect with backoff; answers pings.
- [ ] `Apps/OmniCompanion/iOS/OmniCompanionApp.swift` — app entry and connection state UI.
- [ ] `Apps/OmniCompanion/iOS/MotionStreamer.swift` — CoreMotion orientation + accel → USIS packets (changed channels only).
- [ ] `Apps/OmniCompanion/iOS/TouchCapture.swift` — normalized touch events (began/moved/ended) → USIS `touch` channel.
- [ ] `Apps/OmniCompanion/iOS/HapticPlayer.swift` — plays Core Haptics patterns from received `output` messages.

### 3.4 OmniCompanion — watchOS (P1, if time allows)
- [ ] `Apps/OmniCompanion/watchOS/WatchApp.swift` — watchOS app entry.
- [ ] `Apps/OmniCompanion/watchOS/HeartRateWorkout.swift` — HealthKit workout session streaming heart rate.
- [ ] `Apps/OmniCompanion/watchOS/WristGestureDetector.swift` — wrist gestures (tap, double-tap, flick, squeeze, pinch) from motion/accessibility APIs.
- [ ] `Apps/OmniCompanion/watchOS/WatchRelay.swift` — sends Watch packets to the phone via WatchConnectivity.
- [ ] `Apps/OmniCompanion/iOS/WatchConnectivityReceiver.swift` — receives Watch packets on the phone and forwards them over `BridgeClient`.

### 3.5 OmniStudio — Live mode
- [ ] `Apps/OmniStudio/OmniStudio/Mode/ModeController.swift` — Sim / Live toggle: swaps the active `InputSource`/`OutputSink` pair on the `InputBus`; nothing in the runtime changes.
- [ ] `Apps/OmniStudio/OmniStudio/Mode/ModeToggleView.swift` — toolbar toggle bound to `ModeController`.
- [ ] `Apps/OmniStudio/OmniStudio/Devices/DeviceStatusView.swift` — connected devices, battery/rate/latency, stale indicators.
- [ ] `Apps/OmniStudio/OmniStudio/Devices/CalibrationControls.swift` — "face forward and tap" calibration flow; yaw-only for AirPods.

---

## Phase 4: Flagship Game

Goal: a game playable by a stranger in under 60 s using at least two input types, built only through the public runtime and script API. Name and design are unscheduled (`<Flagship>` placeholder).

- [ ] `Games/Flagship/scene.json` — `SceneDescription` for the game world.
- [ ] `Games/Flagship/scripts/enemy.js` — enemy behavior: `onLookAt` audio lock-on, `onHeartRate` aggression scaling.
- [ ] `Games/Flagship/scripts/player.js` — player abilities: `onGesture` actions, haptic feedback via `ctx`.
- [ ] `Games/Flagship/scripts/game.js` — win/lose flow and difficulty tuning.
- [ ] `Apps/OmniStudio/OmniStudio/Scripting/ScriptEditorView.swift` — script editor with hot reload through `ScriptReloader`.
- [ ] `Apps/OmniStudio/OmniStudio/Inspector/InspectorView.swift` — entity inspector for components and script assignment.

Not file-bound: sound design, visuals and feedback polish (no gray boxes); playtest with someone who has never seen it.

---

## Phase 5: Demo Hardening

- [ ] `Recordings/demo-fallback.usis.jsonl` — recorded full-play input session for the offline fallback demo.
- [ ] `Apps/OmniStudio/OmniStudio/Mode/DemoMode.swift` — one-switch replay of the fallback recording through `UsisPlayer`.

Not file-bound: local hotspot setup, pre-paired devices, recorded fallback video, five clean demo runs in a row.

---

## Phase 6: Collaborative Coding Space (stretch)

- [ ] `Packages/OmniCollab/Sources/OmniCollab/ProjectDocument.swift` — CRDT document holding scene graph and every script's source (Automerge for Swift; track version in `branchDep.md` when added).
- [ ] `Packages/OmniCollab/Sources/OmniCollab/PeerSync.swift` — Bonjour peer discovery and change exchange.
- [ ] `Packages/OmniCollab/Sources/OmniCollab/Presence.swift` — collaborator cursors, selections, "who's editing" state. Syncs the project only; never touches input.
- [ ] `Apps/OmniStudio/OmniStudio/Collab/PresenceOverlayView.swift` — cursors in the script editor, selection highlights in the viewport, entity badges.

---

## Phase 7: After the Hackathon (unscheduled — no checklist)

Open, not scheduled: Lua scripting backend; third-party Bluetooth adapters (Joy-Cons, haptic gloves, ESP32 bands) via `OmniAdapters`; iPad / Pencil and Vision Pro input; player apps on iOS / visionOS; relay server for remote collaboration; multiplayer gameplay; publishing.
