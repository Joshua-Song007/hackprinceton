# Pear devkit wishlist (local, amend freely)

Gaps found while building Quick Draw. Each is a candidate for a backend hotfix into the Pear devkit.
Status: all open. Evidence is from the code and docs unless marked "run".

## LangChain / LLM inside scripts
- **Gap:** scripts cannot call an LLM or LangChain. The sandbox has no `fetch`, DOM, timers or files; the network is reachable only through remote events (`docs/creators/scripting-api.md:252-256`). The Deep Agents plugin is LangChain, but it only *authors* scripts and `scene.json`; it is not available to a running game.
- **Ask:** a server-side `ctx.agent.run(prompt, {tools})` (or a plugin-defined remote event) so a server script can call the hosted runtime (`PEAR_AGENT_RUNTIME_URL`, port 9410) with a time cap and rate limit.
- **Notes:** keep it server-only (never client), per-game budget, no raw sensor data in the prompt, and the runtime secret stays on the box.

## Input and sensing
- **Orientation/pitch for scripts:** no `ctx.orientation` or angle gesture; `gestures.swing` is an accel-axis threshold only. Quick Draw computes pitch in a web page instead.
- **Timestamped gesture events** so the server can judge fairness without trusting a phone's own clock.
- **Companion location source with accuracy** (`docs/agents/gps-proximity-spec.md`).

## Roles and clients
- **Referee/spectator role:** `/play/{game_id}` treats every socket as a player. Quick Draw uses a `role` remote event.
- **Player-run client:** a way to ship a custom phone/iPad page (like `qd-phone.html`, `qd-ref.html`) with a game instead of hand-placing it in `Web/studio/public`.
- **Relay on the LAN:** `Web/studio/scripts/relay.mjs` binds 127.0.0.1 only.

## Audio
- `self.audio.play` is documented but not implemented. Quick Draw plays the cue on the iPad page with Web Audio and `speechSynthesis`.

## Studio testing
- Play/Add player cannot simulate "phone raised". Need a debug input that injects a custom remote event, or a simulated-orientation slider.

## What Studio cannot do for Quick Draw today (all need to be built)
- **Shot trigger:** scripts cannot read phone orientation and `player.js` sends no `raised`; a simulated player cannot raise a phone. Need script-visible orientation/angle gesture (see Input) plus a Studio control that emits it.
- **Audio cue:** Studio does not implement script audio, so the "Fire!" cue cannot be heard in Play.
- **Phone and iPad pages:** the pitch maths, Wake Lock, geolocation and iPad audio unlock exist only in the static pages and need real Safari. Need Studio to host and preview a game's companion pages, or move that logic into the runtime.
- **Referee in Play:** no spectator/referee player to press Start in Add player.
- **Position stream:** the simulated phone sends position, but Studio has no view of the `pos` events the page sends.

## Plugin and deploy
- `skills/pear-scripting/SKILL.md` is stale (missing `onTick`, `onTimer`, `ctx.after`, `ctx.now`, `ctx.player`, `ctx.position`, scene `permissions`/`gestures`/`inputs`, targeted `ctx.remote.fire(id, ...)`).
- Plugin seed needs a version bump to publish: a changed plugin at the same version fails the seed ("must be higher"). Deep Agents permissions change is committed but not live until the version goes above 0.7.39.
- The box lives in `/opt/omni` with Postgres user/db `omni`, while new compose says `pear`; it works only because `DATABASE_URL` is kept in `.env`.
