# Architecture

File structure, component ownership, and dependency graph. Responsibility text for each file lives in `plan.md` — not duplicated here.

Source of truth for the boundaries below is `overview.md` (Modular Workspace Architecture). Where this file adds a placement `overview.md` does not state, it is marked **(plan decision)** and traces to a parenthetical note in `plan.md`.

## Package Dependency Graph

Internal package-to-package edges only. Third-party dependencies are tracked in `branchDep.md`.

```
OmniCore ◄──── OmniInput ◄──── OmniRuntime ◄──── OmniScript
   ▲              ▲  ▲
   │              │  └───────────────┐
   ├──── OmniOutput ◄──┐             │
   │         ▲         │             │
   │         │         │             │
   ├──── OmniSim ──────┤  (OmniSim:    Core + Input + Output)
   ├──── OmniBridge ───┘  (OmniBridge: Core + Input + Output)
   │
   ├──── OmniCollab                (stretch; Core only)
   ├──── OmniAdapters              (stretch; Core + Input)
   └──── OmniCompanion             (iOS + watchOS apps; Core only)

OmniStudio (macOS app)  ──►  every package above except OmniCompanion
Games/Flagship          ──►  data only (scene + scripts) run through OmniRuntime + OmniScript
```

| Package / target | Depends on |
|---|---|
| OmniCore | — |
| OmniInput | OmniCore |
| OmniOutput | OmniCore |
| OmniRuntime | OmniCore, OmniInput (protocols only) |
| OmniScript | OmniRuntime |
| OmniSim | OmniCore, OmniInput, OmniOutput |
| OmniBridge | OmniCore, OmniInput, OmniOutput |
| OmniCollab (stretch) | OmniCore |
| OmniAdapters (stretch) | OmniCore, OmniInput |
| OmniCompanion (iOS, watchOS) | OmniCore |
| OmniStudio (macOS app) | all packages |
| Games/Flagship | OmniRuntime, OmniScript (public API only) |

### Forbidden Edges

Enforced in each `Package.swift`; a violation is a build failure, not a convention.

