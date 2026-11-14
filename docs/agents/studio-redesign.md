# Studio redesign: assessment and proposal

Status: proposal, nothing built. Written 2026-11-14 on Windows. Waiting for owner approval before any code.

## 1. Summary

- The Studio models one creator = one device rig = `player-1`. The games model N players, each with their own devices. That mismatch is the core problem; most of the confusion follows from it.
- Inputs a game needs (position, a tag motion) are not declared anywhere, so the Studio cannot set up a test for them or say what is missing.
- Simulated input is thinner than the real hardware: no accel, no GPS accuracy, a fixed gesture list, position taken from the AirPods head.
- Other players are random bots you cannot see, pick, steer or inspect.
- No real device can reach the web Studio. The native macOS Studio, the only place live input works, is a bare viewport with a hard-coded scene and cannot reach the game server.
- Direction: UX first, less is more. One Studio (web + Tauri), 4 panels by default, one Test panel where every player and its devices live, games declare their needs, real phones join through the same Play flow via the existing companion app and a local relay (owner decision 2026-11-14: no phone web player).

## 2. UX principles and success bar

- Bar: a first-time creator goes from Projects to a working 2-player hot potato test in under 10 min with no doc lookups. Measured by repeating the browser walk in section 3 after each build step.
- The editor always answers on screen:
  1. What does my game need (inputs, players)?
  2. What is simulated right now, and by whom?
  3. What just happened, and why? (example: "tag ignored: nearest player 7.2 m, range 5.5 m")
- One Play button. Play starts with the right players and devices already set up from the game's declared needs. Zero setup for the common case.
- Every simulated input has a visible control and a key, and using it never steals viewport focus.
- Every player is visible in the viewport and on a map, selectable by click. "Who am I driving" switches in one click.
- Feedback over silence: ignored remote events, script errors, permission gaps and unmet needs show next to their cause.
- Real devices use the same Play flow: a per-player "Use my phone" switch, not a different app.
- Less is more: every proposal below says what it removes.
  - Login: name + Sign in. Server URL moves to Settings.
  - Projects: one "Your projects" list (cloud and local merged, newest first) and one "New project" button that opens templates. No separate draft and file sections.
  - Editor default = 4 regions: Scene (entities + scripts), Viewport, Inspector (becomes the script editor when a script is selected), Test (bottom).
  - Devices + Game + the new players view merge into Test. Output + Server + State + Packets merge into one Console with a source filter; Packets behind "Advanced".
  - Toolbar: Play, Stop, Publish. "Run on server", "Add test player" and "Add bot" become choices inside Play and Test.
  - Inspector shows only what matters for the selection. Scene-wide settings (run mode, tier, permissions) move into the needs checklist, fixable inline.

## 3. Findings

### What I ran

- `cd Web && npm run typecheck`: clean. `npx vitest run`: 16 files, 119 passed, 1 skipped.
- Backend (:8080) and Vite (:5173) were already running. Drove the Studio in a browser at 1440x900 as a first-time creator making hot potato.
- Read the web and backend code paths listed in the task, plus the Swift side. Swift was not built or run.

### Browser walk (observed)

| # | Step | What happened |
|---|---|---|
| 1 | Login | Tab title "Hollow Choir - Omni Studio" on the login page: stale title from the last project. |
| 2 | Projects, Hot potato, Create | Editor opened with only the Viewport. A saved layout was restored; found Window > Default by hunting. |
| 3 | Default layout | Devices and Game tabs sit behind Explorer. Devices "Remove" buttons are clipped at the panel's left edge. |
| 4 | How do I start? | Nothing on screen says. Had to read `player.js` to learn Double tap starts a round. Double tap has no key; clicking its button moves focus off the canvas, so WASD stops. |
| 5 | Run local, Add bot | Players (2) shown only as ids in the Game tab. No bot visible from the head camera. Bot position only inside the collapsed State tree. |
| 6 | Tag | I held the potato and pressed Tap. Nothing said the tag was out of range. Eliminated 14 s later; Output reads "You is out in round 1". |

Result: I could not deliberately play one round of the game the template is built for.

### Mental model

- Run kinds, players, rig, tier, run mode and permissions are spread across toolbar, Inspector, Devices, Game and menus. Nothing connects "this game needs position + tap" to "here is how you simulate it".
- The rig is per browser, not per project or per player (`Web/studio/src/run.ts:438-464`, key `omni.studio.rig`).
- Start message always says "simulated AirPods, phone and watch" whatever the rig (`run.ts:585`). Button says "Run local", Game panel says "Play" (`main.ts:188`, `gamePanel.ts:135`).
- `ctx.position` is silently `null` unless the Inspector checkbox `permissions.location` is on (`run.ts:151`, `scene.ts:146`).
- `onTick` runs once per scripted entity, so attaching a script twice doubles every `pos` send (`run.ts:144-145`).

