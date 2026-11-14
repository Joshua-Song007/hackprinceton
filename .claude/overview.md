This document outlines the system architecture, package boundaries, and operational concepts for a native, omni-modal AR game platform (working title Omni). It is a macOS creator app where every Apple device a player carries is a spatial sensor node, all streaming one standardized JSON input format into a shared 3D coordinate system. A built-in 3D Device Simulator lets creators build and test without owning the hardware. Games built on the platform are hosted in the cloud, like Roblox: once a creator publishes a game, it lives in a cloud database and is no longer tied to the creator's Mac. Only game content goes to the cloud; live sensor data stays on the local network.
The PRD defines what we ship and why; this blueprint defines how it is built. If code drifts from the boundaries here, flag the mismatch rather than assuming the code has quietly redefined the design.
Technical Stack Overview
Subsystem
Technology Selection
Architectural Rationale
Language & App
Swift 6 + SwiftUI, native macOS creator app
Direct access to CoreMotion, CoreBluetooth, Network.framework and RealityKit; one language for the app, the companions and the shared packages.
3D / Rendering
RealityKit
Apple's spatial engine: entities, components, raycasts and spatial audio, with the same scene format on macOS, iOS and visionOS later.
Input Format
USIS v1: JSON packets defined by usis.schema.json
One standardized, versioned contract for every device, real or simulated. Swift Codable types mirror the schema.
Device Transport
Network.framework (Bonjour discovery + local TCP) behind an InputBus protocol
Companions find the Mac automatically on the local network; sensor data never leaves it. Transport can change (Multipeer, Bluetooth) without touching game code.
Native Sensors
iOS + watchOS companion apps; AirPods read directly on the Mac via CMHeadphoneMotionManager
Phone motion, touch and haptics; Watch heart rate and wrist gestures (HealthKit, WatchConnectivity through the phone); AirPods head pose.
Spatial Audio
RealityKit spatial audio
Listener follows AirPods head pose.
Scripting
JavaScript via JavaScriptCore (built into Apple OSes); Lua as stretch
Sandboxed creator scripts without shipping a VM.
Collaboration (stretch)
CRDT project document (e.g. Automerge for Swift) synced between Bonjour peers; relay server later
Conflict-free shared editing of scenes and scripts.
Game Hosting
Cloud database (backend to be chosen)
Published games (scene, scripts, assets, metadata) are stored in and served from the cloud, like Roblox. Only game content goes to the cloud; sensor data never does.
Repo
Xcode workspace + local Swift packages
Module boundaries enforced by package dependencies, not by network services.
Modular Workspace Architecture
The platform is one Xcode workspace of local Swift packages, not a distributed system. Modularity is enforced by package dependencies and protocol seams. That way live ↔ simulated input, device transports and scripting backends can be swapped without touching game code. The one cloud-facing part is game hosting (Module 11); the input and runtime path stays entirely local.
Package
Owns
May depend on
OmniCore
Math and domain types (Pose, quaternions, vectors) and the USIS Codable types. Pure, no I/O.
nothing
OmniInput
InputSource and InputBus protocols, JSON decode + schema validation, clock sync, jitter buffer, calibration, capability tiers
OmniCore
OmniRuntime
RealityKit scene runner, components and systems, triggers, derived input events
OmniCore, OmniInput (protocols only)
OmniScript
JavaScriptCore sandbox and the creator scripting API
OmniRuntime
OmniOutput
OutputSink protocol for haptics and audio cues sent back to devices
OmniCore
OmniSim
Virtual devices implementing InputSource / OutputSink, gesture presets, recording and playback of .usis.jsonl files
OmniCore, OmniInput, OmniOutput
OmniBridge
Bonjour service on the Mac, per-device sessions, AirPods CoreMotion source
OmniCore, OmniInput, OmniOutput
OmniCollab (stretch)
Shared project document (CRDT), peer sync, presence
OmniCore
OmniStudio (app target)
SwiftUI creator app: viewport, inspector, script editor, simulator panel, Sim / Live toggle
everything above
OmniCompanion (iOS + watchOS targets)
Streams phone and Watch sensors as USIS JSON; plays haptics
OmniCore
Games/<Flagship>
The flagship game, built only on the public runtime + script API
OmniRuntime, OmniScript
OmniAdapters (stretch)
Bluetooth adapter protocol for third-party peripherals
OmniCore, OmniInput
Hardware-blind property. OmniRuntime, OmniScript and every game must never depend on OmniSim or OmniBridge. Both produce identical USIS packets through the same InputSource protocol. The InputBus strips the source field before packets reach the runtime, so a game can't tell whether a head turn came from real AirPods or a gizmo dragged in the simulator. Only the Studio's debug overlay sees source. This is what makes the Sim → Live switch a one-click toggle with zero game-code changes.
Core System Architecture
 ┌──────────────────────┐             ┌────────────────────────────────────────────┐
 │ iPhone / Watch       │             │      OMNI STUDIO  (native macOS app)       │
 │ OmniCompanion apps   │             │                                            │
 └──────────┬───────────┘             │   ┌────────────────────────────────────┐   │
            │ USIS JSON               │   │          OmniInput layer           │   │
            │ Bonjour / local TCP     │   │  schema check · clock sync ·       │   │
            ▼                         │   │  jitter buffer · calibration       │   │
 ┌──────────────────────┐             │   └─────────────────┬──────────────────┘   │
 │ OmniBridge           ├────────────►│                     │ InputFrame (world)   │
 │ (Bonjour service)    │◄─ haptics ──┤                     ▼                      │
 └──────────────────────┘             │   ┌────────────────────────────────────┐   │
                                      │   │   OmniRuntime  (RealityKit scene)  │   │
 ┌──────────────────────┐ USIS JSON   │   │  triggers · systems · JS scripts   │   │
 │ AirPods              ├────────────►│   └───────┬───────────────────┬────────┘   │
 │ (CoreMotion on Mac)  │             │           │ render + audio    │ OutputCmd  │
 └──────────────────────┘             │           ▼                   ▼            │
                                      │       viewport           OutputSink        │
 ┌──────────────────────┐ synthetic   │                                            │
 │ OmniSim              │ USIS JSON   │  same InputSource / OutputSink protocols   │
 │ (virtual devices)    ├────────────►│  for live devices and the simulator        │
 └──────────────────────┘             └────────────────────────────────────────────┘