| From | Must never depend on | Why |
|---|---|---|
| OmniRuntime, OmniScript, Games/* | OmniSim, OmniBridge | Hardware-blind property: a game cannot tell sim from live |
| OmniRuntime | OmniOutput | Runtime queues `OutputCommand` (OmniCore) and never touches a sink |
| OmniRuntime | OmniScript | Scripts attach through the `EventDispatcher` protocol |
| OmniCore | everything | Pure, no I/O |
| OmniCompanion | anything but OmniCore | Phone/Watch apps share only the wire types |
| OmniCollab | OmniInput, OmniRuntime | Syncs the project document only; never touches input |
| OmniSim ↔ OmniBridge | each other | Siblings; both plug in through `InputSource` / `OutputSink` |

## Protocol Seams

Where one package is swapped for another without the consumer changing. Studio's `ModeController` is the only place concrete sources and sinks are chosen.

| Seam (declared in) | Implemented by | Consumed by |
|---|---|---|
| `InputSource` (OmniInput) | OmniSim: `VirtualDevice` subclasses, `UsisPlayer` · OmniBridge: `BridgeInputSource`, `AirPodsMotionSource` · OmniAdapters (stretch) | `InputBus` (a source is started with the bus: `start(bus:)`) |
| `InputBus` (OmniInput) | OmniInput: `InputPipeline` | OmniRuntime `SceneRunner` (via `InputFrame`), OmniStudio |
| `OutputSink` (OmniOutput) | OmniSim: `SimOutputSink` · OmniBridge: `BridgeOutputSink` | `AppModel` (OmniStudio) drains the runtime's `OutputQueue` into the active sink |
| `EventDispatcher` (OmniRuntime) | OmniScript: `ScriptEngine` | OmniRuntime `SceneRunner` |

## Type Ownership

| Type | Owner | Notes |
|---|---|---|
| `UsisPacket`, `UsisChannels`, USIS enums | OmniCore | Mirror `Schema/usis.schema.json` |
| `Vector3`, `Quaternion`, `Pose` | OmniCore | world frame (overview.md Coordinate Frame) is right-handed, +X right, +Y up, −Z forward (RealityKit convention); every live source converts from its device frame (AirPods: `[x, z, −y, w]`) |
| `InputFrame` | OmniCore | **(plan decision)** lets OmniRuntime avoid more than OmniInput's protocols |
| `OutputCommand` | OmniCore | **(plan decision)** lets OmniRuntime queue commands without OmniOutput |
| `TouchPoint`, `GestureEvent`, `PencilState` | OmniCore | **(plan decision)** channel payload types, shared by `UsisChannels` and `InputFrame` |
| `DeviceSample` | OmniCore | **(plan decision)** one device's entry in an `InputFrame`; carries no `source` |
| `OutputType` | OmniCore | **(plan decision)** `haptic` / `audio` for `OutputCommand` |
| `WireMessage`, `LineFraming` | OmniCore | **(plan decision)** companions depend only on OmniCore |
| `InputSource`, `InputBus`, `CapabilityTier`, `DeviceStats` | OmniInput | `DeviceStats` is the only place `source` survives |
| `DeviceDescriptor`, `ChannelKind`, `PacketValidationError`, `HostClock` | OmniInput | **(plan decision)** supporting types for sources, capability tiers, validation and the host clock |
| `OutputSink` | OmniOutput | |
| `GameEvent`, `EventDispatcher`, components, systems | OmniRuntime | |
| `SceneDescription`, `SceneLoader` | OmniRuntime | **(plan decision)** scene file format not in overview.md |
| `ScriptEngine`, `SelfBridge`, `ContextBridge` | OmniScript | |

## Apple Framework Use

| Package / target | Frameworks |
|---|---|
| OmniCore | Foundation only |
| OmniInput | Foundation, Synchronization (`Mutex`) |
| OmniOutput | none (OmniCore only) |
| OmniRuntime | RealityKit |
| OmniScript | JavaScriptCore |
| OmniSim | RealityKit (sensor rig) |
| OmniBridge | Network, CoreMotion (`CMHeadphoneMotionManager`) |
| OmniCollab | Automerge for Swift (third party) |
| OmniAdapters | CoreBluetooth |
| OmniCompanion iOS | Network, CoreMotion, Core Haptics, WatchConnectivity |
| OmniCompanion watchOS | HealthKit, WatchConnectivity |
| OmniStudio | SwiftUI, RealityKit |

## File Structure

Full paths and per-file responsibilities are in `plan.md`. Phase tag in brackets is the phase that creates the file.

```
Omni.xcworkspace/
  contents.xcworkspacedata                          [P1]
.gitignore                                          [P1]
Schema/
  usis.schema.json                                  [P1]
Recordings/
  demo-fallback.usis.jsonl                          [P5]

Packages/
  OmniCore/
    Package.swift                                   [P1]
    Sources/OmniCore/
      Math/        Vector3.swift  Quaternion.swift  Pose.swift                        [P1]
      USIS/        UsisEnums.swift  UsisChannels.swift  UsisPacket.swift              [P1]
      Frame/       InputFrame.swift                                                   [P1]
      Output/      OutputCommand.swift                                                [P1]
      Wire/        WireMessage.swift  LineFraming.swift                               [P3]
    Tests/OmniCoreTests/
      QuaternionTests.swift  UsisPacketTests.swift                                    [P1]
      LineFramingTests.swift                                                          [P3]

  OmniInput/
    Package.swift                                   [P1]
    Sources/OmniInput/
      InputSource.swift  InputBus.swift  PacketValidator.swift  ClockSync.swift
      JitterBuffer.swift  Calibration.swift  CapabilityTier.swift  DeviceStats.swift
      InputPipeline.swift                                                             [P1]
    Tests/OmniInputTests/
      PacketValidatorTests.swift  ClockSyncTests.swift  JitterBufferTests.swift
      CalibrationTests.swift  SourceStrippingTests.swift                              [P1]

  OmniOutput/
    Package.swift                                   [P1]
    Sources/OmniOutput/
      OutputSink.swift                                                                [P1]

  OmniRuntime/
    Package.swift                                   [P1]
    Sources/OmniRuntime/
      SceneRunner.swift                                                               [P1]
      Components/  TriggerComponent.swift  AudioEmitterComponent.swift
                   ScriptComponent.swift                                              [P1]
      Events/      GameEvent.swift  EventDispatcher.swift                             [P1]
                   LookAtDetector.swift  GestureEventMapper.swift
                   HeartRateIntensity.swift  RaycastHitDetector.swift                 [P2]
      Systems/     TriggerSystem.swift                                                [P1]
                   AudioListenerSystem.swift                                          [P2]
      Output/      OutputQueue.swift                                                  [P1]
      Scene/       SceneDescription.swift  SceneLoader.swift                          [P2]
    Tests/OmniRuntimeTests/
      SceneRunnerTriggerTests.swift                                                   [P1]
      LookAtDetectorTests.swift  HeartRateIntensityTests.swift                        [P2]
      GestureEventMapperTests.swift  RaycastHitDetectorTests.swift                    [P2]
      AudioListenerSystemTests.swift  SceneLoaderTests.swift                          [P2]

  OmniScript/
    Package.swift                                   [P1]
    Sources/OmniScript/
      Module.swift                                  [P1, removed P2]
      Resources/prelude.js                                                            [P2]
      SelfBridge.swift  ContextBridge.swift  ScriptEngine.swift  ScriptReloader.swift [P2]
    Tests/OmniScriptTests/
      ScriptEngineTests.swift                                                         [P2]

  OmniSim/
    Package.swift                                   [P1]
    Sources/OmniSim/
      Module.swift                                  [P1, removed P2]
      NoiseModel.swift  VirtualDevice.swift                                           [P2]
      Devices/     VirtualAirPods.swift  VirtualWatch.swift
                   VirtualPhone.swift  VirtualPencil.swift                            [P2]
      Recording/   UsisRecorder.swift  UsisPlayer.swift                                [P2]
      Presets/     PresetLibrary.swift  airpods-head-pitch.usis.jsonl
                   watch-double-tap.usis.jsonl  watch-flick.usis.jsonl
                   pencil-barrel-roll.usis.jsonl                                      [P2]
      Rig/         SensorRigScene.swift  GizmoController.swift  GazeRaycaster.swift  [P2]
      Feedback/    SimOutputSink.swift                                                [P2]
    Tests/OmniSimTests/
      UsisRecorderPlayerTests.swift  NoiseModelTests.swift                            [P2]
      SimPipelineTests.swift                                                          [P2]

  OmniBridge/
    Package.swift                                   [P1]
    Sources/OmniBridge/
      Module.swift                                  [P1, removed P3]
      BonjourListener.swift  DeviceSession.swift  BridgeInputSource.swift
      BridgeOutputSink.swift  AirPodsMotionSource.swift                               [P3]
    Tests/OmniBridgeTests/
      DeviceSessionTests.swift                                                        [P3]

  OmniCollab/                                                                         (stretch)
    Package.swift                                   [P1]
    Sources/OmniCollab/
      Module.swift                                  [P1, removed P6]
      ProjectDocument.swift  PeerSync.swift  Presence.swift                           [P6]

  OmniAdapters/                                                                       (stretch)
    Package.swift                                   [P1]
    Sources/OmniAdapters/
      Module.swift                                  [P1, stays until P7]

Apps/
  OmniStudio/
    OmniStudio.xcodeproj/project.pbxproj            [P1]
    OmniStudio/
      OmniStudioApp.swift                                                             [P1]
      AppModel.swift                                                                  [P1]
      Viewport/    ViewportView.swift                                                 [P1]
      Sim/         SimulatorPanelView.swift                                           [P2]
      Debug/       DebugOverlayView.swift  CapabilityWarningView.swift                [P2]
      Mode/        ModeController.swift  ModeToggleView.swift                         [P3]
                   DemoMode.swift                                                     [P5]
      Devices/     DeviceStatusView.swift  CalibrationControls.swift                  [P3]
      Scripting/   ScriptEditorView.swift                                             [P4]
      Inspector/   InspectorView.swift                                                [P4]
      Collab/      PresenceOverlayView.swift                                          [P6]

  OmniCompanion/
    OmniCompanion.xcodeproj/project.pbxproj         [P3]
    Shared/        BridgeClient.swift                                                 [P3]
    iOS/           OmniCompanionApp.swift  MotionStreamer.swift  TouchCapture.swift
                   HapticPlayer.swift  WatchConnectivityReceiver.swift                [P3]
    watchOS/       WatchApp.swift  HeartRateWorkout.swift
                   WristGestureDetector.swift  WatchRelay.swift                       [P3]

Tools/                                              (plan decision: hardware probes, no Omni deps, no graph edges)
  AirPodsProbe/
    Package.swift  Info.plist  bundle.sh                                              [HW]
    Sources/AirPodsProbe/main.swift                                                   [HW]

Games/
  Flagship/                                         (name unscheduled)
    scene.json                                                                        [P4]
    scripts/       enemy.js  player.js  game.js                                       [P4]
```

## Placement Notes

- `OmniStudio` is the composition root: it constructs the `InputPipeline`, the active `InputSource` / `OutputSink` pair, the `ScriptEngine` and the `SceneRunner`, and wires them together, in `AppModel.swift`. No package does this wiring. `AppModel` also drains the runtime's `OutputQueue` into the active sink each frame; `ModeController` (P3) takes over choosing the source/sink pair.
- **(plan decision)** `SceneDescription.requiredTier` is a plain `Int` (1…3), so `OmniRuntime` stays off `CapabilityTier`; Studio maps it to `CapabilityTier` for the capability warning.
- `BridgeClient` is shared by the iOS and watchOS targets under `Apps/OmniCompanion/Shared/`; the Watch reaches the Mac through the phone via `WatchRelay` → `WatchConnectivityReceiver`.
- `Games/Flagship` holds data (scene + JS) only, so it cannot import Swift packages by construction; it reaches the engine through `OmniScript`'s `self` / `ctx` API.
- Cloud game hosting (`overview.md` Module 11) has no package yet, so no package, file or dependency edge is added above. Published games are data only (scene + scripts + assets + metadata), the same shape as `Games/Flagship`, and are stored in a cloud database; sensor data (USIS) and output commands never go there.
- **(plan decision)** Boundary to apply when a cloud client is added: only `OmniStudio` (the composition root) may depend on it. It fetches a published game and hands the scene and script sources to `OmniRuntime` / `OmniScript`. `OmniRuntime`, `OmniScript` and `Games/*` must never depend on it, and it carries game content only, never input, so the hardware-blind property holds. Add the package, its row in the dependency table and the matching Forbidden Edges rows when Module 11 is scheduled.