### Input fidelity

- Position is carried by the AirPods head packet (`Web/packages/omni-sim/src/devices.ts:107-110`). Remove AirPods and `ctx.position` freezes at `playerOrigin` while you keep walking.
- No GPS: no lat/lon, no accuracy, no update-rate or noise model. Scripts hard-code `acc: 2` (`Games/HotPotato/scripts/player.js`).
- No accel: the sim never emits it and scripts cannot read it (`devices.ts:107-110`, ctx shape in `omni-script/src/evaluate.ts:94`). USIS defines `accel` and the real iPhone companion already streams it at 100 Hz (`Apps/OmniCompanion/iOS/MotionStreamer.swift:40-49`).
- Gestures are a fixed list (tap, doubleTap, flick, squeeze, pinch). On real hardware only the Watch turns IMU into a gesture (flick at > 2 g, `watchOS/WristGestureDetector.swift:17-50`); the runtime only passes gestures through (`Packages/OmniRuntime/.../GestureEventMapper.swift`). A creator cannot define "tag swing" or "punch".
- Flick direction is always `[1,0,0]` in the sim.
- `onRaycastHit` is documented and allowed but never fires (`omni-runtime/src/events.ts:8`).
- No noise or rate variation; the native sim has both at measured rates (`Packages/OmniSim/Sources/OmniSim/NoiseModel.swift`).

### Multiplayer control

- Bots random-walk ±0.3 m every 200 ms within ±10 m and fire tap/flick/pinch with 5% chance per step; never doubleTap or squeeze (`run.ts:664-671`). They spawn on top of the human at `playerOrigin` (`run.ts:656`).
- Bots cannot be selected, steered or removed one by one (`run.ts:270`, `:733`). The Devices panel shows only your own player (`run.ts:774`).
- Bot haptics and audio are dropped; only remote events are forwarded (`run.ts:647-651`).
- On "Run on server", bots use the creator's account, and `/play` keys players by account id, so a second socket replaces the first (`Backend/src/game_server/session.rs:220-223`).
- `.usis.jsonl` playback exists (`omni-sim/src/playback.ts`, `UsisPlayer`, `parseUsisJsonl`) but nothing in `Web/studio` uses it. There is no recorder in the web sim.

### Real devices

- Web Studio: none.
- Native macOS Studio: the window is a viewport plus a Sim/Live toggle (`Apps/OmniStudio/OmniStudio/OmniStudioApp.swift:8-13`) over a hard-coded sphere scene and a sweeping sim head (`AppModel.swift:82-143`). Inspector, script editor, simulator, publish and sign-in views exist but are never mounted. `LocalTestSession` is never created. No HTTP or WebSocket code, so it cannot reach `/play`.
- The bridge protocol is simple and language-neutral: Bonjour `_omni._tcp`, TCP, newline JSON, `hello`/`ping`/`pong`/`output` plus raw USIS lines (`Packages/OmniBridge/Sources/OmniBridge/BonjourListener.swift:17`, `Packages/OmniCore/Sources/OmniCore/Wire/WireMessage.swift`, `LineFraming.swift`). A Node or Rust process can speak it with no Swift change.
- No CoreLocation anywhere in the companion. No player app runs a game on a phone (Phase 9 only lists and fetches).

### Network Rule

- Only convention enforces it. A script can wrap raw USIS in a remote event and it reaches `onRemote` and the debug bus (`session.rs:273-280`). Acceptable for now; noted so it is not mistaken for a guarantee.

## 4. Target workflow

Notation: S = simulated, R = real device, C = cloud.

### (a) Hot potato with GPS tagging

| Stage | Creator does | Input |
|---|---|---|
| Author | New project > Hot potato template (or Blank). Needs checklist shows: `position` (location permission), gesture `tag`, 2-32 players. Writes `game.js` (server) and `player.js` (client) in the Inspector editor. | none |
| Simulate | Play. Test panel opens with 3 players, each with a phone (location + motion). Map shows all players with accuracy circles. Drag players on the map, or Drive one with WASD. Press the `tag` key while driving the holder. Console shows "tag ignored: nearest 7.2 m, range 5.5 m" or "holder → bot-2". | S: position at 1 Hz with 3-10 m noise, tag gesture |
| Scenario | Save "two players 2 m apart, one holds" as a scenario; Play loads it. Record a walk once, assign it to a bot. | S, recorded |
| Real devices | Open the companion app on the same Wi-Fi; it appears in the Test panel. Play > "Use my phone" on player 1; its motion (and GPS, once the companion has CoreLocation) drives player 1. Other players stay simulated. | R through the relay, S for others; raw data stays on the LAN |
| Publish | Publish. Players open the game on their phones; the server script runs in the cloud. | C receives only `pos`/`tag`/`start` remote events |

