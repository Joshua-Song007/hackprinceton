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

OmniCloud                          (no Omni deps; backend client for Studio and the player)
   ▲
   └──── OmniLibrary                (Phase 9: device profile + library model; OmniCloud only)

OmniStudio (macOS app)  ──►  every package above except OmniCompanion and OmniLibrary
OmniPlayer (iOS + macOS app) ──►  OmniLibrary, OmniCloud (Phase 9; library shell, no runtime yet)
Games/Flagship          ──►  data only (scene + scripts) run through OmniRuntime + OmniScript
Backend/ (Rust)         ──►  no Swift edges; reached over HTTP / WebSocket by OmniCloud
                             (one file edge, not a package edge: `script_host.rs` includes OmniScript's `prelude.js`; see Placement Notes)
Web/ (TypeScript, Phase 8) ─► no Swift edges; file-level imports of Schema/usis.schema.json, prelude.js, Games/*; reaches Backend/ over HTTP / WebSocket via @omni/cloud
  @omni/core ◄── @omni/runtime ◄── @omni/script        (@omni/runtime, @omni/script never import @omni/sim: hardware-blind)
  @omni/core ◄── @omni/sim ;  @omni/cloud (no Omni deps) ;  studio = composition root, depends on all
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
| OmniCloud | — |
| OmniLibrary (Phase 9) | OmniCloud |
| OmniPlayer (iOS + macOS app, Phase 9) | OmniLibrary, OmniCloud |
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
| OmniRuntime, OmniScript, Games/* | OmniCloud | Module 11 boundary: only a composition root talks to the backend (Studio; since Phase 9 also OmniPlayer, **(plan decision)** until overview.md Module 11 changes) |
| OmniLibrary | OmniRuntime, OmniScript, OmniInput, OmniSim, OmniBridge (this round) | **(plan decision)** the player shell is library-only; keeps the hardware-blind property and the Network Rule by dependency; revisit when Play embeds the runtime |
| OmniCloud | any Omni package | Carries game content only, never input |

## Protocol Seams

Where one package is swapped for another without the consumer changing. Studio's `ModeController` is the only place concrete sources and sinks are chosen.

| Seam (declared in) | Implemented by | Consumed by |
|---|---|---|
| `InputSource` (OmniInput) | OmniSim: `VirtualDevice` subclasses, `UsisPlayer` · OmniBridge: `BridgeInputSource`, `AirPodsMotionSource` · OmniAdapters (stretch) | `InputBus` (a source is started with the bus: `start(bus:)`) |
| `InputBus` (OmniInput) | OmniInput: `InputPipeline` | OmniRuntime `SceneRunner` (via `InputFrame`), OmniStudio |
| `OutputSink` (OmniOutput) | OmniSim: `SimOutputSink` · OmniBridge: `BridgeOutputSink` · OmniStudio: `RecordingOutputSink` (placeholder in `AppModel.swift`, still the sim sink handed to `ModeController`) | `AppModel` (OmniStudio) drains the runtime's `OutputQueue` into the active sink |
| `EventDispatcher` (OmniRuntime) | OmniScript: `ScriptEngine` | OmniRuntime `SceneRunner` |
| `EventDeriver` (OmniRuntime) | OmniRuntime: `LookAtDetector`, `GestureEventMapper`, `HeartRateIntensity`, `RaycastHitDetector` (2.1) | OmniRuntime `SceneRunner` |
| `RemoteChannel` (OmniScript) | OmniStudio: `InMemoryRemoteChannel` (in `LocalTestSession.swift`) · later the player app's game-server connection | OmniScript `ScriptEngine`, `ServerScriptEngine` |
| `CatalogSource` (OmniLibrary, Phase 9) | OmniCloud: `CloudClient` | OmniLibrary `LibraryModel` |
| `SessionStore` (OmniLibrary, Phase 9) | OmniLibrary: Keychain store · in-memory store (tests) | OmniPlayer `PlayerModel` |
| `GameSource` (OmniLibrary, Phase 9) | OmniCloud: `CloudClient` | OmniLibrary `StubGameLauncher` |
| `GameLauncher` (OmniLibrary, Phase 9) | OmniLibrary: `StubGameLauncher` (fetches the bundle only) · later a launcher that hands it to OmniRuntime / OmniScript | OmniPlayer `PlayerModel` |

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
| `EventDeriver`, `OutputQueue`, `TriggerProbe` | OmniRuntime | **(plan decision)** detector extension point, per-frame output buffer and the trigger-test point type |
| `SceneDescription`, `SceneLoader` | OmniRuntime | **(plan decision)** scene file format not in overview.md |
| `ScriptEngine`, `SelfBridge`, `ContextBridge`, `ScriptReloader` | OmniScript | |
| `ServerScriptEngine`, `RemoteChannel` | OmniScript | server scripts and the remote-event seam (overview.md Module 3) |
| `CloudClient` | OmniCloud | **(plan decision)** one HTTP client for sign-in, publish and fetch |
| `CatalogEntry` | OmniCloud | **(plan decision)** one row of the public library (id, title, author, latest version, run mode, required tier) |
| `DeviceProfile`, `Playability`, `LibraryModel` | OmniLibrary | **(plan decision)** what this device is, whether it can play an entry, and the browse state |
| `StoredSession`, `SessionStore`, `GameSource`, `GameLauncher`, `LaunchResult` | OmniLibrary | **(plan decision)** the persisted sign-in, the fetch seam and the launch seam; `StubGameLauncher` is the only launcher this round |

## Apple Framework Use

| Package / target | Frameworks |
|---|---|
| OmniCore | Foundation only |
| OmniInput | Foundation, Synchronization (`Mutex`) |
| OmniOutput | none (OmniCore only) |
| OmniRuntime | RealityKit, simd |
| OmniScript | JavaScriptCore, RealityKit (`SelfBridge` sets `AudioEmitterComponent`) |
| OmniSim | RealityKit (sensor rig), Synchronization |
| OmniBridge | Network, CoreMotion (`CMHeadphoneMotionManager`), Synchronization |
| OmniCollab | Automerge for Swift (third party; not added yet) |
| OmniAdapters | CoreBluetooth (not used yet) |
| OmniCompanion iOS | Network (via `Shared/BridgeClient.swift`), CoreMotion, Core Haptics, WatchConnectivity, SwiftUI, UIKit |
| OmniCompanion watchOS | HealthKit, CoreMotion, WatchConnectivity, SwiftUI |
| OmniCloud | Foundation (`URLSession`) |
| OmniLibrary | Foundation, Security (Keychain), Observation, Synchronization (`Mutex` in the in-memory session store) |
| OmniPlayer | SwiftUI, AuthenticationServices (Sign in with Apple) |
| OmniStudio | SwiftUI, RealityKit, AppKit, Observation, Synchronization |
| Backend (Rust, not Apple) | axum (with `ws`), tokio, sqlx (Postgres), serde, serde_json, rquickjs 0.9 (provisional; deno_core not picked), jsonwebtoken 12 (`rust_crypto`) and reqwest 0.12 (`rustls-tls`) for Sign in with Apple (Phase 9), getrandom 0.3 for session tokens |

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
      Events/      GameEvent.swift  EventDispatcher.swift  EventDeriver.swift         [P1]
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
      RemoteChannel.swift  ServerScriptEngine.swift                                   [P2]
    Tests/OmniScriptTests/
      ScriptEngineTests.swift  ServerScriptEngineTests.swift                          [P2]

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
      PresetLibraryTests.swift  RigTests.swift  SimOutputSinkTests.swift              [P2, extra]

  OmniBridge/
    Package.swift                                   [P1]
    Sources/OmniBridge/
      Module.swift                                  [P1, removed P3]
      BonjourListener.swift  DeviceSession.swift  BridgeInputSource.swift
      BridgeOutputSink.swift  AirPodsMotionSource.swift                               [P3]
    Tests/OmniBridgeTests/
      DeviceSessionTests.swift                                                        [P3]
      AirPodsMotionSourceTests.swift  BonjourListenerTests.swift
      BridgeSourceSinkTests.swift                                                     [P3, extra]

  OmniCollab/                                                                         (stretch)
    Package.swift                                   [P1]
    Sources/OmniCollab/
      Module.swift                                  [P1, removed P6]
      ProjectDocument.swift  PeerSync.swift  Presence.swift                           [P6]

  OmniAdapters/                                                                       (stretch)
    Package.swift                                   [P1]
    Sources/OmniAdapters/
      Module.swift                                  [P1, stays until P7]

  OmniCloud/
    Package.swift                                   [P4]
    Sources/OmniCloud/
      CloudClient.swift                                                               [P4]
    Tests/OmniCloudTests/
      CloudClientTests.swift                                                          [P4]
      LibraryAPITests.swift                                                           [P9]

  OmniLibrary/                                                                        (Phase 9)
    Package.swift                                   [P9]
    Sources/OmniLibrary/
      DeviceProfile.swift  Playability.swift  SessionStore.swift
      LibraryModel.swift  GameLauncher.swift                                          [P9]
    Tests/OmniLibraryTests/
      DeviceProfileTests.swift  PlayabilityTests.swift  LibraryModelTests.swift       [P9]

Apps/
  OmniStudio/
    OmniStudio.xcodeproj/project.pbxproj            [P1]
    OmniStudio/
      OmniStudioApp.swift                                                             [P1]
      AppModel.swift                                                                  [P1]
      Viewport/    ViewportView.swift                                                 [P1]
      Sim/         SimulatorPanelView.swift                                           [P2]
      Test/        LocalTestSession.swift                                             [P2]
      Account/     SignInView.swift                                                   [P4]
      Publish/     PublishView.swift                                                  [P4]
      Debug/       DebugOverlayView.swift  CapabilityWarningView.swift                [P2]
      Mode/        ModeController.swift  ModeToggleView.swift                         [P3]
                   DemoMode.swift                                                     [P5]
      Devices/     DeviceStatusView.swift  CalibrationControls.swift                  [P3]
      Scripting/   ScriptEditorView.swift                                             [P4]
      Inspector/   InspectorView.swift                                                [P4]
      Collab/      PresenceOverlayView.swift                                          [P6]

  OmniCompanion/
    OmniCompanion.xcodeproj/project.pbxproj         [P3]
    Info.plist  Watch-Info.plist  OmniWatch.entitlements                              [P3, extra]
    Shared/        BridgeClient.swift                                                 [P3]
    iOS/           OmniCompanionApp.swift  MotionStreamer.swift  TouchCapture.swift
                   HapticPlayer.swift  WatchConnectivityReceiver.swift                [P3]
    watchOS/       WatchApp.swift  HeartRateWorkout.swift
                   WristGestureDetector.swift  WatchRelay.swift                       [P3]

  OmniPlayer/                                       (Phase 9: iOS + macOS player app, library shell)
    OmniPlayer.xcodeproj/project.pbxproj            [P9]
    OmniPlayer.entitlements                         [P9]
    OmniPlayer/
      OmniPlayerApp.swift  PlayerModel.swift                                          [P9]
      Account/     AppleSignInView.swift                                              [P9]
      Library/     LibraryView.swift  GameDetailView.swift                            [P9]

Tools/                                              (plan decision: hardware probes, no Omni deps, no graph edges)
  AirPodsProbe/
    Package.swift  Info.plist  bundle.sh                                              [HW]
    Sources/AirPodsProbe/main.swift                                                   [HW]
  PhoneProbe.swiftpm/                               (iOS app package; keep the .swiftpm suffix)
    Package.swift  Sources/PhoneProbe/PhoneProbeApp.swift                             [HW]
  PhoneProbeHost/
    Package.swift  Sources/PhoneProbeHost/main.swift                                  [HW]

Games/
  Flagship/                                         (name unscheduled)
    scene.json                                                                        [P4]
    scripts/       enemy.js  player.js  game.js                                       [P4]

Backend/                                            (plan decision: Rust Cargo project, not in the Xcode workspace)
  Cargo.toml  Cargo.lock                                                              [P4]
  migrations/      0001_init.sql                                                      [P4]
  src/             main.rs  db.rs  lib.rs                                             [P4]
  src/api/         accounts.rs  games.rs  mod.rs                                      [P4]
                   library.rs  apple.rs                                               [P9]
  src/game_server/ session.rs  script_host.rs  mod.rs                                 [P4]
  tests/           api.rs  script_host.rs                                             [P4]
                   library.rs  apple.rs                                               [P9]
```

## Placement Notes
- **(plan decision, Phase 8)** `Web/` is an npm-workspace TypeScript SDK + Studio (`Web/packages/omni-{core,runtime,script,sim,cloud}`, `Web/studio`, desktop shell `Web/studio/src-tauri`), mirroring the Swift package boundaries for a browser / desktop Studio. Contracts are shared by importing the same files, never copies. `Deploy/` holds the Dockerfile, compose, Caddyfile and Vultr scripts; the backend image serves the built Studio. overview.md defines Studio as native macOS only: mismatch flagged in plan.md Phase 8, not decided.

- `OmniStudio` is the composition root: it constructs the `InputPipeline`, the active `InputSource` / `OutputSink` pair, the `ScriptEngine` and the `SceneRunner`, and wires them together, in `AppModel.swift`. No package does this wiring. `AppModel` also drains the runtime's `OutputQueue` into the active sink each frame; `ModeController` (P3) takes over choosing the source/sink pair. (Changed 2026-11-14: as built, `AppModel` constructs the `InputPipeline`, `SceneRunner`, one sim head device, a `RecordingOutputSink` placeholder, the `ModeController` and `DemoMode`, but no `ScriptEngine`; `ModeController` builds the live `BridgeInputSource`, `BridgeOutputSink` and `BonjourListener`; `ScriptEngine` and `ServerScriptEngine` are constructed only in `LocalTestSession`. `ScriptEditorView`, `InspectorView`, `SimulatorPanelView` and `DebugOverlayView` exist but are not mounted in the window yet.)
- **(plan decision)** `SceneDescription.requiredTier` is a plain `Int` (1…3), so `OmniRuntime` stays off `CapabilityTier`; Studio maps it to `CapabilityTier` for the capability warning.
- `BridgeClient` is shared by the iOS and watchOS targets under `Apps/OmniCompanion/Shared/`; the Watch reaches the Mac through the phone via `WatchRelay` → `WatchConnectivityReceiver`.
- `Games/Flagship` holds data (scene + JS) only, so it cannot import Swift packages by construction; it reaches the engine through `OmniScript`'s `self` / `ctx` API.
- Cloud game hosting (`overview.md` Module 11): `OmniCloud` is the Mac-side client and `Backend/` is the Rust server. Published games are data only (scene + client scripts + server scripts + assets + metadata), the same shape as `Games/Flagship`, and are stored in TigerData; sensor data (USIS) and output commands never go there.
- Only `OmniStudio` (the composition root) depends on `OmniCloud`. It fetches a published game and hands the scene and script sources to `OmniRuntime` / `OmniScript`. `OmniCloud` carries game content only, never input, so the hardware-blind property holds. (Changed 2026-11-14: since Phase 9 `OmniLibrary` and `OmniPlayer` also depend on `OmniCloud`; `OmniLibrary` is a package of its own so its logic is tested with `swift test`. **(plan decision)** until overview.md Module 11 is updated.)
- **(plan decision)** `OmniPlayer` (Phase 9) is a second composition root: it builds `CloudClient`, the session store, `DeviceProfile`, `LibraryModel` and a `GameLauncher` in `PlayerModel.swift`. Identity is Sign in with Apple; `DeviceProfile` only flags which games the device can play. Play is a stub (`StubGameLauncher` fetches the bundle and stops); running a game on the player needs `.iOS(.v18)` on OmniInput, OmniRuntime, OmniScript and OmniOutput, which are macOS-only today (`OmniCore` already declares iOS; `OmniCloud` gets it in 9.2). overview.md still lists player apps in Phase 7: flagged, not decided.
- `LocalTestSession` (Studio) is the composition root for a multiplayer test: one `ServerScriptEngine` plus several simulated players, each with its own `InputPipeline`, `SceneRunner` and client `ScriptEngine`, joined by an in-memory `RemoteChannel`. **(plan decision)** The viewport shows one selected player.
- **(plan decision)** `Backend/src/game_server/script_host.rs` implements the same `serverScript` API as `ServerScriptEngine` in a different JS engine; `Backend/tests/script_host.rs` and `ServerScriptEngineTests.swift` run the same fixture so the two stay aligned.
- **(plan decision)** `Backend/src/game_server/script_host.rs` includes `Packages/OmniScript/Sources/OmniScript/Resources/prelude.js` with `include_str!`, so the Rust and Swift engines share one `serverScript` definition. This is a file-level edge from `Backend/` into a Swift package: `Backend/` no longer builds standalone (Windows laptops need the whole repo checked out), and a change to `prelude.js` affects both engines. `overview.md` describes `Backend/` as a separate Rust project; the mismatch is flagged, not decided.
- `Tools/` holds validation tests that prove data can actually be read from each peripheral; it is not production code. (Changed 2026-11-14: these were the only working peripheral code until Phase 3; the production sources now exist in `OmniBridge` and `OmniCompanion`, and the probes remain for reference.) They are: `AirPodsProbe` (AirPods head motion on the Mac via `CMHeadphoneMotionManager`), `PhoneProbe.swiftpm` (iPhone motion, touch and haptics over Bonjour + TCP) and `PhoneProbeHost` (the Mac side that receives it). They are standalone probes with no Omni package dependencies; their measured results are recorded in `plan.md` (Cross-Cutting: Hardware verification). The production sources are built from them in Phase 3: `AirPodsMotionSource` and the `OmniBridge` session code on the Mac, `MotionStreamer` / `TouchCapture` / `HapticPlayer` / `BridgeClient` in `OmniCompanion`.
- **(plan decision)** `SceneDescription.runMode` (`screen` / `device`) is the game's declared run mode (overview.md Module 7).
