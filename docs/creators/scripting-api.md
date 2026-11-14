# Scripting API

Generated from `Web/studio/src/api.ts` by `Web/studio/scripts/gen-api-doc.mjs`. Do not edit by hand.

## Client scripts

`export default script({ ... })`. Handlers receive `(self, ctx, ...args)` and run on each player's machine.

### Handlers

| Handler | Description |
|---|---|
| `onLookAt(self, ctx)` | The head ray has stayed on this entity for 0.5 s. |
| `onGesture(self, ctx, g)` | A gesture arrived from any device. flick carries dir. |
| `onHeartRate(self, ctx, bpm)` | Heart rate changed. ctx.intensity is the normalized 0..1 value. |
| `onRaycastHit(self, ctx)` | The aim ray hit this entity. |
| `onTriggerEnter(self, ctx)` | The player entered this entity's trigger volume. |
| `onTriggerExit(self, ctx)` | The player left this entity's trigger volume. |
| `onRemote(self, ctx, name, data)` | The server sent this player a remote event. |
| `onTick(self, ctx, dt)` | Runs 5 times a second. dt is seconds since the last tick. |

`onLookAt` parameters: `self: Self`, `ctx: Ctx`

```js
onLookAt(self, ctx) { self.audio.play("growl"); }
```

`onGesture` parameters: `self: Self`, `ctx: Ctx`, `g: { type: "tap" | "doubleTap" | "flick" | "squeeze" | "pinch" | string, dir?: [number, number, number] }`

`type` is a built-in gesture or the name of a scene motion gesture (`scene.gestures`), which also carries `dir`. `ctx.positionAccuracy` is the horizontal accuracy of `ctx.position` in meters, or `null` without the location permission or a fix.

```js
onGesture(self, ctx, g) { if (g.type === "flick") ctx.remote.fire("punch", { dir: g.dir }); }
```

`onHeartRate` parameters: `self: Self`, `ctx: Ctx`, `bpm: number`

```js
onHeartRate(self, ctx, bpm) { self.speed = 1 + 0.5 * ctx.intensity; }
```

`onRaycastHit` parameters: `self: Self`, `ctx: Ctx`

```js
onRaycastHit(self, ctx) { ctx.haptic("tick", 0.4); }
```

`onTriggerEnter` parameters: `self: Self`, `ctx: Ctx`

```js
onTriggerEnter(self, ctx) { console.log("entered", self.name); }
```

`onTriggerExit` parameters: `self: Self`, `ctx: Ctx`

```js
onTriggerExit(self, ctx) { console.log("left", self.name); }
```

`onRemote` parameters: `self: Self`, `ctx: Ctx`, `name: string`, `data: any`

```js
onRemote(self, ctx, name, data) { if (name === "hit") ctx.haptic("thud", 0.8); }
```

`onTick` parameters: `self: Self`, `ctx: Ctx`, `dt: number`

```js
onTick(self, ctx, dt) { self.speed = Math.max(0, self.speed - dt); }
```

### Members

| Member | Description |
|---|---|
| `self.name: string` | Name of the entity this script is attached to. |
| `self.speed: number` | Speed multiplier for this entity. Read and write. |
| `self.position: [x, y, z]` | Entity position in meters. Reading it works; writes have no effect. |
| `self.audio.play(sound: string)` | Plays a named sound on this entity. |
| `self.audio.stop()` | Stops the sound playing on this entity. |
| `ctx.intensity: number` | Normalized heart rate, 0..1. Set on heart-rate calls. |
| `ctx.player.id: string | null` | This player's id from the game server; null until the server welcome arrives. |
| `ctx.position: [x, y, z] | null` | This player's position. Only set when scene.permissions.location is true, else null. |
| `ctx.remote.fire(name: string, data?: any)` | Sends a remote event to the server. The only way off the client. |
| `ctx.spawn(name: string)` | Asks the runtime to spawn an entity. Not simulated in local runs. |
| `ctx.haptic(pattern: string, intensity: number)` | Plays a haptic pattern on the player's device. Intensity 0..1. |
| `console.log(...args)` | Writes to the Output tab. console.warn and console.error work too. |

