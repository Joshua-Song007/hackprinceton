# Build Plan

- Checklist, worked top-to-bottom. Each item is exactly one file with a single responsibility — `stage`/`apply` should be able to touch one checklist item without needing to also change any other file. Phases are ordered by dependency (later phases consume earlier ones).
- Paths are relative to the repo root. Packages use SwiftPM layout: `Packages/<Pkg>/Package.swift`, `Sources/<Pkg>/`, `Tests/<Pkg>Tests/`. Dependency rules come from the package table in `overview.md`; any item that bends them carries a parenthetical note.
- Format: `- [ ] \`path\` — responsibility`.

---

## Phase 1: Workspace Scaffold & Core Runtime

Goal: every package exists with its dependency boundary enforced, USIS v1 is defined, and a RealityKit trigger fires from a hard-coded packet.

### 1.1 Workspace & package scaffold
- [x] `Omni.xcworkspace/contents.xcworkspacedata` — workspace referencing every local package and both app projects (Xcode-generated; commit as-is). (Refs to `Apps/OmniStudio/OmniStudio.xcodeproj` (1.6) and `Apps/OmniCompanion/OmniCompanion.xcodeproj` (3.3) dangle until those files are created; no revisit needed.)
- [x] `Packages/OmniCore/Package.swift` — OmniCore manifest, no dependencies. (testTarget `OmniCoreTests` added in Phase 1.2 so `swift test` can run; no other package has a testTarget yet.)
- [x] `Packages/OmniInput/Package.swift` — OmniInput manifest, depends on OmniCore. (testTarget `OmniInputTests` added in 1.3.)
- [x] `Packages/OmniOutput/Package.swift` — OmniOutput manifest, depends on OmniCore.
- [x] `Packages/OmniRuntime/Package.swift` — OmniRuntime manifest, depends on OmniCore and OmniInput only. (testTarget `OmniRuntimeTests` added in 1.5.)
- [x] `Packages/OmniScript/Package.swift` — OmniScript manifest, depends on OmniRuntime. (testTarget `OmniScriptTests` to be added when the first test file lands, 2.3; declare `Resources/prelude.js` as a resource when it lands, 2.3.)
- [x] `Packages/OmniScript/Sources/OmniScript/Module.swift` — empty module marker so the target compiles; removed when the first real OmniScript file lands (Phase 2).
- [x] `Packages/OmniSim/Package.swift` — OmniSim manifest, depends on OmniCore, OmniInput, OmniOutput. (testTarget `OmniSimTests` to be added when the first test file lands, 2.2; declare the four `Presets/*.usis.jsonl` as resources, one explicit entry per file so `PresetLibrary.swift` stays a compiled source — verify when added, 2.2.)
- [x] `Packages/OmniSim/Sources/OmniSim/Module.swift` — empty module marker; removed in Phase 2.
- [x] `Packages/OmniBridge/Package.swift` — OmniBridge manifest, depends on OmniCore, OmniInput, OmniOutput. (testTarget `OmniBridgeTests` to be added when the first test file lands, 3.2.)
- [x] `Packages/OmniBridge/Sources/OmniBridge/Module.swift` — empty module marker; removed in Phase 3.
- [x] `Packages/OmniCollab/Package.swift` — OmniCollab manifest (stretch), depends on OmniCore.
- [x] `Packages/OmniCollab/Sources/OmniCollab/Module.swift` — empty module marker; removed in Phase 6.
- [x] `Packages/OmniAdapters/Package.swift` — OmniAdapters manifest (stretch), depends on OmniCore and OmniInput.
- [x] `Packages/OmniAdapters/Sources/OmniAdapters/Module.swift` — empty module marker; stays until Phase 7.
- [x] `.gitignore` — ignores `.build/`, `.swiftpm/`, `xcuserdata/` and `.DS_Store` so SwiftPM and Xcode output stays out of the repo (the file already existed but was empty, so only its contents are added; git itself is not touched).

