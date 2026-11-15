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

`onLookAt`, `onGesture(self, ctx, g)` (`g.type`: tap, doubleTap, flick, squeeze, pinch; `g.dir`), `onHeartRate(self, ctx, bpm)`, `onRaycastHit`, `onTriggerEnter`, `onTriggerExit`, `onRemote(self, ctx, name, data)`.

Seen in the example scripts: `self.name`, `self.speed`, `self.audio.play(name)`, `ctx.haptic(pattern, intensity)`, `ctx.intensity`, `ctx.remote.fire(name, data)`. One script context may serve several entities: key per-entity state by `self.name`.

## Server: `serverScript({...})`, handlers get `(ctx, ...args)`

`onPlayerJoin(ctx, player)`, `onPlayerLeave(ctx, player)`, `onRemote(ctx, player, name, data)`. Keep state in `ctx.state` (plain object, keyed by `player.id`). Send with `ctx.remote.fireAll(name, data)`; put the player id in the payload.

Unknown handler names or non-function values throw a TypeError at load.

## RemoteEvents

Client and server talk only through named events: client `ctx.remote.fire(name, data)` reaches the server `onRemote`; the server's `fireAll` reaches every client `onRemote`. Payloads are plain JSON.

## USIS v1 packets (what the device handlers are fed)

One packet per device sample, only changed channels present:
`{ v: 1, deviceId, kind, slot, source: "live"|"sim", t (ms), seq, ch: {...} }`

- `kind`: phone, tablet, airpods, watch, pencil, headset, custom. `slot`: head, leftWrist, rightWrist, hand, pocket, stylus.
- `ch.orientation` `[x,y,z,w]` unit quaternion; `ch.position`, `ch.accel` `[x,y,z]`. Frame: +X right, +Y up, -Z forward.
- `ch.touch` `[{id, x, y (0..1), phase: began|moved|ended}]`; `ch.gesture` `{type, dir?}`; `ch.heartRate` bpm; `ch.pencil` `{tip, pressure, roll, hover}`.

## Scene (`/scene.json`)
One JSON object. Axes: +X right, +Y up, -Z forward; meters.
- Scene fields: `name`, `requiredTier` (1-3), `playerOrigin` [x,y,z], `runMode` (`screen` | `device`), `inputs`,
  `entities`. Leave `clientScripts` / `serverScripts` alone: the Studio fills them from the script files.
- Entity: `name` (unique among its siblings), `position` [x,y,z], `rotation` quaternion [x,y,z,w], `scale` [x,y,z],
  `shape` (`box` default or `sphere`), `color` (CSS colour), `children`, `components`.
- Components: `{"type":"script","name":"<client script>"}`; `{"type":"trigger","shape":"sphere","radius":1}` or
  `{"type":"trigger","shape":"box","size":[x,y,z]}`; `{"type":"audioEmitter","soundName":"...","gain":1,"loops":false}`.
- Example entity: `{"name": "Sphere", "shape": "sphere", "position": [1.5, 1.2, -3], "scale": [0.6, 0.6, 0.6], "color": "#4da3ff"}`.
- Entities are fixed in the scene file; `ctx.spawn` is not simulated in local runs, so add entities here instead.

## Workflow

Read `/AGENTS.md` for the current scene, scripts and peripherals. Write small scripts, one per behaviour; use `edit_file` to change existing ones.

Model: the runtime uses Anthropic, OpenAI or Google Gemini, chosen by `PEAR_AGENT_MODEL` ("provider:model") or the first of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`/`GEMINI_API_KEY` that is set.