(Runtime data flow. Live devices and the simulator plug into the same InputSource / OutputSink seams; see Modular Workspace Architecture for the package boundaries behind each box.)
High-Level Module Specifications
Module 1: Universal Spatial Input Schema (USIS) & Input Layer
• Package: OmniInput (types in OmniCore)
• Core Responsibility: Defines the one standardized JSON format that every peripheral, real or simulated, is converted into. It then turns asynchronous, differently-timed packets into one world-space snapshot per frame.
• Source of Truth: usis.schema.json (JSON Schema), versioned by the v field. Swift Codable structs in OmniCore mirror it. Companions, the simulator and third-party adapters target the schema, not Swift types. Packets that fail validation are dropped and counted in the debug overlay.
• Packet (v1):
{
  "v": 1,
  "deviceId": "watch-1",
  "kind": "watch",
  "slot": "leftWrist",
  "source": "live",
  "t": 1731550000123,
  "seq": 4182,
  "ch": {
    "orientation": [0.0, 0.707, 0.0, 0.707],
    "accel": [0.02, -9.79, 0.11],
    "heartRate": 128,
    "gesture": { "type": "flick", "dir": [1, 0, 0] }
  }
}
• Envelope Fields: kind = phone, tablet, airpods, watch, pencil, headset or custom. slot = head, leftWrist, rightWrist, hand, pocket or stylus. t = device timestamp in ms. seq = per-device counter for gap detection. source = live or sim, stripped by the InputBus before the runtime.
• Channel Conventions:
Channel
JSON type
Units / convention
orientation
[x, y, z, w]
Unit quaternion, device attitude before calibration, in Omni axes (see Coordinate Frame)
position
[x, y, z]
Meters, world frame after calibration
accel
[x, y, z]
m/s², device frame, in Omni axes (CoreMotion reports g; sources multiply by 9.81)
touch
[{ id, x, y, phase }]
Screen coords normalized 0–1; phase = began, moved, ended
gesture
{ type, dir? }
type = tap, doubleTap, flick, squeeze, pinch
heartRate
number
bpm
pencil
{ tip, pressure, roll, hover }
Meters, 0–1, radians, meters
• Coordinate Frame: every USIS vector and quaternion uses one right-handed frame: +X right, +Y up, −Z forward (RealityKit's convention). Each source converts from its native frame before emitting. CoreMotion frames are Z-up; the AirPods frame was measured as X right, Y forward, Z up, so AirPods map vectors (x, y, z) → (x, z, −y) and quaternions [x, y, z, w] → [x, z, −y, w]. The iPhone frame was measured as X right edge, Y top edge, Z out of the screen, so the phone uses the same mapping, and pointing the phone's top edge is Omni forward. The Watch frame is converted the same way once measured.
• Format Rules: a packet carries only the channels that changed. Unknown channels are ignored, so newer devices don't break older apps. A breaking change bumps v.
• Recording: input sessions save as .usis.jsonl (one packet per line). Simulator gesture presets are just recorded files, and a bug report can attach a recording to replay.
• Capability Tiers: games declare the tier they need; the Studio warns when the connected (or simulated) devices can't satisfy it.
    ◦ Tier 1: 3DOF orientation + touch (phone, AirPods)
    ◦ Tier 2: 6DOF pose + hand tracking (LiDAR phone, headset)
    ◦ Tier 3: biometrics / gaze (Watch heart rate, headset eye tracking)
• Clock Sync: on connect, each source runs a short ping exchange; offset = t_host − (t_send + rtt/2), re-estimated every few seconds. All timestamps are converted to host time.
• Jitter Buffer: devices sample at different rates (AirPods 50 Hz, measured, steady 20 ms intervals; Watch ~1–10 Hz, phone motion 100 Hz, measured; phone touch ~60 Hz on the tested phone). Each device keeps a short ring buffer, and the frame samples at t_render = now − D (start with D = 50 ms). For the two samples bracketing t_render, u = (t_render − t_a) / (t_b − t_a):
    ◦ orientation: slerp(q_a, q_b, u)
    ◦ vectors: lerp(v_a, v_b, u)
    ◦ scalars like heart rate: sample-and-hold, smoothed with an EMA
    ◦ a device with no packet for 500 ms is flagged stale; its channels freeze rather than crash the loop.
• Calibration (T_device→world): the player faces "forward" and taps once; the layer captures q_cal and applies q_world = q_cal⁻¹ · q_raw. AirPods use yaw-only calibration (gravity already fixes pitch and roll).
Module 2: Game Runtime Engine
• Package: OmniRuntime
• Core Responsibility: Runs the RealityKit scene each frame from an InputFrame snapshot. It never reads device APIs, sockets or simulator state.
• Model: RealityKit entities with custom components (Trigger, AudioEmitter, Script) and systems that run each update.
• Derived Input Events: the runtime turns raw channels into game-level events so scripts stay simple:
    ◦ onLookAt(entity): head forward vector f vs direction to the entity s; fires when acos(f · ŝ) < θ_lock (start at 15°) for 0.5 s. This powers audio lock-on.
    ◦ onGesture(type): tap, double-tap, flick, squeeze, pinch from any device.
    ◦ onHeartRate(bpm) plus a normalized intensity d = clamp((HR − HR_rest) / (HR_max − HR_rest), 0, 1) for biometric difficulty (e.g. enemy aggression = base · (1 + k·d)).
    ◦ onRaycastHit(entity) from phone aim or simulator gaze.
• Physics: RealityKit collision for triggers and raycasts; full physics simulation off by default in v1.
Module 3: Scripting Layer
• Package: OmniScript
• Core Responsibility: The creator-facing API. Scripts attach to entities and react to events; they can change state, spawn entities, play sounds and send output commands.
• Shape:
export default script({
  onLookAt(self, ctx) { self.audio.play("growl"); },
  onGesture(self, ctx, g) { if (g.type === "flick") ctx.spawn("fireball", { dir: g.dir }); },
  onHeartRate(self, ctx, bpm) { self.speed = 1 + 0.5 * ctx.intensity; },
});
• Sandbox: scripts run in JavaScriptCore and see only self and ctx (exposed through JSExport). No file, network or raw USIS access. Hot-reloaded from the Studio editor.
• Stretch: a Lua backend behind the same event API.
Module 4: 3D Device Simulator
• Package: OmniSim
• Core Responsibility: Lets a creator test every mechanic on a Mac alone by emitting synthetic USIS packets identical to real ones.
• Virtual Sensor Rig: a 3D avatar in a RealityKit viewport with device slots (head, wrists, hand, pocket, stylus). Clicking a slot spawns a virtual device (AirPods, Watch, iPhone, Pencil) that implements InputSource.
• Controls:
    ◦ Transform gizmos and sliders for orientation and position.
    ◦ Mouse-driven gaze raycast from the head; click = pinch.
    ◦ Heart-rate slider and a "spike" button.
    ◦ Gesture presets: recorded .usis.jsonl timelines ("AirPods head pitch", "Watch double-tap", "Watch flick", "Pencil barrel roll") played with one click.
• Feedback Visualization: implements OutputSink, so haptic and audio commands show up on the virtual device (pulse ring, vibration icon, sound cone around the head).
• Fidelity Rule: simulated sample rates and noise should roughly match real devices, so the jitter buffer is exercised in Sim mode too.
Module 5: Hardware Bridge & Companion Apps
• Packages: OmniBridge (on the Mac), OmniCompanion (iOS + watchOS)
• Core Responsibility: Gets real device data into USIS JSON with minimal latency and sends output commands back.
• Sources:
    ◦ iPhone / iPad (P0): companion app streams CoreMotion orientation, touch and optional ARKit pose; plays Core Haptics patterns. Measured on an iPhone: motion at 100 Hz with no loss, touch ~60 events/s, Wi-Fi round trip ~8 ms standing. The companion only streams in the foreground with the screen on: iOS suspends it within ~0.5 s of backgrounding or locking, and it reconnects ~1 s after the player returns.
    ◦ AirPods (P1): read directly on the Mac with CMHeadphoneMotionManager when paired to it, so no companion is needed. Orientation, rotation rate and acceleration only (no position). Data streams from one bud at a time; when the streaming bud is removed the other takes over after a ~1.4 s gap with an orientation jump of up to ~90°, so the source re-anchors on a bud change. The Mac app needs NSMotionUsageDescription, and AirPods auto-switching to the iPhone must be off for demos.
    ◦ Apple Watch (P1): watchOS app reads heart rate (workout session) and wrist gestures, relayed through the phone with WatchConnectivity.
• Discovery: the Mac advertises a Bonjour service; companions find it and connect over local Wi-Fi or a hotspot.
• Network Rule: never route sensor data through the cloud. Only published game content is cloud-hosted (Module 11).
• Resilience: auto-reconnect with backoff; per-device seq gap detection; a dropped device goes stale instead of stopping the game.
Module 6: Output & Feedback Layer
• Package: OmniOutput
• Core Responsibility: One OutputSink protocol for everything the game sends back to the player: haptic pulses (phone, Watch), spatial audio cues, and device-specific effects.
• Command (JSON, same envelope rules as USIS): { "target": "<deviceId | slot>", "type": "haptic" | "audio", "pattern": "...", "intensity": 0–1, "durationMs": 120 }. The live sink forwards it over the bridge; the simulator sink visualizes it.
• Spatial Audio: the RealityKit audio listener follows the head pose from the InputFrame, so turning your head changes what you hear.
Module 7: Omni Studio (Creator App)
• Package: OmniStudio (macOS app target)
• Core Responsibility: The Roblox-Studio-style workspace: scene viewport, entity inspector, script editor, simulator panel, device status and the Sim / Live toggle.
• Debug Overlay: live view of raw USIS JSON per device (rate, latency, stale flags, source, schema errors).
Module 8: Collaborative Coding Space (stretch)
• Package: OmniCollab
• Core Responsibility: Lets several creators edit the same project at once, like Roblox Team Create: scene, entity properties and scripts.
• Data Model: the project is one CRDT document holding the scene graph and every script's source text. Each edit is a CRDT change, so simultaneous edits merge without conflicts.
• Sync: peers find each other with Bonjour on the same network for the hackathon; a relay server for remote teams later.
• Presence: collaborators' cursors in the script editor, selection highlights in the viewport, and "who's editing" badges on entities.
• Play Testing: any collaborator can press Play locally. Game state is not synced (that would be multiplayer gameplay, which is out of scope).
• Boundary: OmniCollab syncs the project only and never touches input, so the hardware-blind property holds.
Module 9: Flagship Game
• Package: Games/<Flagship>
• Core Responsibility: Proves the platform is fun. It must use at least two input types and be playable in under 60 seconds by a stranger.
• Rule: built only through the public runtime and script API, so it doubles as proof that a creator can build on the platform.
Module 10: Peripheral Adapters (stretch)
• Package: OmniAdapters
• Contract: func parse(_ bytes: Data) -> USISChannels plus a device descriptor (kind, slot, sample rate), over CoreBluetooth. An adapter's only job is to emit standard USIS JSON, so nothing downstream changes when a device is added.
• Not this weekend: shipping any third-party adapter. The protocol is documented so Joy-Cons, haptic gloves or ESP32 motion bands can be added later.
Module 11: Cloud Game Hosting
• Package: not yet assigned. The package boundary is decided before anything is built.
• Core Responsibility: Stores and serves the games creators build, like Roblox. Publishing from Studio saves a game version to a cloud database; a game is loaded from there, not from the creator's machine.
• What is hosted: a game is data only: its scene description, scripts, assets and metadata (title, author, version). This is the same shape Games/<Flagship> already has, so no Swift code or device-specific content is ever uploaded.
• What is not hosted: live sensor data (USIS packets) and output commands. They stay on the local network, so the Network Rule in Module 5 is unchanged.
• Flow: Studio publishes a game version to the cloud database. To play or edit, Studio fetches that version and hands the scene and script sources to OmniRuntime and OmniScript. From there the runtime reads input only through the InputBus, as usual.
• Boundary: hosting carries game content only and never touches input, so the hardware-blind property holds and a hosted game runs the same on simulated or live input. OmniRuntime, OmniScript and games do not depend on the cloud client; Studio, the composition root, does the fetching.
• Not decided yet: which cloud database or backend, accounts and permissions, version history, and moderation.
Frame Loop & Event Processing
Asynchronous ingest (as packets arrive):
1.  A source (live bridge or simulator) emits a UsisPacket onto the InputBus.
2.  The input layer converts its timestamp to host time and pushes it into that device's jitter buffer.
Per frame (RealityKit scene update):
1.  The input layer samples every device at t_render = now − D, applies calibration, and builds one world-space InputFrame (with source removed).
2.  The runtime derives game events (onLookAt, onGesture, onHeartRate, onRaycastHit) from the InputFrame.
3.  Scripts run their handlers in JavaScriptCore and update entity state.
4.  Triggers, raycasts and animations resolve.
5.  RealityKit renders; the audio listener follows the head pose.
6.  Output commands queued this frame are flushed to the active OutputSink (bridge or simulator).
Latency budget (target < 50 ms device-to-reaction): device sampling ~10–20 ms + local Wi-Fi ~5–15 ms + jitter delay D = 50 ms is already at the edge, so tune D down (toward 20–30 ms) once real rates are measured.
Roadmap & Operational Phases
1.  Phase 1: Workspace Scaffold & Core Runtime
    ◦ Set up the Xcode workspace with every package above, so the boundaries exist from the start rather than as a later refactor.
    ◦ Write usis.schema.json v1 and its Codable types; define InputSource, InputBus, OutputSink.
    ◦ RealityKit scene runner with a trigger firing from a hard-coded USIS packet.
2.  Phase 2: 3D Device Simulator
    ◦ Virtual sensor rig, gizmos, gaze raycast, heart-rate slider.
    ◦ JSON Lines recording and playback; gesture presets; simulator OutputSink visualization.
    ◦ Jitter buffer and derived events tested against simulated input before any live device is added.
3.  Phase 3: Live Hardware Bridge
    ◦ Bonjour service on the Mac + iOS companion streaming orientation and touch.
    ◦ Sim / Live toggle working with zero game-code changes.
    ◦ AirPods head pose on the Mac; watchOS companion if time allows; calibration tap.
4.  Phase 4: Flagship Game
    ◦ Build the game only through the public script API.
    ◦ Spend real effort on sound, visuals and feedback: no gray boxes.
5.  Phase 5: Demo Hardening
    ◦ Local hotspot, pre-paired devices, recorded fallback video.
    ◦ Five clean demo runs in a row.
6.  Phase 6: Collaborative Coding Space (stretch)
    ◦ OmniCollab: CRDT project document, Bonjour peer sync, presence in the editor and viewport.
7.  Phase 7: After the Hackathon
    ◦ Lua scripting backend, third-party Bluetooth adapters, iPad / Pencil and Vision Pro input.
    ◦ Player apps on iOS / visionOS, a relay server for remote collaboration, multiplayer gameplay, publishing games to the cloud host (Module 11).