`self.name`

```js
console.log(self.name);
```

`self.speed`

```js
self.speed = 1.5;
```

`self.position`

```js
const [x, y, z] = self.position;
```

`self.audio.play`

```js
self.audio.play("growl");
```

`self.audio.stop`

```js
self.audio.stop();
```

`ctx.intensity`

```js
const d = ctx.intensity;
```

`ctx.player.id`

```js
if (ctx.player.id) console.log(ctx.player.id);
```

`ctx.position`

```js
if (ctx.position) console.log(ctx.position[0]);
```

`ctx.remote.fire`

```js
ctx.remote.fire("punch", { dir: [1, 0, 0] });
```

`ctx.spawn`

```js
ctx.spawn("coin");
```

`ctx.haptic`

```js
ctx.haptic("thud", 0.8);
```

`console.log`

```js
console.log("hello");
```

## Server scripts

`export default serverScript({ ... })`. Handlers receive `(ctx, ...args)` and run once per game session on the game server. They run only on a join, leave, remote event or timer; there are no ticks.

### Handlers

| Handler | Description |
|---|---|
| `onPlayerJoin(ctx, player)` | A player joined the session. |
| `onPlayerLeave(ctx, player)` | A player left the session. |
| `onRemote(ctx, player, name, data)` | A client fired a remote event. |
| `onTimer(ctx, tag, data)` | A timer set with ctx.after fired. |

`onPlayerJoin` parameters: `ctx: Ctx`, `player: { id: string, name: string }`

```js
onPlayerJoin(ctx, player) { ctx.state.health = ctx.state.health || {}; ctx.state.health[player.id] = 100; }
```

`onPlayerLeave` parameters: `ctx: Ctx`, `player: { id: string, name: string }`

```js
onPlayerLeave(ctx, player) { delete ctx.state.health[player.id]; }
```

`onRemote` parameters: `ctx: Ctx`, `player: { id: string, name: string }`, `name: string`, `data: any`

```js
onRemote(ctx, player, name, data) { if (name === "punch") ctx.remote.fireAll("hit", { from: player.id }); }
```

`onTimer` parameters: `ctx: Ctx`, `tag: string`, `data: any`

```js
onTimer(ctx, tag, data) { if (tag === "roundEnd") ctx.state.round = "over"; }
```

### Members

| Member | Description |
|---|---|
| `ctx.state: object` | Plain object that lives in the hosted session. Resets when a new version is published. |
| `ctx.remote.fire(playerId: string, name: string, data?: any)` | Sends a remote event to one player. |
| `ctx.remote.fireAll(name: string, data?: any)` | Sends a remote event to every player. |
| `ctx.now(): number` | Current time in milliseconds. |
| `ctx.after(ms: number, tag: string, data?: any): number` | Fires onTimer after 50 ms to 1 h; at most 64 pending. Returns an id for ctx.cancel. |
| `ctx.cancel(id: number)` | Cancels a pending ctx.after timer. |
| `console.log(...args)` | Writes to the Server tab. console.warn and console.error work too. |

`ctx.state`

```js
ctx.state.round = "won";
```

`ctx.remote.fire`

```js
ctx.remote.fire("p1", "hit", { hp: 90 });
```

`ctx.remote.fireAll`

```js
ctx.remote.fireAll("hit", { hp: 90 });
```

`ctx.now`

```js
const t = ctx.now();
```

`ctx.after`

```js
ctx.state.id = ctx.after(1000, "roundEnd", { n: 1 });
```

`ctx.cancel`

```js
ctx.cancel(ctx.state.id);
```

`console.log`

```js
console.log("joined");
```

## Limits and sandbox

- A client handler is stopped after 250 ms (watchdog); the error appears in the Output tab.
- A server call gets 1 s of CPU and 32 MiB of memory.
- No `fetch`, DOM, timers or files. The network is reachable only through remote events.
- Client scripts never see raw USIS packets; the server never sees input, only what clients send in remote events.
- `ctx.state` lives in the hosted session and resets when a new version is published.
- Gestures: `tap`, `doubleTap`, `flick` (with `dir`), `squeeze`, `pinch`.
