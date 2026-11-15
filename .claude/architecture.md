# Architecture

Product name is Pear; package / env identifiers keep the Pear prefix (see overview.md Naming).

File structure, component ownership, and dependency graph. Responsibility text for each file lives in `plan.md` — not duplicated here.

Source of truth for the boundaries below is `overview.md` (Modular Workspace Architecture). Where this file adds a placement `overview.md` does not state, it is marked **(plan decision)** and traces to a parenthetical note in `plan.md`.

## Package Dependency Graph

Internal package-to-package edges only. Third-party dependencies are tracked in `branchDep.md`.

```
PearCore ◄──── PearInput ◄──── PearRuntime ◄──── PearScript
   ▲              ▲  ▲
   │              │  └───────────────┐
   ├──── PearOutput ◄──┐             │
   │         ▲         │             │
   │         │         │             │
   ├──── PearSim ──────┤  (PearSim:    Core + Input + Output)
   ├──── PearBridge ───┘  (PearBridge: Core + Input + Output)
   │
   ├──── PearCollab                (stretch; Core only)
   ├──── PearAdapters              (stretch; Core + Input)
   └──── PearCompanion             (iOS + watchOS apps; Core only)

PearCloud                          (no Pear deps; backend client for Studio and the player)
   ▲
   └──── PearLibrary                (Phase 9: device profile + library model; PearCloud only)

PearStudio (macOS app)  ──►  every package above except PearCompanion and PearLibrary
PearPlayer (iOS + macOS app) ──►  PearLibrary, PearCloud (Phase 9 library shell; since commit 1f083b8 also runs games: GameSession/PlayView with PearRuntime, PearScript, PearInput, PearSim, PearCloud over NetworkRemoteChannel; touch input only, motion comes from PearCompanion)
Games/Flagship          ──►  data only (scene + scripts) run through PearRuntime + PearScript
Backend/ (Rust)         ──►  no Swift edges; reached over HTTP / WebSocket by PearCloud
                             (one file edge, not a package edge: `script_host.rs` includes PearScript's `prelude.js`; see Placement Notes)
Web/ (TypeScript, Phase 8) ─► no Swift edges; file-level imports of Schema/usis.schema.json, prelude.js, Games/*; reaches Backend/ over HTTP / WebSocket via @pear/cloud
  @pear/core ◄── @pear/runtime ◄── @pear/script        (@pear/runtime, @pear/script never import @pear/sim: hardware-blind)
  @pear/core ◄── @pear/sim ;  @pear/cloud (no Pear deps) ;  studio = composition root, depends on all
```

| Package / target | Depends on |
|---|---|
| PearCore | — |
| PearInput | PearCore |
| PearOutput | PearCore |
| PearRuntime | PearCore, PearInput (protocols only) |
| PearScript | PearRuntime |
| PearSim | PearCore, PearInput, PearOutput |
| PearBridge | PearCore, PearInput, PearOutput |
| PearCollab (stretch) | PearCore |
| PearAdapters (stretch) | PearCore, PearInput |
| PearCompanion (iOS, watchOS) | PearCore |
| PearCloud | — |
| PearLibrary (Phase 9) | PearCloud |
| PearPlayer (iOS + macOS app, Phase 9) | PearLibrary, PearCloud |
| PearStudio (macOS app) | all packages |
| Games/Flagship | PearRuntime, PearScript (public API only) |

### Forbidden Edges

Enforced in each `Package.swift`; a violation is a build failure, not a convention.

