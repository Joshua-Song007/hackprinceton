Flagship design note: "Hollow Choir" (2026-11-14)

Scope: `Games/Flagship/scene.json` (issue #39) and the three scripts (issue #55); see Scripts below.

**Premise.** You stand in a candlelit crypt (`Sanctuary`, a head-probe trigger sphere). Three wraiths sing from the dark. You find them by sound, look at one to lock it (`onLookAt`, head orientation), then flick or pinch to banish it (`onGesture`, watch or phone). Your heart rate (`onHeartRate`, tier 3) raises their aggression, so staying calm keeps them slow.

**Scene facts.**
- `requiredTier` 3 (orientation + heart rate), `runMode` `screen`, `playerOrigin` `[0, 1.6, 0]`; forward is -Z.
- `clientScripts`: `enemy` (the three wraiths), `player` (the `Sanctuary` entity). `serverScripts`: `game`.
- Audio emitters name sounds: `wraith_whisper`, `wraith_choir`, `brazier_crackle`, `water_drip`, `sanctuary_hum`. Sound files and the scripts are not part of this item.
- Only `trigger`, `audioEmitter`, `script` components are used. `WraithAhead` also has a box trigger so the `enemy` script gets `onTriggerEnter` when it closes in.

**Scripts (issue #55, 2026-11-14).** `Games/Flagship/scripts/{enemy,player,game}.js`; names from overview.md Module 3 (`prelude.js` only defines `script`/`serverScript` and the handler lists).
- Client to server: `banish {enemy}` (locked wraith + flick/pinch), `contact {enemy}` (WraithAhead trigger enter).
- Server to all (`fireAll`): `banished {enemy, by, remaining}`, `damage {id, hits, max}`, `round {state: "won"|"lost", scores}`.
- Rules: 3 wraiths banished = won; 3 contacts on a player = lost. Heart rate: `self.speed = 1 + 0.5 * ctx.intensity`.
- Assumed, unconfirmed: `self.name`, `self.speed`, `self.audio.play`, `ctx.haptic(pattern, intensity)`, plain-object `ctx.state`; sounds `wraith_vanish`; haptic patterns `tick`/`soft`/`thud`/`chime`. Per-player `fire` signature unknown, so only `fireAll` is used.

**Provisional.** Entity names, positions and gains are a first pass. Gain units are dB-like and unconfirmed. Visual meshes are not in `SceneDescription` yet, so "no gray boxes" is for the scripts and polish items.
