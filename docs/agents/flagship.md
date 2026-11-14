Flagship design note: "Hollow Choir" (2026-11-14)

Scope: `Games/Flagship/scene.json` only (plan.md Phase 4, issue #39). The scripts are separate items.

**Premise.** You stand in a candlelit crypt (`Sanctuary`, a head-probe trigger sphere). Three wraiths sing from the dark. You find them by sound, look at one to lock it (`onLookAt`, head orientation), then flick or pinch to banish it (`onGesture`, watch or phone). Your heart rate (`onHeartRate`, tier 3) raises their aggression, so staying calm keeps them slow.

**Scene facts.**
- `requiredTier` 3 (orientation + heart rate), `runMode` `screen`, `playerOrigin` `[0, 1.6, 0]`; forward is -Z.
- `clientScripts`: `enemy` (the three wraiths), `player` (the `Sanctuary` entity). `serverScripts`: `game`.
- Audio emitters name sounds: `wraith_whisper`, `wraith_choir`, `brazier_crackle`, `water_drip`, `sanctuary_hum`. Sound files and the scripts are not part of this item.
- Only `trigger`, `audioEmitter`, `script` components are used. `WraithAhead` also has a box trigger so the `enemy` script gets `onTriggerEnter` when it closes in.

**Provisional.** Entity names, positions and gains are a first pass. Gain units are dB-like and unconfirmed. Visual meshes are not in `SceneDescription` yet, so "no gray boxes" is for the scripts and polish items.
