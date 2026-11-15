# Getting started

## The model

A game is data, never native code:

- **Scene** (`scene.json`): entities with a position, scale, shape, colour and components.
- **Client scripts** run on each player's device. They attach to entities and react to input: gestures, looking at something, heart rate, entering a trigger, a 5 Hz tick.
- **Server script** (optional) runs once per game session. It owns shared state (`ctx.state`: scores, rounds), can set timers, and never sees input.
- **Remote events** are the only link between them. A client calls `ctx.remote.fire(name, data)`; the server answers with `ctx.remote.fireAll(...)` or `ctx.remote.fire(playerId, ...)`.

A game with no server script runs entirely on the player's machine.

## First game

0. Open Studio and sign in (a name is enough on a dev server; the server URL is on the same page). The Projects screen then lists templates, your cloud games and projects saved on this computer.
1. Create **Blank** (Projects screen, or File > New game...). You get a floor, one cube, a client script on the cube and a server script that counts taps.
2. Press **F5** (or **Play**). Studio plays the scene with simulated devices and an in-page server. No account needed.
3. Click the viewport so it has focus, press **T** (tap). Open the **State** tab in the bottom panel: the tap count is `ctx.state`.
4. Open the **Game** panel (left, next to Explorer). It lists what the game still needs: entities, script attachments, a server script, a Play result, a published version.
5. Edit the client script. The editor autocompletes handler names and `ctx` members; hover for docs. Changes reload on the next Play.
6. **Shift+F5** stops. **Ctrl+S** saves a `*.pear.json` file you can reopen with File > Open file.

Next: [studio-guide.md](studio-guide.md), then [hot-potato.md](hot-potato.md) for a multiplayer game.
