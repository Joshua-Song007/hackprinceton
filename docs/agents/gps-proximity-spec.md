# Spec: GPS, proximity and Swift parity (for a Mac worker)

Written on Windows; no Swift was changed or built. Everything here needs `xcodebuild` / `swift test` output in the PR.

## Why

Real-world tag (tag, as in `Games/Manhunt`) needs player positions and a tag gesture from real devices. The web Studio simulates both. Rule (decided): positions reach the game server only as derived game events a script sends (`ctx.remote.fire("pos", ...)`), gated per game by `scene.permissions.location`. Raw USIS never leaves the local network.

## 1. Swift parity for the new script API

The shared `prelude.js` and the Rust / TS hosts now have these; the Swift engines ignore them until updated:

- Server: `onTimer(ctx, tag, data)`, `ctx.after(ms, tag, data)` returns an id, `ctx.cancel(id)`, `ctx.now()`; limits 50 ms to 1 h, 64 pending, cleared on reload. `player = { id, name }`.
- Client: `onTick(self, ctx, dt)` at 5 Hz, `ctx.player.id` (from a `_welcome` frame `{id, name}`), `ctx.position` (null unless `permissions.location`).
- Scene: entity `shape` (`box` | `sphere`) and `color`; scene `permissions.location`.
- Files: `ServerScriptEngine.swift`, `ScriptEngine.swift`, `ContextBridge.swift`, `SceneDescription.swift`, `SceneLoader.swift`.
- Tests: the shared server fixture in `Backend/tests/script_host.rs` and `Web/packages/pear-script/test/server-local.test.ts` must also pass in `ServerScriptEngineTests.swift`; add timer, welcome and `onTick` cases mirroring `Backend/src/game_server/session.rs` tests.

## 2. Location source (companion)

- `PearCompanion` iOS: `CLLocationManager` source emitting USIS `position` in local meters east / north about a game origin (server sends `_origin` lat / lon; until then the first fix). Map east to +X, north to -Z.
- Carry horizontal accuracy: add an optional `accuracy` (meters) to the `position` channel in `Schema/usis.schema.json` and `UsisChannels.swift` (a schema change, flag to the user). The web Studio currently sends a fixed `acc: 2` in scripts.
- Foreground only (iOS suspends the companion ~0.5 s after backgrounding). Info.plist needs `NSLocationWhenInUseUsageDescription`.
- Show a visible "Sharing location" indicator in Studio and the companion while a game with `permissions.location` runs.

## 3. Touch-range tagging

GPS is 3 to 10 m, too coarse for tapping someone. Use Nearby Interaction (U1 / U2 UWB) for sub-meter range between two phones, delivered as a derived event (`near` with distance), not a raw stream. Optional; the server already combines range with both players' reported accuracy.

## 4. Tag hand

AirPods head motion (nod / lunge) and Watch wrist swing already produce gestures through `AirPodsMotionSource` and `WristGestureDetector`. A tag game's client can treat `tap` or `flick` as a tag; map a lunge to `flick`.

## 5. Proposed plan.md entries (the user applies these; `.claude/` is human-only)

```
### 9.x Phase 10: Real-world tag (Mac worker)
- [ ] `Packages/PearScript/Sources/PearScript/ServerScriptEngine.swift` — onTimer, ctx.after / cancel / now, player name (parity with script_host.rs).
- [ ] `Packages/PearScript/Sources/PearScript/ScriptEngine.swift` — onTick at 5 Hz, ctx.player.id, ctx.position gated by permissions.location.
- [ ] `Packages/PearRuntime/Sources/PearRuntime/Scene/SceneDescription.swift` — shape, color, permissions.location.
- [ ] `Schema/usis.schema.json` — position accuracy field.
- [ ] `Apps/PearCompanion/iOS/LocationStreamer.swift` — CLLocationManager to USIS position.
```

## 6. overview.md items to flag (not decided)

- Network Rule says sensor data never leaves the local network; with `permissions.location`, derived positions reach the game server as remote events. Wording needs the user's decision.
- Web Studio exists next to the native macOS Studio (already flagged in Phase 8).
- Player apps (Phase 9) as a second composition root (already flagged).