### 1.2 OmniCore — math and USIS types (pure, no I/O)
- [x] `Schema/usis.schema.json` — USIS v1 JSON Schema: envelope (`v`, `deviceId`, `kind`, `slot`, `source`, `t`, `seq`) and channels (orientation, position, accel, touch, gesture, heartRate, pencil). Source of truth for companions, sim and adapters.
- [x] `Packages/OmniCore/Sources/OmniCore/Math/Vector3.swift` — 3-vector value type with lerp, dot, normalize, length. (Double precision, no `simd`, to keep OmniCore Foundation-only; OmniRuntime converts to Float at the RealityKit edge; no direct Vector3 tests scheduled.)
- [x] `Packages/OmniCore/Sources/OmniCore/Math/Quaternion.swift` — unit quaternion `[x,y,z,w]` with multiply, inverse, slerp, yaw-only extraction, angle-between. (Up axis is +Y — a plan decision, not stated in overview.md; CoreMotion reference frames are Z-up, so companions and `AirPodsMotionSource` must convert; yaw-only reads the +Z axis heading, exact for Ry·Rx·Rz with |pitch| < 90°, yaw 0 when +Z is vertical; revisit when Phase 3 sources land.) (Changed 2026-11-14: forward is −Z, right +X, up +Y (RealityKit convention), now stated in overview.md (Module 1, Coordinate Frame). AirPods frame measured as X right / Y forward / Z up, so `AirPodsMotionSource` maps vectors `(x, y, z) → (x, z, −y)` and quaternions `[x, y, z, w] → [x, z, −y, w]`; see the AirPodsProbe item. iPhone/Watch frames not yet measured.)
- [x] `Packages/OmniCore/Sources/OmniCore/Math/Pose.swift` — position + orientation value type.
- [x] `Packages/OmniCore/Sources/OmniCore/USIS/UsisEnums.swift` — `DeviceKind`, `Slot`, `PacketSource`, `GestureType`, `TouchPhase` string-backed enums matching the schema.
- [x] `Packages/OmniCore/Sources/OmniCore/USIS/UsisChannels.swift` — optional-per-channel Codable struct (a packet carries only changed channels; unknown channels ignored on decode). (`pencil.tip` modelled as Vector3 meters and `hover` as scalar meters — overview.md says only "Meters"; no revisit scheduled.)
- [x] `Packages/OmniCore/Sources/OmniCore/USIS/UsisPacket.swift` — Codable envelope + channels, `v` field versioning. (Decode does not reject `v != 1`; version policy is `PacketValidator` in 1.3.)
- [x] `Packages/OmniCore/Sources/OmniCore/Frame/InputFrame.swift` — world-space per-frame snapshot, no `source` field (InputFrame lives in OmniCore, not OmniInput, so OmniRuntime can consume it without depending on more than OmniInput's protocols — overview.md names the type but not its package; no revisit scheduled). (Shape is `InputFrame { timestamp, devices: [DeviceSample] }` with per-device world-space channels and a `stale` flag — overview.md does not specify it; no revisit scheduled.)
- [x] `Packages/OmniCore/Sources/OmniCore/Output/OutputCommand.swift` — `{ target, type: haptic|audio, pattern, intensity, durationMs }` Codable (lives in OmniCore so OmniRuntime can queue commands without depending on OmniOutput; the `OutputSink` protocol stays in OmniOutput per overview.md). (No envelope fields (`v`/`t`/`seq`) — overview.md says "same envelope rules as USIS" without listing them; intensity clamped to 0–1 and durationMs floored at 0 on init and decode; revisit if the wire protocol in 3.1 needs sequencing.)
- [x] `Packages/OmniCore/Tests/OmniCoreTests/QuaternionTests.swift` — slerp, inverse, yaw-only extraction against known values.
- [x] `Packages/OmniCore/Tests/OmniCoreTests/UsisPacketTests.swift` — encode/decode round-trip of the overview.md example packet; unknown channels ignored; partial channels. (Also covers `OutputCommand` round-trip and clamping, since no separate test item exists for it.)

### 1.3 OmniInput — protocols, validation, pipeline
- [x] `Packages/OmniInput/Sources/OmniInput/InputSource.swift` — `InputSource` protocol: emits `UsisPacket`s, declares device descriptor (kind, slot, sample rate). (Push model: a source is started with the `InputBus` via `start(bus:)` and calls `ingest` / `recordClockSample` on it; `DeviceDescriptor` also declares the channels a device provides.)
- [x] `Packages/OmniInput/Sources/OmniInput/InputBus.swift` — `InputBus` protocol: accepts packets from any source, serves `InputFrame`s. (Also carries `recordClockSample` so sources can report ping exchanges; calibration and stats live on the concrete `InputPipeline`, not on the protocol.)
- [x] `Packages/OmniInput/Sources/OmniInput/PacketValidator.swift` — decode + schema-conformance check of raw JSON; invalid packets dropped and counted (hand-written Swift mirror of `Schema/usis.schema.json`, kept honest by the validator test). (Enforces the schema rules `UsisPacket` decoding does not: `v == 1`, `t`/`seq` ≥ 0, non-empty `deviceId`, unit-norm quaternion within tolerance, touch `x`/`y` in 0–1, pencil `pressure` in 0–1, `heartRate` ≥ 0.) (Stateless: drop counting lives in `InputPipeline` / `DeviceStats`; also rejects a `deviceId` longer than 128 characters.)
- [x] `Packages/OmniInput/Sources/OmniInput/ClockSync.swift` — ping-exchange offset estimate `t_host − (t_send + rtt/2)`, periodic re-estimate, device→host time conversion. (Uses the lowest-rtt sample of the last 8 within 30 s; host time is monotonic uptime, and before the first ping the first packet anchors the device clock — plan decision, overview.md specifies neither; no revisit scheduled.)
- [x] `Packages/OmniInput/Sources/OmniInput/JitterBuffer.swift` — per-device ring buffer; sample at `t_render = now − D` (D=50 ms default, tunable); slerp orientation, lerp vectors, sample-and-hold + EMA scalars; stale after 500 ms. (The overview's "ring buffer" is implemented as time-pruned, size-capped sorted arrays per channel; gestures and touches are queued events delivered once (late ones on the next frame, events older than 1 s discarded); heart-rate EMA is time-based with τ = 1 s; no revisit scheduled.)
- [x] `Packages/OmniInput/Sources/OmniInput/Calibration.swift` — capture `q_cal`, apply `q_world = q_cal⁻¹ · q_raw`; yaw-only mode for AirPods. (Position and accel are not calibrated; AirPods default to yaw-only.)
- [x] `Packages/OmniInput/Sources/OmniInput/CapabilityTier.swift` — Tier 1/2/3 definitions and "can these devices satisfy tier N" check. (Orientation is the baseline for every tier and touch is required by none, since overview.md lists AirPods as Tier 1; Tier 2 = orientation + position, Tier 3 = orientation + heartRate; hand tracking and gaze have no USIS v1 channel so they are not checked — plan decision.)
- [x] `Packages/OmniInput/Sources/OmniInput/DeviceStats.swift` — per-device rate, latency, seq-gap count, stale flag, schema-error count (feeds Studio debug overlay; the only place `source` is retained).
- [x] `Packages/OmniInput/Sources/OmniInput/InputPipeline.swift` — concrete `InputBus`: ingest → validate → clock-convert → buffer; per-frame sample → calibrate → build `InputFrame` with `source` stripped. (State is guarded by a `Mutex` (Synchronization) rather than an actor because RealityKit updates are synchronous; tracks at most 16 devices and counts rejected ones; ping results that arrive before a device's first packet are held until it appears.)
- [x] `Packages/OmniInput/Tests/OmniInputTests/PacketValidatorTests.swift` — valid/invalid packets, versioning, drop counting. (Drop counting is exercised through `InputPipeline`.)
- [x] `Packages/OmniInput/Tests/OmniInputTests/ClockSyncTests.swift` — offset estimate with synthetic rtt and skew.
- [x] `Packages/OmniInput/Tests/OmniInputTests/JitterBufferTests.swift` — interpolation at mixed rates, hold, stale-freeze.
- [x] `Packages/OmniInput/Tests/OmniInputTests/CalibrationTests.swift` — world-frame result after a calibration tap; yaw-only.
- [x] `Packages/OmniInput/Tests/OmniInputTests/SourceStrippingTests.swift` — asserts `InputFrame` carries no source information.

### 1.4 OmniOutput
- [x] `Packages/OmniOutput/Sources/OmniOutput/OutputSink.swift` — `OutputSink` protocol: receives `OutputCommand`s and delivers them to live devices or the simulator. (Synchronous, non-throwing batch `send`; implementations must be thread-safe and cannot be `@MainActor` classes (checked by compile); delivery failures are the sink's to count; no test item since it is a bare protocol, exercised by its first two implementations in 2.2 and 3.2.)

### 1.5 OmniRuntime — scene runner and first trigger
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Components/TriggerComponent.swift` — RealityKit component: collision-volume trigger with enter/exit callbacks. (The volume is a plain shape tested by `TriggerSystem` with its own math, not RealityKit collision — overview.md says "RealityKit collision for triggers"; chosen so triggers resolve inside `SceneRunner.step` in the overview's frame order and run headless; `CollisionComponent` is added for raycasts in 2.1; `probeSlots` defaults to `[.head]` because overview.md does not say what enters a trigger; user decision, revisit only if physics-based triggers are wanted.)
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Components/AudioEmitterComponent.swift` — RealityKit component: named spatial sound attached to an entity. (Data only: no plan item plays the sound yet, so `self.audio.play` in 2.3 needs a playback path; unscheduled, no revisit scheduled.)
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Components/ScriptComponent.swift` — RealityKit component: names the script attached to an entity.
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Events/GameEvent.swift` — `onLookAt`, `onGesture`, `onHeartRate`, `onRaycastHit` event enum. (Also has `triggerEntered` / `triggerExited` so data-only games can react to triggers; overview.md lists only the four input events, so the overview.md update is pending on user request.)
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Events/EventDispatcher.swift` — protocol the runtime calls to deliver events to a script backend (lets OmniScript plug in without the runtime depending on it). (Main-actor; always receives a concrete entity that carries a `ScriptComponent`.)
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Events/EventDeriver.swift` — protocol the 2.1 detectors conform to; `SceneRunner` asks each registered deriver for `GameEvent`s every step (extension point so `SceneRunner.swift` is not edited in 2.1; added after the audit, not in overview.md).
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Systems/TriggerSystem.swift` — RealityKit system resolving trigger overlaps each update. (ECS-style system called by `SceneRunner`, not a registered `RealityKit.System`, for a fixed frame order and headless tests; returns the trigger `GameEvent`s.)
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/Output/OutputQueue.swift` — collects `OutputCommand`s during a frame; drained once at end of frame by the caller (Studio), never by the runtime.
- [x] `Packages/OmniRuntime/Sources/OmniRuntime/SceneRunner.swift` — per-frame loop: take `InputFrame` → derive events → dispatch → resolve triggers → expose queued `OutputCommand`s for the caller to drain (the runtime never sees a sink). Never reads sockets, device APIs or sim state. (Main-actor; order is derive events → dispatch → resolve triggers → dispatch trigger events; derivers are registered on `derivers`.)
- [x] `Packages/OmniRuntime/Tests/OmniRuntimeTests/SceneRunnerTriggerTests.swift` — hard-coded USIS packet through `InputPipeline` into `SceneRunner` fires a trigger (Phase 1 exit test). (18 tests; also covers `probeSlots`, stale probes, rotated and nested volumes, event routing to scripts and `OutputQueue`.)

### 1.6 OmniStudio shell
- [ ] `Apps/OmniStudio/OmniStudio.xcodeproj/project.pbxproj` — macOS app project linking the local packages (Xcode-generated).
- [ ] `Apps/OmniStudio/OmniStudio/OmniStudioApp.swift` — SwiftUI app entry, single window.
- [ ] `Apps/OmniStudio/OmniStudio/AppModel.swift` — composition root: builds `InputPipeline`, `SceneRunner` (plus `ScriptEngine` once it exists, 2.3) and the sim `InputSource` / `OutputSink` pair for Phase 2; runs the per-frame loop and drains `OutputQueue` into the active sink (name and placement are a plan decision; `ModeController` takes over source/sink selection in 3.5).
- [ ] `Apps/OmniStudio/OmniStudio/Viewport/ViewportView.swift` — `RealityView` hosting the `SceneRunner` scene; shows the hard-coded-packet trigger firing; reads its scene from `AppModel`.

---

## Phase 2: 3D Device Simulator

Goal: a creator can exercise every mechanic on a Mac alone; the jitter buffer is proven against simulated input (OmniSim tests) and derived events against hand-built `InputFrame`s (OmniRuntime tests) before any live device exists; OmniSim cannot depend on OmniRuntime, so no single sim-to-events test is scheduled. Also covers OmniScript, which `overview.md` does not assign to a phase (scheduled here so Phase 4 builds on a finished API; revisit only if scope forces it later).

### 2.1 OmniRuntime — derived events
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Events/LookAtDetector.swift` — head forward `f` vs direction to entity `ŝ`; fires `onLookAt` when `acos(f·ŝ) < θ_lock` (15°) held for 0.5 s. (Head position = the head sample's `position` when present, else `SceneDescription.playerOrigin` — plan decision, overview.md is silent.) (Head forward is −Z: usis.schema.json documents +X right, +Y up, −Z forward.)
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Events/GestureEventMapper.swift` — maps gesture channels from any device to `onGesture(type, dir?)`.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Events/HeartRateIntensity.swift` — `d = clamp((HR − HR_rest)/(HR_max − HR_rest), 0, 1)` and `onHeartRate` emission.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Events/RaycastHitDetector.swift` — `onRaycastHit` from phone aim or simulator gaze via RealityKit raycast.
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Systems/AudioListenerSystem.swift` — moves the RealityKit audio listener with head pose from `InputFrame`. (Head position = the head sample's `position` when present, else `SceneDescription.playerOrigin` — plan decision, overview.md is silent.)
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Scene/SceneDescription.swift` — Codable declarative scene (entities, transforms, components, script names) (scene file format is not specified in overview.md; proposed here, confirm before building on it). (Also carries `requiredTier: Int` (1…3, default 1; an Int so OmniRuntime stays off `CapabilityTier`) and `playerOrigin` — plan decisions, overview.md specifies neither.)
- [ ] `Packages/OmniRuntime/Sources/OmniRuntime/Scene/SceneLoader.swift` — builds RealityKit entities and components from a `SceneDescription`.
- [ ] `Packages/OmniRuntime/Tests/OmniRuntimeTests/LookAtDetectorTests.swift` — threshold, dwell time, reset when gaze leaves.
- [ ] `Packages/OmniRuntime/Tests/OmniRuntimeTests/HeartRateIntensityTests.swift` — clamping and normalization.
- [ ] `Packages/OmniRuntime/Tests/OmniRuntimeTests/GestureEventMapperTests.swift` — each gesture type, with and without `dir`, maps to `onGesture` from any device; a stale device emits nothing (added after the plan.md audit; overview.md does not require it).
- [ ] `Packages/OmniRuntime/Tests/OmniRuntimeTests/RaycastHitDetectorTests.swift` — aim ray hits and misses a collision entity; nearest hit only; fires once per hit (added after the plan.md audit; overview.md does not require it; if RealityKit cannot run headless under `swift test`, the hit logic is tested as a pure function).
- [ ] `Packages/OmniRuntime/Tests/OmniRuntimeTests/AudioListenerSystemTests.swift` — listener transform follows head orientation and position; uses `SceneDescription.playerOrigin` when the head has no position (added after the plan.md audit; overview.md does not require it; same headless caveat as above).
- [ ] `Packages/OmniRuntime/Tests/OmniRuntimeTests/SceneLoaderTests.swift` — `SceneDescription` → entities, transforms, components and script names; `requiredTier` and `playerOrigin` parsed; unknown component rejected cleanly (added after the plan.md audit; overview.md does not require it).

### 2.2 OmniSim — virtual devices and recording
- [ ] `Packages/OmniSim/Sources/OmniSim/NoiseModel.swift` — per-device sample rate and noise parameters roughly matching real hardware (AirPods ~50 Hz, Watch 1–10 Hz, phone 60–120 Hz). (Also deletes `Module.swift`.)
- [ ] `Packages/OmniSim/Sources/OmniSim/VirtualDevice.swift` — base `InputSource` virtual device that exposes a feedback hook driven by `SimOutputSink` (only `SimOutputSink` conforms to `OutputSink`); stamps `source: "sim"`, advances `seq`, emits at its sample rate. (Stamps `t` from `HostClock` and emits unit quaternions even with noise, so the validator's 0.01 tolerance holds.)
- [ ] `Packages/OmniSim/Sources/OmniSim/Devices/VirtualAirPods.swift` — head orientation source, slot `head`.
- [ ] `Packages/OmniSim/Sources/OmniSim/Devices/VirtualWatch.swift` — wrist orientation, heart rate, gesture source.
- [ ] `Packages/OmniSim/Sources/OmniSim/Devices/VirtualPhone.swift` — orientation, accel, touch source.
- [ ] `Packages/OmniSim/Sources/OmniSim/Devices/VirtualPencil.swift` — tip, pressure, roll, hover source.
- [ ] `Packages/OmniSim/Sources/OmniSim/Recording/UsisRecorder.swift` — writes packets to `.usis.jsonl`, one per line.
- [ ] `Packages/OmniSim/Sources/OmniSim/Recording/UsisPlayer.swift` — replays a `.usis.jsonl` file as an `InputSource` with original timing. (Re-stamps `t` from `HostClock` and `seq` on looped replays so clock anchoring and seq-gap stats stay correct.)
- [ ] `Packages/OmniSim/Sources/OmniSim/Presets/PresetLibrary.swift` — lists and loads bundled gesture presets.
- [ ] `Packages/OmniSim/Sources/OmniSim/Presets/airpods-head-pitch.usis.jsonl` — recorded preset: AirPods head pitch.
- [ ] `Packages/OmniSim/Sources/OmniSim/Presets/watch-double-tap.usis.jsonl` — recorded preset: Watch double-tap.
- [ ] `Packages/OmniSim/Sources/OmniSim/Presets/watch-flick.usis.jsonl` — recorded preset: Watch flick.
- [ ] `Packages/OmniSim/Sources/OmniSim/Presets/pencil-barrel-roll.usis.jsonl` — recorded preset: Pencil barrel roll.
- [ ] `Packages/OmniSim/Sources/OmniSim/Rig/SensorRigScene.swift` — RealityKit avatar with device slots (head, wrists, hand, pocket, stylus); clicking a slot spawns a virtual device.
- [ ] `Packages/OmniSim/Sources/OmniSim/Rig/GizmoController.swift` — transform gizmos and sliders driving a virtual device's orientation and position.
- [ ] `Packages/OmniSim/Sources/OmniSim/Rig/GazeRaycaster.swift` — mouse-driven gaze ray from the head; click emits pinch.
- [ ] `Packages/OmniSim/Sources/OmniSim/Feedback/SimOutputSink.swift` — `OutputSink` that shows haptic and audio commands on the virtual device (pulse ring, vibration icon, sound cone). (Queues commands behind a Mutex; the rig drains it on the main actor each frame.)
- [ ] `Packages/OmniSim/Tests/OmniSimTests/UsisRecorderPlayerTests.swift` — record → replay round-trip preserves packets and timing.
- [ ] `Packages/OmniSim/Tests/OmniSimTests/NoiseModelTests.swift` — emitted rates and noise within tolerance of the declared model (exercises the jitter buffer in Sim mode).
- [ ] `Packages/OmniSim/Tests/OmniSimTests/SimPipelineTests.swift` — virtual devices and `UsisPlayer` through `InputPipeline`: jitter-buffer interpolation at mixed rates, stale-freeze, calibration, and an `InputFrame` that carries no source (added after the plan.md audit; overview.md does not require it).

### 2.3 OmniScript — creator scripting API
- [ ] `Packages/OmniScript/Sources/OmniScript/Resources/prelude.js` — defines `script({...})` and handles `export default` for JavaScriptCore (which has no ES module loader).
- [ ] `Packages/OmniScript/Sources/OmniScript/SelfBridge.swift` — `JSExport` surface for `self` (audio, speed, entity state). (Also deletes `Module.swift`.)
- [ ] `Packages/OmniScript/Sources/OmniScript/ContextBridge.swift` — `JSExport` surface for `ctx` (`spawn`, `intensity`, output commands); no file, network or raw USIS access.
- [ ] `Packages/OmniScript/Sources/OmniScript/ScriptEngine.swift` — sandboxed `JSContext`; implements `EventDispatcher` to call `onLookAt`/`onGesture`/`onHeartRate`/`onRaycastHit` handlers. (Also calls `onTriggerEnter` / `onTriggerExit` handlers for the `triggerEntered` / `triggerExited` events added in 1.5.)
- [ ] `Packages/OmniScript/Sources/OmniScript/ScriptReloader.swift` — recompiles a script on source change without restarting the scene.
- [ ] `Packages/OmniScript/Tests/OmniScriptTests/ScriptEngineTests.swift` — handler dispatch, sandbox isolation, error containment, hot reload. (Covers the trigger handlers too.)

### 2.4 OmniStudio — simulator UI
- [ ] `Apps/OmniStudio/OmniStudio/Sim/SimulatorPanelView.swift` — device slot picker, gizmos/sliders, heart-rate slider, "spike" button, preset buttons, record/replay controls.
- [ ] `Apps/OmniStudio/OmniStudio/Debug/DebugOverlayView.swift` — live raw USIS JSON per device: rate, latency, stale flags, source, schema errors.
- [ ] `Apps/OmniStudio/OmniStudio/Debug/CapabilityWarningView.swift` — warns when connected or simulated devices cannot satisfy the game's declared capability tier (`SceneDescription.requiredTier`, mapped to `CapabilityTier`).

---

## Phase 3: Live Hardware Bridge

Goal: real devices stream USIS into the same pipeline; Sim ↔ Live is a one-click toggle with zero game-code changes.

### 3.1 OmniCore — wire protocol (shared with companions)
- [ ] `Packages/OmniCore/Sources/OmniCore/Wire/WireMessage.swift` — non-packet messages on the link: `hello`, `ping`, `pong`, `output` (companions depend only on OmniCore, so wire types live here).
- [ ] `Packages/OmniCore/Sources/OmniCore/Wire/LineFraming.swift` — newline-delimited JSON framing over a byte stream (pure buffer split/join, no I/O).
- [ ] `Packages/OmniCore/Tests/OmniCoreTests/LineFramingTests.swift` — partial reads, multiple messages per read, oversized lines.

### 3.2 OmniBridge — Mac side
- [ ] `Packages/OmniBridge/Sources/OmniBridge/BonjourListener.swift` — `NWListener` advertising the Omni Bonjour service on the local network only. (Also deletes `Module.swift`.)
- [ ] `Packages/OmniBridge/Sources/OmniBridge/DeviceSession.swift` — one `NWConnection` per device: framing, `hello`, ping/pong for clock sync, packet decode, seq-gap reporting.
- [ ] `Packages/OmniBridge/Sources/OmniBridge/BridgeInputSource.swift` — `InputSource` merging all device sessions onto the `InputBus` (stamps `source: "live"`).
- [ ] `Packages/OmniBridge/Sources/OmniBridge/BridgeOutputSink.swift` — `OutputSink` forwarding `OutputCommand`s to the addressed device session.
- [ ] `Packages/OmniBridge/Sources/OmniBridge/AirPodsMotionSource.swift` — `CMHeadphoneMotionManager` → USIS `head` packets directly on the Mac. (From the 2026-11-14 probe: convert Apple Z-up to Omni −Z-forward/+Y-up with `[x, z, −y, w]`; `userAcceleration` is in g, multiply by 9.81 for USIS `accel`; a `sensorLocation` change (bud handoff) jumps orientation 55–90°, so re-anchor by carrying the last pre-handoff orientation over the ~1.4 s gap, or prompt calibration; on `headphoneMotionManagerDidConnect` stop and restart device-motion updates instead of relying on resume; the app target needs `NSMotionUsageDescription`.)
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
- [ ] `Apps/OmniStudio/OmniStudio/Mode/ModeController.swift` — Sim / Live toggle: swaps the active `InputSource`/`OutputSink` pair on the `InputBus`; nothing in the runtime changes. (Source/sink selection moves here from `AppModel`'s default sim pair.)
- [ ] `Apps/OmniStudio/OmniStudio/Mode/ModeToggleView.swift` — toolbar toggle bound to `ModeController`.
- [ ] `Apps/OmniStudio/OmniStudio/Devices/DeviceStatusView.swift` — connected devices, battery/rate/latency, stale indicators.
- [ ] `Apps/OmniStudio/OmniStudio/Devices/CalibrationControls.swift` — "face forward and tap" calibration flow; yaw-only for AirPods.

---

## Phase 4: Flagship Game

Goal: a game playable by a stranger in under 60 s using at least two input types, built only through the public runtime and script API. Name and design are unscheduled (`<Flagship>` placeholder).

- [ ] `Games/Flagship/scene.json` — `SceneDescription` for the game world. (Sets `requiredTier`.)
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
- [x] `Tools/AirPodsProbe/bundle.sh` — builds the probe into a minimal ad-hoc-signed `.app` and launches it with `open` so TCC reads the probe's own `Info.plist`; tails the log; Ctrl-C stops with a session summary.

---

## Phase 7: After the Hackathon (unscheduled — no checklist)

Open, not scheduled: Lua scripting backend; third-party Bluetooth adapters (Joy-Cons, haptic gloves, ESP32 bands) via `OmniAdapters`; iPad / Pencil and Vision Pro input; player apps on iOS / visionOS; relay server for remote collaboration; multiplayer gameplay; publishing games to the cloud game host (overview.md Module 11: published games are hosted in a cloud database, like Roblox). The backend, package boundary, accounts, version history and moderation are undecided, so no files are planned yet; when scheduled it gets its own checklist section.