### (b) Boxing with phone and AirPods motion

| Stage | Creator does | Input |
|---|---|---|
| Author | Declares a custom gesture `punch` in the scene: phone `hand` slot, accel along forward > 25 m/s² within 150 ms. Declares `dodge` from head yaw rate. Client script handles `onGesture("punch")`, fires `hit` to the server. | none |
| Simulate | Play with 2 players. Each player's phone has punch/dodge buttons that play a short recorded accel clip, so the recognizer runs on the same signal as live. A live accel graph shows the threshold line. | S: accel/orientation clips |
| Tune | Record 10 real punches from a phone (once), replay them against the recognizer, adjust threshold until 10/10 fire and walking fires 0. | R recorded once, then replayed |
| Real devices | "Use my phone" on player 1 (phone in hand); AirPods head via the iPhone companion when Track B exists. | R for player 1, S for player 2 |
| Publish | Publish. | C sees only `hit`/`round` events |

### (c) Manhunt

| Stage | Creator does | Input |
|---|---|---|
| Author | Needs: `position`, gesture `catch`, heart rate optional. Server picks hunters/runners, reveals runner positions to hunters every 30 s (`ctx.after`). | none |
| Simulate | Play with 6 players. Runners use a "Behavior: flee from nearest hunter" bot script; hunters on recorded paths; creator drives one hunter. Map shows reveal pings. Time scale x4 to test a 10 min round in 2.5 min. | S, behavior bots |
| Real devices | Two phones with the companion app take over two players; four stay simulated. Needs companion CoreLocation. | R + S mixed |
| Publish | Publish. | C sees only derived positions a script chose to send, gated by `permissions.location` |

## 5. Input and simulation model

- **Games declare needs.** New optional `inputs` block in `scene.json`, for example `{ "position": true, "gestures": ["tap", "tag"], "heartRate": false, "players": [2, 32] }`. The Studio builds each player's rig from it, the checklist reports unmet needs, and tier is derived from it (kept for compatibility, no longer shown first). Removes: manual Add device for the common case.
- **Position (GPS).**
  - Comes from the phone (`pocket` slot), not the AirPods head.
  - Local meters about a game origin (+X east, −Z north, as in `gps-proximity-spec.md`), plus optional `accuracy` in meters on the `position` channel. Schema change: flag, owner decides.
  - Sim location: 1 Hz updates, accuracy slider 3-10 m, gaussian noise plus slow drift, option "perfect" for logic tests.
  - Scripts: `ctx.position` and `ctx.positionAccuracy`, both `null` without `permissions.location` (rule unchanged). Removes the hard-coded `acc: 2`.
- **IMU and gestures.**
  - Raw accel and rotation stay inside the runtime.
  - Layer 1: built-in gestures, unchanged.
  - Layer 2: creator-defined recognizers declared in `scene.json` (`gestures: { "punch": { "slot": "hand", "channel": "accel", "axis": [0,0,-1], "threshold": 25, "windowMs": 150, "cooldownMs": 400 } }`), run by the runtime on the `InputFrame` and delivered as `onGesture({ type: "punch" })`. Same path for sim and live, so the hardware-blind rule holds. Needs Swift parity later (Mac-worker spec).
  - Optional `ctx.motion` (smoothed own-device accel and orientation, read only) for continuous mechanics. It never leaves the device unless a script fires it.
  - The sim emits accel. Gesture buttons play short accel/orientation clips (recorded once from a real phone), not bare gesture packets.
- **Recordings.** Any player's input can be recorded to `.usis.jsonl` and assigned back to a player. Reuse `UsisPlayer` / `parseUsisJsonl` (`Web/packages/omni-sim/src/playback.ts`). Native recordings and presets (`Packages/OmniSim/.../Presets/*.usis.jsonl`) load as-is.

## 6. Test panel (replaces Devices and Game)

- Player list: you plus simulated players, each with its rig from `inputs`, a status line (position, last gesture, last remote event in and out) and its feedback (haptic flash, sound).
- Drive: click a player (list, viewport or map) to send keyboard and mouse to it. Only one driven player at a time.
- Map: top-down overlay with every player, accuracy circles and the holder/role color. Drag to place.
- Source per player: Manual, Recording (loop a `.usis.jsonl`), Behavior (small test-only script, never published), Live (a real device).
- Scenario: a saved set of players, positions and sources, stored in the project file. Play loads the last scenario.
- Needs checklist at the top, each item fixable in place (example: "Location permission off: Turn on").
- Removes: the Devices tab, the Game tab, the Add bot toolbar button and the per-browser rig.

