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
