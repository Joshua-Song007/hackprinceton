# Spec: Swift parity and native devices for the Studio redesign (P10, Mac worker)

Written on Windows; no Swift changed or built. Each item needs `swift test` / `xcodebuild` output in its PR. Builds on `docs/agents/gps-proximity-spec.md` (timers, `onTick`, `ctx.player`, `ctx.position`, `permissions.location`) and `docs/agents/studio-redesign.md`.

## 1. Scene contract (shared `scene.json`, TS already done)

TS source of truth: `Web/packages/pear-runtime/src/scene.ts`.

- `inputs`: `{ head, position, heartRate: bool, gestures: built-in names, players: [min, max] }`, all optional, players 1...32. Swift may ignore it at runtime (Studio-only), but `SceneDescription.swift` should decode and re-encode it so a native round-trip does not drop it.
- `gestures`: `{ name: { slot, axis: [x,y,z], threshold: m/s^2, cooldownMs } }`. Name: letter then letters/digits/_ (32 max), not a built-in. Axis normalized; threshold > 0; defaults slot `hand`, axis `[0,0,-1]`, threshold 20, cooldown 400.
- Files: `SceneDescription.swift`, `SceneLoader.swift`, `SceneLoaderTests.swift` (same error cases as `parseInputs` / `parseGestures`).

## 2. Custom motion gestures in the runtime

Mirror `SceneEvents.step` custom-gesture block in `Web/packages/pear-runtime/src/events.ts`: per gesture, take the non-stale device in `slot` with `accel`; `along = dot(accel, axis)`; fire `onGesture({ type: name, dir: axis })` on the rising edge past `threshold` when cooldown is 0, then cool down `cooldownMs`. Rising edge matters because accel is sample-and-hold.

- New `Packages/PearRuntime/Sources/PearRuntime/Events/MotionGestureDetector.swift` as an `EventDeriver`; tests with hand-built `InputFrame`s (fires once per swing, respects cooldown, ignores stale).
- `GameEvent.onGesture` needs a string type for custom names (today `GestureType`); `ScriptEngine.swift` passes it through.

## 3. `accuracy` channel and `ctx.positionAccuracy`

- USIS: optional `ch.accuracy` (meters, >= 0) with `position`. Rides on `ch` allowing extra channels; adding it to `Schema/usis.schema.json` is an owner decision (flagged).
- `UsisChannels.swift`, `PacketValidator.swift` (>= 0), `InputFrame` / `DeviceSample` carry it.
- `ContextBridge.swift`: `ctx.positionAccuracy`, null without the location permission or without a fix.

## 4. Companion location (unblocks real GPS testing)

As `gps-proximity-spec.md` section 2: `Apps/PearCompanion/iOS/LocationStreamer.swift`, `CLLocationManager` -> USIS `position` (local meters east +X / north -Z about the first fix) plus `accuracy` (`horizontalAccuracy`), 1 Hz, foreground only, `NSLocationWhenInUseUsageDescription`.

## 5. Companion accel for motion gestures

`MotionStreamer.swift` already sends `accel` at 100 Hz in Pear axes (m/s^2). Nothing to add for custom gestures; confirm axis mapping with a recorded swing (phone held screen up, swung forward should be strongly -Z) and record it to `Recordings/phone-swing.usis.jsonl` so the web Studio can replay a real swing.

## 6. Track B (later)

Studio Live input without the Node relay: Tauri shell embeds the bridge in Rust (Bonjour `_pear._tcp`, `LineFraming`, `WireMessage`). Companion forwards AirPods head motion via `CMHeadphoneMotionManager` on iOS as a `head` slot device. Not scheduled.

## Proposed plan.md entries (owner applies; `.claude/` is human-only)

```
### Phase 10: Studio redesign parity (Mac worker)
- [ ] `Packages/PearRuntime/Sources/PearRuntime/Scene/SceneDescription.swift` — inputs and gestures blocks.
- [ ] `Packages/PearRuntime/Sources/PearRuntime/Events/MotionGestureDetector.swift` — custom motion gestures.
- [ ] `Packages/PearCore/Sources/PearCore/USIS/UsisChannels.swift` — accuracy channel.
- [ ] `Packages/PearScript/Sources/PearScript/ContextBridge.swift` — ctx.positionAccuracy.
- [ ] `Apps/PearCompanion/iOS/LocationStreamer.swift` — GPS position + accuracy.
```
