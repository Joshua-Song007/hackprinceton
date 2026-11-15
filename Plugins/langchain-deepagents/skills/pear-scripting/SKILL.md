---
name: pear-scripting
description: Write Pear Client and Server JavaScript scripts (script / serverScript handlers, RemoteEvents) that react to USIS spatial-input packets from phones, watches, AirPods and other devices. Use for any request to create or edit a file under /scripts/.
---

# Pear scripting

Scripts are plain JavaScript in `/scripts/`. You may also read and write any other file in the project.

- `scripts/<name>.client.js` is a **client script** (runs per player, attached to an entity).
- `scripts/<name>.server.js` is a **server script** (runs once per room, never sees input).

The file must begin with `export default` as its very first characters (no leading comments or blank lines; the engine only rewrites sources starting with it, so put comments inside the IIFE); keep helpers and state inside an IIFE. `script` and `serverScript` are globals (no imports).

```js
export default (function () {
  return script({
    onLookAt(self, ctx) { ctx.remote.fire("tag", { tag: "seen" }); },
  });
})();
```

## Client: `script({...})`, handlers get `(self, ctx, ...args)`

`onLookAt`, `onGesture(self, ctx, g)` (`g.type`: tap, doubleTap, flick, squeeze, pinch, a scene motion-gesture name, or "raise"/"lower"; `g.dir` on flick and motion gestures; `g.t` ms on raise/lower), `onHeartRate(self, ctx, bpm)`, `onRaycastHit`, `onTriggerEnter`, `onTriggerExit`, `onRemote(self, ctx, name, data)`, `onTick(self, ctx, dt)` (5 times a second; `dt` in seconds).

Members: `self.name`, `self.speed` (read/write), `self.position` (read only), `self.audio.play(name)` / `self.audio.stop()`, `ctx.haptic(pattern, intensity)`, `ctx.intensity` (heart rate 0..1), `ctx.player.id` (null until the server welcome), `ctx.position` (`[x,y,z]`, or null unless `permissions.location` is true), `ctx.positionAccuracy` (m, or null), `ctx.remote.fire(name, data)` (to the server). One script context may serve several entities: key per-entity state by `self.name`.

Audio (client only; server scripts cannot play audio, so fire a remote event to clients instead): `self.audio.play("beep")` is a built-in beep, `self.audio.speak(text)` speaks text.

Raise/lower: enabled with scene `gestures.raise`. `onGesture` gets `g.type === "raise"` when the phone tilts up past `angleDeg` from its rest pose and `"lower"` when it drops back below `angleDeg - hysteresisDeg`; `g.t` is the packet timestamp (ms). `self.calibrate()` captures the current phone orientation as the rest pose.

## Server: `serverScript({...})`, handlers get `(ctx, ...args)`

`onPlayerJoin(ctx, player)`, `onPlayerLeave(ctx, player)`, `onRemote(ctx, player, name, data)`, `onTimer(ctx, tag, data)`. `player` is `{ id, name }`. There are no ticks: handlers run only on join, leave, remote event or timer.

Members: `ctx.state` (plain object, keyed by `player.id`; resets on publish), `ctx.remote.fireAll(name, data)` (every player), `ctx.remote.fire(playerId, name, data)` (one player), `ctx.now()` (ms), `ctx.after(ms, tag, data)` (50 ms to 1 h, max 64 pending; fires `onTimer`; returns an id), `ctx.cancel(id)`. Put the player id in the payload when sending to all.

`ctx.agent.run(prompt)` (server only, see scripting-api.md for the call form) calls the hosted LangChain runtime; it is time-capped and rate-limited per game, and may be unavailable (error) when the runtime is not configured.

Unknown handler names or non-function values throw a TypeError at load.

## RemoteEvents

Client and server talk only through named events: client `ctx.remote.fire(name, data)` reaches the server `onRemote`; the server's `fireAll(name, data)` reaches every client `onRemote`, and `fire(playerId, name, data)` reaches one. Payloads are plain JSON.

## USIS v1 packets (what the device handlers are fed)

One packet per device sample, only changed channels present:
`{ v: 1, deviceId, kind, slot, source: "live"|"sim", t (ms), seq, ch: {...} }`

- `kind`: phone, tablet, airpods, watch, pencil, headset, custom. `slot`: head, leftWrist, rightWrist, hand, pocket, stylus.
- `ch.orientation` `[x,y,z,w]` unit quaternion; `ch.position`, `ch.accel` `[x,y,z]`. Frame: +X right, +Y up, -Z forward.
- `ch.touch` `[{id, x, y (0..1), phase: began|moved|ended}]`; `ch.gesture` `{type, dir?}`; `ch.heartRate` bpm; `ch.pencil` `{tip, pressure, roll, hover}`.

## Scene (`/scene.json`)
One JSON object. Axes: +X right, +Y up, -Z forward; meters.
- Scene fields: `name`, `requiredTier` (1-3), `playerOrigin` [x,y,z], `runMode` (`screen` | `device`), `permissions` (`{"location": true}` lets clients read `ctx.position`),
  `inputs` (`{head, position, heartRate, gestures: [...], players: [min, max]}`; Studio builds the simulated devices from it),
  `gestures` (motion gestures `{"name": {slot, axis, threshold, cooldownMs}}`, delivered as `onGesture` type `name`; plus `raise: {angleDeg: 80, hysteresisDeg: 10}`, defaults 80/10), `entities`. Leave `clientScripts` / `serverScripts` alone: the Studio fills them from the script files.
- Entity: `name` (unique among its siblings), `position` [x,y,z], `rotation` quaternion [x,y,z,w], `scale` [x,y,z],
  `shape` (`box` default or `sphere`), `color` (CSS colour), `children`, `components`.
- Components: `{"type":"script","name":"<client script>"}`; `{"type":"trigger","shape":"sphere","radius":1}` or
  `{"type":"trigger","shape":"box","size":[x,y,z]}`; `{"type":"audioEmitter","soundName":"...","gain":1,"loops":false}`.
- Example entity: `{"name": "Sphere", "shape": "sphere", "position": [1.5, 1.2, -3], "scale": [0.6, 0.6, 0.6], "color": "#4da3ff"}`.
- Entities are fixed in the scene file; `ctx.spawn` is not simulated in local runs, so add entities here instead.

## Workflow

Read `/AGENTS.md` for the current scene, scripts and peripherals. Write small scripts, one per behaviour; use `edit_file` to change existing ones.

Model: the runtime uses Anthropic, OpenAI or Google Gemini, chosen by `PEAR_AGENT_MODEL` ("provider:model") or the first of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`/`GEMINI_API_KEY` that is set.