| From | Must never depend on | Why |
|---|---|---|
| PearRuntime, PearScript, Games/* | PearSim, PearBridge | Hardware-blind property: a game cannot tell sim from live |
| PearRuntime | PearOutput | Runtime queues `OutputCommand` (PearCore) and never touches a sink |
| PearRuntime | PearScript | Scripts attach through the `EventDispatcher` protocol |
| PearCore | everything | Pure, no I/O |
| PearCompanion | anything but PearCore | Phone/Watch apps share only the wire types |
| PearCollab | PearInput, PearRuntime | Syncs the project document only; never touches input |
| PearSim ↔ PearBridge | each other | Siblings; both plug in through `InputSource` / `OutputSink` |
| PearRuntime, PearScript, Games/* | PearCloud | Module 11 boundary: only a composition root talks to the backend (Studio; since Phase 9 also PearPlayer, **(plan decision)** until overview.md Module 11 changes) |
| PearLibrary | PearRuntime, PearScript, PearInput, PearSim, PearBridge (this round) | **(plan decision)** the player shell is library-only; keeps the hardware-blind property and the Network Rule by dependency; revisit: Play now embeds the runtime (commit 1f083b8) |
| PearCloud | any Pear package | Carries game content only, never input |

## Protocol Seams

Where one package is swapped for another without the consumer changing. Studio's `ModeController` is the only place concrete sources and sinks are chosen.

| Seam (declared in) | Implemented by | Consumed by |
|---|---|---|
| `InputSource` (PearInput) | PearSim: `VirtualDevice` subclasses, `UsisPlayer` · PearBridge: `BridgeInputSource`, `AirPodsMotionSource` · PearAdapters (stretch) | `InputBus` (a source is started with the bus: `start(bus:)`) |
| `InputBus` (PearInput) | PearInput: `InputPipeline` | PearRuntime `SceneRunner` (via `InputFrame`), PearStudio |
| `OutputSink` (PearOutput) | PearSim: `SimOutputSink` · PearBridge: `BridgeOutputSink` · PearStudio: `RecordingOutputSink` (placeholder in `AppModel.swift`, still the sim sink handed to `ModeController`) | `AppModel` (PearStudio) drains the runtime's `OutputQueue` into the active sink |
| `EventDispatcher` (PearRuntime) | PearScript: `ScriptEngine` | PearRuntime `SceneRunner` |
| `EventDeriver` (PearRuntime) | PearRuntime: `LookAtDetector`, `GestureEventMapper`, `HeartRateIntensity`, `RaycastHitDetector` (2.1) | PearRuntime `SceneRunner` |
| `RemoteChannel` (PearScript) | PearStudio: `InMemoryRemoteChannel` (in `LocalTestSession.swift`) · later the player app's game-server connection | PearScript `ScriptEngine`, `ServerScriptEngine` |
| `CatalogSource` (PearLibrary, Phase 9) | PearCloud: `CloudClient` | PearLibrary `LibraryModel` |
| `SessionStore` (PearLibrary, Phase 9) | PearLibrary: Keychain store · in-memory store (tests) | PearPlayer `PlayerModel` |
| `GameSource` (PearLibrary, Phase 9) | PearCloud: `CloudClient` | PearLibrary `StubGameLauncher` |
| `GameLauncher` (PearLibrary, Phase 9) | PearLibrary: `StubGameLauncher` (fetches the bundle only) · `RuntimeGameLauncher` (Apps/PearPlayer, Play) · earlier plan: a launcher that hands it to PearRuntime / PearScript | PearPlayer `PlayerModel` |

## Type Ownership

| Type | Owner | Notes |
|---|---|---|
| `UsisPacket`, `UsisChannels`, USIS enums | PearCore | Mirror `Schema/usis.schema.json` |
| `Vector3`, `Quaternion`, `Pose` | PearCore | world frame (overview.md Coordinate Frame) is right-handed, +X right, +Y up, −Z forward (RealityKit convention); every live source converts from its device frame (AirPods: `[x, z, −y, w]`) |
| `InputFrame` | PearCore | **(plan decision)** lets PearRuntime avoid more than PearInput's protocols |
| `OutputCommand` | PearCore | **(plan decision)** lets PearRuntime queue commands without PearOutput |
| `TouchPoint`, `GestureEvent`, `PencilState` | PearCore | **(plan decision)** channel payload types, shared by `UsisChannels` and `InputFrame` |
| `DeviceSample` | PearCore | **(plan decision)** one device's entry in an `InputFrame`; carries no `source` |
| `OutputType` | PearCore | **(plan decision)** `haptic` / `audio` for `OutputCommand` |
| `WireMessage`, `LineFraming` | PearCore | **(plan decision)** companions depend only on PearCore |
| `InputSource`, `InputBus`, `CapabilityTier`, `DeviceStats` | PearInput | `DeviceStats` is the only place `source` survives |
| `DeviceDescriptor`, `ChannelKind`, `PacketValidationError`, `HostClock` | PearInput | **(plan decision)** supporting types for sources, capability tiers, validation and the host clock |
| `OutputSink` | PearOutput | |
| `GameEvent`, `EventDispatcher`, components, systems | PearRuntime | |
| `EventDeriver`, `OutputQueue`, `TriggerProbe` | PearRuntime | **(plan decision)** detector extension point, per-frame output buffer and the trigger-test point type |
| `SceneDescription`, `SceneLoader` | PearRuntime | **(plan decision)** scene file format not in overview.md |
| `ScriptEngine`, `SelfBridge`, `ContextBridge`, `ScriptReloader` | PearScript | |
| `ServerScriptEngine`, `RemoteChannel` | PearScript | server scripts and the remote-event seam (overview.md Module 3) |
| `CloudClient` | PearCloud | **(plan decision)** one HTTP client for sign-in, publish and fetch |
| `CatalogEntry` | PearCloud | **(plan decision)** one row of the public library (id, title, author, latest version, run mode, required tier) |
| `DeviceProfile`, `Playability`, `LibraryModel` | PearLibrary | **(plan decision)** what this device is, whether it can play an entry, and the browse state |
| `StoredSession`, `SessionStore`, `GameSource`, `GameLauncher`, `LaunchResult` | PearLibrary | **(plan decision)** the persisted sign-in, the fetch seam and the launch seam; `StubGameLauncher` is the only launcher this round |

## Apple Framework Use

| Package / target | Frameworks |
|---|---|
| PearCore | Foundation only |
| PearInput | Foundation, Synchronization (`Mutex`) |
| PearOutput | none (PearCore only) |
| PearRuntime | RealityKit, simd |
| PearScript | JavaScriptCore, RealityKit (`SelfBridge` sets `AudioEmitterComponent`) |
| PearSim | RealityKit (sensor rig), Synchronization |
| PearBridge | Network, CoreMotion (`CMHeadphoneMotionManager`), Synchronization |
| PearCollab | Automerge for Swift (third party; not added yet) |
| PearAdapters | CoreBluetooth (not used yet) |
| PearCompanion iOS | Network (via `Shared/BridgeClient.swift`), CoreMotion, Core Haptics, WatchConnectivity, SwiftUI, UIKit |
| PearCompanion watchOS | HealthKit, CoreMotion, WatchConnectivity, SwiftUI |
| PearCloud | Foundation (`URLSession`) |
| PearLibrary | Foundation, Security (Keychain), Observation, Synchronization (`Mutex` in the in-memory session store) |
| PearPlayer | SwiftUI, AuthenticationServices (Sign in with Apple) |
| PearStudio | SwiftUI, RealityKit, AppKit, Observation, Synchronization |
| Backend (Rust, not Apple) | axum (with `ws`), tokio, sqlx (Postgres), serde, serde_json, rquickjs 0.9 (provisional; deno_core not picked), jsonwebtoken 12 (`rust_crypto`) and reqwest 0.12 (`rustls-tls`) for Sign in with Apple (Phase 9), getrandom 0.3 for session tokens |

## File Structure

Full paths and per-file responsibilities are in `plan.md`. Phase tag in brackets is the phase that creates the file.

```
Pear.xcworkspace/
  contents.xcworkspacedata                          [P1]
.gitignore                                          [P1]
Schema/
  usis.schema.json                                  [P1]
Recordings/
  demo-fallback.usis.jsonl                          [P5]

Packages/
  PearCore/
    Package.swift                                   [P1]
    Sources/PearCore/
      Math/        Vector3.swift  Quaternion.swift  Pose.swift                        [P1]
      USIS/        UsisEnums.swift  UsisChannels.swift  UsisPacket.swift              [P1]
      Frame/       InputFrame.swift                                                   [P1]
      Output/      OutputCommand.swift                                                [P1]
      Wire/        WireMessage.swift  LineFraming.swift                               [P3]
    Tests/PearCoreTests/
      QuaternionTests.swift  UsisPacketTests.swift                                    [P1]
      LineFramingTests.swift                                                          [P3]

  PearInput/
    Package.swift                                   [P1]
    Sources/PearInput/
      InputSource.swift  InputBus.swift  PacketValidator.swift  ClockSync.swift
      JitterBuffer.swift  Calibration.swift  CapabilityTier.swift  DeviceStats.swift
      InputPipeline.swift                                                             [P1]
    Tests/PearInputTests/
      PacketValidatorTests.swift  ClockSyncTests.swift  JitterBufferTests.swift
      CalibrationTests.swift  SourceStrippingTests.swift                              [P1]

  PearOutput/
    Package.swift                                   [P1]
    Sources/PearOutput/
      OutputSink.swift                                                                [P1]

  PearRuntime/
    Package.swift                                   [P1]
    Sources/PearRuntime/
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
    Tests/PearRuntimeTests/
      SceneRunnerTriggerTests.swift                                                   [P1]
      LookAtDetectorTests.swift  HeartRateIntensityTests.swift                        [P2]
      GestureEventMapperTests.swift  RaycastHitDetectorTests.swift                    [P2]
      AudioListenerSystemTests.swift  SceneLoaderTests.swift                          [P2]

  PearScript/
    Package.swift                                   [P1]
    Sources/PearScript/
      Module.swift                                  [P1, removed P2]
      Resources/prelude.js                                                            [P2]
      SelfBridge.swift  ContextBridge.swift  ScriptEngine.swift  ScriptReloader.swift [P2]
      RemoteChannel.swift  ServerScriptEngine.swift                                   [P2]
    Tests/PearScriptTests/
      ScriptEngineTests.swift  ServerScriptEngineTests.swift                          [P2]

  PearSim/
    Package.swift                                   [P1]
    Sources/PearSim/
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
    Tests/PearSimTests/
      UsisRecorderPlayerTests.swift  NoiseModelTests.swift                            [P2]
      SimPipelineTests.swift                                                          [P2]
      PresetLibraryTests.swift  RigTests.swift  SimOutputSinkTests.swift              [P2, extra]

  PearBridge/
    Package.swift                                   [P1]
    Sources/PearBridge/
      Module.swift                                  [P1, removed P3]
      BonjourListener.swift  DeviceSession.swift  BridgeInputSource.swift
      BridgeOutputSink.swift  AirPodsMotionSource.swift                               [P3]
    Tests/PearBridgeTests/
      DeviceSessionTests.swift                                                        [P3]
      AirPodsMotionSourceTests.swift  BonjourListenerTests.swift
      BridgeSourceSinkTests.swift                                                     [P3, extra]

  PearCollab/                                                                         (stretch)
    Package.swift                                   [P1]
    Sources/PearCollab/
      Module.swift                                  [P1, removed P6]
      ProjectDocument.swift  PeerSync.swift  Presence.swift                           [P6]

  PearAdapters/                                                                       (stretch)
    Package.swift                                   [P1]
    Sources/PearAdapters/
      Module.swift                                  [P1, stays until P7]

  PearCloud/
    Package.swift                                   [P4]
    Sources/PearCloud/
      CloudClient.swift                                                               [P4]
    Tests/PearCloudTests/
      CloudClientTests.swift                                                          [P4]
      LibraryAPITests.swift                                                           [P9]

  PearLibrary/                                                                        (Phase 9)
    Package.swift                                   [P9]
    Sources/PearLibrary/
      DeviceProfile.swift  Playability.swift  SessionStore.swift
      LibraryModel.swift  GameLauncher.swift                                          [P9]
    Tests/PearLibraryTests/
      DeviceProfileTests.swift  PlayabilityTests.swift  LibraryModelTests.swift       [P9]

Apps/
  PearStudio/
    PearStudio.xcodeproj/project.pbxproj            [P1]
    PearStudio/
      PearStudioApp.swift                                                             [P1]
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
      Game/        GameLoader.swift                                                   [P4, extra]
      Collab/      PresenceOverlayView.swift                                          [P6]

  PearCompanion/
    PearCompanion.xcodeproj/project.pbxproj         [P3]
    Info.plist  Watch-Info.plist  PearWatch.entitlements                              [P3, extra]
    Shared/        BridgeClient.swift                                                 [P3]
    iOS/           PearCompanionApp.swift  MotionStreamer.swift  TouchCapture.swift
                   HapticPlayer.swift  WatchConnectivityReceiver.swift                [P3]
    watchOS/       WatchApp.swift  HeartRateWorkout.swift
                   WristGestureDetector.swift  WatchRelay.swift                       [P3]

  PearPlayer/                                       (Phase 9: iOS + iPadOS + macOS player app; library shell, plus Play since 1f083b8)
    PearPlayer.xcodeproj/project.pbxproj            [P9]
    PearPlayer.entitlements  Info.plist             [P9, Info.plist extra]
    PearPlayer/
      PearPlayerApp.swift  PlayerModel.swift                                          [P9]
      Account/     AppleSignInView.swift                                              [P9]
      Library/     LibraryView.swift  GameDetailView.swift                            [P9]
      Theme/       PearTheme.swift  PearGizmoMark.swift                                [P9, extra]

Tools/                                              (plan decision: hardware probes, no Pear deps, no graph edges)
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
- **(plan decision, Phase 8)** `Web/` is an npm-workspace TypeScript SDK + Studio (`Web/packages/pear-{core,runtime,script,sim,cloud}`, `Web/studio`, desktop shell `Web/studio/src-tauri`), mirroring the Swift package boundaries for a browser / desktop Studio. Contracts are shared by importing the same files, never copies. `Deploy/` holds the Dockerfile, compose, Caddyfile and Vultr scripts; the backend image serves the built Studio. overview.md now lists the web Studio under Additional surfaces.
- **(plan decision, Phase 12.1)** Game instructions (setup, roles, phases) live in `Web/packages/pear-runtime/src/instructions.ts`: pure parse and lint, importing `pear-core` (gestures) and `scene.ts` only, so no new package edge. Studio's `project.ts` and `projectFile.ts` carry them in the project snapshot (optional `instructions`), and a cloud save keeps them in the version's `metadata.instructions` (no backend change). The Deep Agents plugin (12.2) takes `prompt` with `mode: 'instructions'` (its `submit_instructions` tool checks the object, the runtime answers with one `file_written` `instructions.json`, which Studio holds as a proposal), and `decide` / `report` for agent players (`runtime/players.py`, one deep agent per run and player, no project or disk access); the agent players' Studio side (12.3): `pear-runtime/src/observation.ts` (pure `buildObservation` of what a person in the room perceives, and `parseActions`, matching `players.py`), `Web/studio/src/pauseClock.ts` (a pausable clock that `RunController` injects into `LocalRun`, `SimDevices` and the in-page `LocalServer`, so the run stands still while an agent thinks), `agentTransport.ts` (one socket to the plugin runtime for `decide` and `report`; URL from `MarketplaceController.runtimeUrlOf`), `agentPlayers.ts` (one driver per agent player) and the Test panel's Agent controls; the playtest report (12.4): `playtestReport.ts` (pure grouping and revise prompt), `playtestView.ts`, a look back per agent (`AgentDriver.lookBack`, one `report` call) started from the Test panel's Finish playtest, `RunController.report`, and a `ChatLink` that fills the Deep Agent panel's prompt; the instructions panel (12.5): `instructionsPanel.ts` (edit form, scene check, proposal diff with Accept and Reject, and the playtest report), opened from View or Window. Instructions first (12.6): `newGame.ts` is the New game form (a game cannot be created without instructions), `project.ts` `playerLimits` and `setPlayers` keep one player limit across the instructions and the scene's declared inputs, local Play starts with that many players and nobody driven (`ViewportHost` can show a run with no driven player), and agents are started from the Playtest panel (12.7): `playtestPlan.ts` (crews, budgets, role assignment, the words of the play-by-play), `playtestPanel.ts`, a per-agent log in `AgentDriver`, and `RunController.startPlaytest`; Blank is an empty floor and the old cube loop is the Tap counter template.

- `PearStudio` is the composition root: it constructs the `InputPipeline`, the active `InputSource` / `OutputSink` pair, the `ScriptEngine` and the `SceneRunner`, and wires them together, in `AppModel.swift`. No package does this wiring. `AppModel` also drains the runtime's `OutputQueue` into the active sink each frame; `ModeController` (P3) takes over choosing the source/sink pair. (Changed 2026-11-14: as built, `AppModel` constructs the `InputPipeline`, `SceneRunner`, one sim head device, a `RecordingOutputSink` placeholder, the `ModeController` and `DemoMode`, but no `ScriptEngine`; `ModeController` builds the live `BridgeInputSource`, `BridgeOutputSink` and `BonjourListener`; `ScriptEngine` and `ServerScriptEngine` are constructed only in `LocalTestSession`. `ScriptEditorView`, `InspectorView`, `SimulatorPanelView` and `DebugOverlayView` exist but are not mounted in the window yet.) (Changed 2026-11-14: `AppModel` now also builds a `ScriptEngine` and, for games with server scripts, a `ServerScriptEngine`, joined by `InMemoryRemoteChannel`; it loads games through `GameLoader` and owns the `CloudClient` / `AccountModel` for Open from cloud.)
- **(plan decision)** `SceneDescription.requiredTier` is a plain `Int` (1…3), so `PearRuntime` stays off `CapabilityTier`; Studio maps it to `CapabilityTier` for the capability warning.
- `BridgeClient` is shared by the iOS and watchOS targets under `Apps/PearCompanion/Shared/`; the Watch reaches the Mac through the phone via `WatchRelay` → `WatchConnectivityReceiver`.
- `Games/Flagship` holds data (scene + JS) only, so it cannot import Swift packages by construction; it reaches the engine through `PearScript`'s `self` / `ctx` API.
- Cloud game hosting (`overview.md` Module 11): `PearCloud` is the Mac-side client and `Backend/` is the Rust server. Published games are data only (scene + client scripts + server scripts + assets + metadata), the same shape as `Games/Flagship`, and are stored in Postgres on Vultr; sensor data (USIS) and output commands never go there.
- Only `PearStudio` (the composition root) depends on `PearCloud`. It fetches a published game and hands the scene and script sources to `PearRuntime` / `PearScript`. `PearCloud` carries game content only, never input, so the hardware-blind property holds. (Changed 2026-11-14: since Phase 9 `PearLibrary` and `PearPlayer` also depend on `PearCloud`; `PearLibrary` is a package of its own so its logic is tested with `swift test`. **(plan decision)** until overview.md Module 11 is updated.)
- **(plan decision)** `PearPlayer` (Phase 9) is a second composition root: it builds `CloudClient`, the session store, `DeviceProfile`, `LibraryModel` and a `GameLauncher` in `PlayerModel.swift`. Identity is Sign in with Apple; `DeviceProfile` only flags which games the device can play. Play is a stub (`StubGameLauncher` fetches the bundle and stops); running a game on the player needs `.iOS(.v18)` on PearInput, PearRuntime, PearScript and PearOutput, which are macOS-only today (`PearCore` already declares iOS; `PearCloud` gets it in 9.2). overview.md now lists the player app under Additional surfaces.
- `LocalTestSession` (Studio) is the composition root for a multiplayer test: one `ServerScriptEngine` plus several simulated players, each with its own `InputPipeline`, `SceneRunner` and client `ScriptEngine`, joined by an in-memory `RemoteChannel`. **(plan decision)** The viewport shows one selected player.
- **(plan decision)** `Backend/src/game_server/script_host.rs` implements the same `serverScript` API as `ServerScriptEngine` in a different JS engine; `Backend/tests/script_host.rs` and `ServerScriptEngineTests.swift` run the same fixture so the two stay aligned.
- **(plan decision)** `Backend/src/game_server/script_host.rs` includes `Packages/PearScript/Sources/PearScript/Resources/prelude.js` with `include_str!`, so the Rust and Swift engines share one `serverScript` definition. This is a file-level edge from `Backend/` into a Swift package: `Backend/` no longer builds standalone (Windows laptops need the whole repo checked out), and a change to `prelude.js` affects both engines. `overview.md` describes `Backend/` as a separate Rust project; the mismatch is flagged, not decided.
- `Tools/` holds validation tests that prove data can actually be read from each peripheral; it is not production code. (Changed 2026-11-14: these were the only working peripheral code until Phase 3; the production sources now exist in `PearBridge` and `PearCompanion`, and the probes remain for reference.) They are: `AirPodsProbe` (AirPods head motion on the Mac via `CMHeadphoneMotionManager`), `PhoneProbe.swiftpm` (iPhone motion, touch and haptics over Bonjour + TCP) and `PhoneProbeHost` (the Mac side that receives it). They are standalone probes with no Pear package dependencies; their measured results are recorded in `plan.md` (Cross-Cutting: Hardware verification). The production sources are built from them in Phase 3: `AirPodsMotionSource` and the `PearBridge` session code on the Mac, `MotionStreamer` / `TouchCapture` / `HapticPlayer` / `BridgeClient` in `PearCompanion`.
- **(plan decision)** `SceneDescription.runMode` (`screen` / `device`) is the game's declared run mode (overview.md Module 7).