## 7. Structural problems and target architecture

1. **Two Studios.** The native macOS Studio is not a usable creator app today and is macOS-only; the team builds on Windows. Recommend the web Studio (browser + Tauri) as the only creator app. Keep the Swift packages and companion as the device side. Contradicts `overview.md` Module 7: flagged, owner decides.
2. **Real devices into the web Studio.** Two tracks, smallest first (a phone web player was considered and dropped by the owner, 2026-11-14):
   - Track 0, local relay (no Swift change): a small process started by `Deploy/dev.sh` (later inside the Tauri shell) advertises `_omni._tcp`, speaks the existing wire protocol and forwards USIS to the Studio on a localhost WebSocket. The existing iPhone companion then drives any player live: orientation, accel, touch, Watch through the phone. Stays on the LAN. No GPS until the companion gets CoreLocation.
   - Track B, full native: Tauri embeds the bridge in Rust; companion adds CoreLocation and forwards AirPods head motion (`CMHeadphoneMotionManager` also works on iOS). Swift work goes to a Mac worker as a spec.
   - Consequence: real GPS testing waits on companion CoreLocation (Swift, Mac worker); until then GPS games use the simulated location device. All games, `device` run mode included, run in the Studio during testing; the phone acts as that player's sensors.
3. **Identity in tests.** `/play` keys players by account, so every simulated or extra real player needs its own test identity (dev sign-in per player). Fixes the bot collision.
4. **Contracts.** `inputs`, custom `gestures`, `position.accuracy` and `ctx.motion` touch `scene.json`, `Schema/usis.schema.json` and `prelude.js`, which Swift, Rust and TS share. Land each in the shared file first, TS host second, Swift parity as a Mac-worker spec.

## 8. Build order

Sizes: S < 1 day, M 1-3 days, L > 3 days. Ordered by UX impact. Each step ends by repeating the browser walk and noting where it still got stuck.

| # | Step | Size | Removes |
|---|---|---|---|
| P0 | Fix walk defects: default layout on first open, stale title, clipped buttons, focus loss, keys for all gestures, "You is out", inline "why" for ignored events, template control hints in the checklist | S | hidden layout state |
| P1 | Test panel: player list, Drive any player, map with drag, per-player gestures and feedback | M | Devices, Game tabs, Add bot button |
| P2 | Less-is-more shell: 4-region default, merged Console, Play/Stop/Publish toolbar, simplified Login and Projects | S-M | 3 toolbar buttons, 3 console tabs, 2 project sections |
| P3 | `inputs` in scene + rig from needs + fixable checklist | S-M | manual device setup |
| P4 | Sim location device with accuracy, position from phone | S | AirPods-carries-position, `acc: 2` |
| P5 | Accel in sim + declarative gesture recognizers in the TS runtime + accel graph | M | fixed gesture list |
| P6 | Record and replay per player, scenarios in the project file | S | random bots as the only other players |
| P7 | Track 0 relay + per-player Live switch | M | "live only in macOS Studio" |
| P8 | Per-player test identities on "Run on server" | S | server bot collision |
| P9 | Behavior bots, time scale | M | |
| P10 | Mac-worker specs: companion CoreLocation + `position.accuracy` (first, unblocks real GPS), Swift parity for P3-P5, Track B | spec only | |

## 9. Decisions for the owner

1. Canonical Studio: web + Tauri only (recommended), or keep building the native one too.
2. Decided 2026-11-14: no phone web player; real devices come in through the Track 0 relay and the companion app. Open: who on a Mac takes companion CoreLocation, and when.
3. Custom motion: declarative recognizers in `scene.json` (recommended), raw `ctx.motion` to scripts, or both.
4. Schema: add `position.accuracy` and a game origin.
5. Test-only bot scripts in the project (never published): yes or no.
6. `overview.md` wording: Network Rule for script-sent positions, Module 7 (one web Studio), player-on-phone moving out of Phase 7, `inputs` as the creator-facing replacement for tiers.

## 10. Not verified

- Swift not built or run; native Studio, bridge and companion facts come from reading.
- Relay against the real companion not tried; the protocol facts come from reading the Swift code.
- `docs/creators/testing-and-multiplayer.md` says bots appear as red cones; I did not see one from the head camera and did not check the editor camera while running.
- "Run on server" and "Add test player" not exercised in this walk.
