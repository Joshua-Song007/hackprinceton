# Scene format

A scene is one JSON object (`scene.json`, or the `scene` inside a `*.omni.json` file). Unknown fields are ignored. The Inspector edits all of these; you rarely need to touch the JSON.

```json
{
  "name": "Blank",
  "requiredTier": 1,
  "playerOrigin": [0, 1.6, 0],
  "runMode": "screen",
  "permissions": { "location": false },
  "clientScripts": ["cube"],
  "serverScripts": ["counter"],
  "entities": [
    { "name": "Floor", "position": [0, 0, -4], "scale": [10, 0.1, 10] },
    { "name": "Cube", "position": [0, 1.2, -3], "components": [{ "type": "script", "name": "cube" }] }
  ]
}
```

## Scene fields

| Field | Meaning |
|---|---|
| `name` | Display name. |
| `requiredTier` | 1 = orientation and touch (phone, AirPods), 2 = adds position, 3 = adds heart rate. Studio warns when connected devices cannot meet it. Integer 1 to 3, default 1. |
| `playerOrigin` | Where the player's head starts, in meters. |
| `runMode` | `screen` (a separate screen shows the game, devices are controllers) or `device` (runs on the player's phone). Default `screen`. |
| `permissions.location` | `true` makes `ctx.position` available to client scripts. See [real-world-input.md](real-world-input.md). Default false. |
| `inputs` | What each player must provide: `head`, `position`, `heartRate` (booleans, default false), `gestures` (any of `tap`, `doubleTap`, `flick`, `squeeze`, `pinch`) and `players` `[min, max]` (whole numbers, 1 to 32, default `[1, 32]`). Play builds each player's simulated devices from it and starts with `min` players. Omit it and Studio reads the needs from the scripts. Example: `"inputs": { "head": true, "gestures": ["flick"], "players": [2, 8] }`. |
| `clientScripts`, `serverScripts` | Names of the scripts the game ships. Source lives next to the scene (`scripts/<name>.js`). |
| `entities` | Tree of entities; each may have `children`. An entity's id is its slash-joined name path (`Room/Door`; duplicates get `#2`). |

`gestures` (optional) defines motion gestures: `{ "swing": { "slot": "hand", "axis": [0, 0, -1], "threshold": 20, "cooldownMs": 400 } }`. The runtime fires `onGesture` with `type` set to the name and `dir` set to the axis when the slot device's acceleration (m/s², device frame) along `axis` rises past `threshold`, then waits `cooldownMs`. Names must not match a built-in gesture. Edit them under Scene settings > Motion gestures.

## Entity fields

`name`, `position` [x, y, z] meters, `rotation` quaternion [x, y, z, w] (the Inspector shows degrees), `scale` [x, y, z], `shape` (`box` default, or `sphere`), `color` (CSS colour; drawing only), `children`, `components`.

Axes: +X right, +Y up, -Z forward.

## Components

| `type` | Fields |
|---|---|
| `script` | `name`: a client script. Gets the events for this entity. |
| `trigger` | `shape: "sphere"` with `radius`, or `shape: "box"` with `size`; optional `probeSlots` (default head). Fires `onTriggerEnter` / `onTriggerExit`. |
| `audioEmitter` | `soundName`, `gain`, `loops`. |

An invalid scene (bad tier, bad run mode, non-positive trigger size) is rejected with a message naming the field.
