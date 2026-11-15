# Testing and multiplayer

## Play (F5)

Runs the scene and client scripts in the page with simulated devices, plus an in-page server that runs your server script. `onRemote` works and State fills in, with no account. The player is `player-1`. Play builds every player's devices from the scene's `inputs` (head: AirPods, position and gestures: phone, heart rate: watch) and starts with `players[0]` players. With no `inputs`, Studio infers them from the client scripts.

Simulated input: the viewport takes mouse-look (head), **WASD** (walk), **T** tap, **G** double tap, **F** flick, **P** pinch, **H** squeeze. All of it goes to the player you are driving. The Test panel has the same gestures as buttons (clicking one keeps viewport focus), the line in your scripts that handles each, and heart rate.

## Add player

Test > Add player (or Run > Add player) joins another simulated player (`player-2`, `player-3`, ...) with its own scripts and devices, 3 m from the origin. It stands still until you:

- **Drive** it (Test panel button, or click it on the map): your keys and mouse now control it and the camera follows its head. Drive player 1 again to switch back.
- Drag it on the map to place it (dragging never changes who you drive).
- Turn on **Wander**: it random-walks within 10 m of the origin and sometimes taps, flicks or pinches, while you drive someone else.

Other players appear as markers in the viewport.

## Play on server

Publishes a new version and joins the hosted session (needs sign-in; see [publishing.md](publishing.md)). The server script runs in the backend, not in the page. Add player works here too; each added player signs in as its own dev account (`<your name>-p2`, `-p3`, ...) and opens its own connection, so it stays alongside player 1. If that sign-in fails, the Test panel shows the error and the player is not added.

**Add test player** opens another tab signed in as a second account, for a real two-person test.

## Record and replay

Each player row in the Test panel has a **Record** toggle. It captures the simulated USIS packets that player's devices emit. Stop it to keep the clip, then **Save .usis.jsonl** downloads it (one packet per line).

The **Source** select picks Manual (your devices, the default) or Replay. Replay loops the player's clip, or a `.usis.jsonl` file you load with the file input, instead of its manual devices. Clips stay in the page and are not saved in the project.

## Live devices via relay

The Source select also has **Live**. Run `npm run relay` in `Web/studio`; it advertises `_pear._tcp` for the iOS companion and passes each phone's USIS packets to Studio over `ws://127.0.0.1:8787`. Pick Live on a player, then tick the devices that feed it. That player's manual devices go silent, and a script `ctx.haptic` goes back to its phones. Without the relay the row says "Relay not running: npm run relay". Nothing leaves your machine. See [real-world-input.md](real-world-input.md).

## Bots

Source **Bot** makes a player act on its own (the creator's driven player is never a bot while driven): chase or flee the nearest other player at 1.5 m/s, or fire a random gesture from the scene's `inputs.gestures` every N seconds (default 2; tap, flick, pinch without `inputs`). Bots are local test helpers: nothing is published and they need no account.

## Time scale

The Test panel's **Time scale** (0.5x, 1x, 2x, 4x) multiplies the time `onTick`, dwell timers, Wander and bots see in local Play. It is disabled on the server, which keeps its own time. Server `setTimeout` timers are not scaled.

## Reading the result

- **Output**: client `console.log` and errors.
- **Server**: server `console.log`, errors, joins, leaves, and every remote event in and out.
- **State**: the server's `ctx.state`, live.
- **Packets**: simulated USIS packets with `source`.
- **Test**: checklist, every player and the map.

## Recipes

- Nothing happens on a gesture: Output shows whether the handler ran; the script must be attached to an entity (Test panel, checklist).
- Script error: the editor marks the script; client handlers are stopped after 250 ms, server handlers after 1 s of CPU.
- Timer never fires: timers run 50 ms to 1 h, 64 pending at most; a republish (`_reload`) drops pending timers and empties `ctx.state`.

The simulated phone sends a GPS-style position once per second. The "GPS accuracy" slider (0 to 15 m, shown when the rig has a phone) sets its error, which scripts see as `ctx.positionAccuracy`.
