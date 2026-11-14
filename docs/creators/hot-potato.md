# Hot potato

One player holds the potato. A fuse of 10 to 25 s eliminates the holder, who can pass it by tagging a nearby player. Last player alive wins. Files: `Games/HotPotato/scene.json`, `scripts/game.js` (server), `scripts/player.js` (client).

## Try it

File > New game... > Hot potato, then F5, then Test > Add player two or more times. Press **G** (double tap) to start the round (the client fires `start` on a double tap). Watch **State** (`phase`, `holder`, `round`, `players`) and **Server** (`holder`, `eliminated`, `winner` events). To pass the potato, walk with WASD next to another player while you hold it (or drag them together on the Test map) and press **T**. To test from the other side, click **Drive** on that player. A miss logs why in Output (`tag missed: nearest player ... m away, range ... m`).

## How it works

Server (`game.js`):

- `onPlayerJoin` adds the player to `ctx.state.players`; joining mid-round spectates until the next start.
- `start` (from any alive player, 2 or more alive): round + 1, `armFuse` calls `ctx.after(ms, "boom", { round })`, a random holder is announced with `fireAll("holder", ...)`.
- `pos` stores a player's reported x / z / accuracy and the time (`ctx.now()`).
- `tag` is accepted only from the current holder with a fresh position (under 3 s old). The nearest alive player within `1.5 m + both accuracies` becomes the holder.
- `onTimer("boom")` eliminates the holder, announces it, and either declares the winner or arms the next fuse. A fuse from an older round is ignored.

Client (`player.js`, on the Arena entity):

- `onTick` (5 Hz) sends `pos` from `ctx.position`; the scene grants `permissions.location`.
- `onGesture`: double tap starts a round; tap or flick tags if this player is the holder.
- `onRemote` logs events and buzzes (`ctx.haptic`) when you become the holder or are eliminated.

## Make it yours

Change `FUSE_MIN_MS`, `FUSE_MAX_MS` and `RANGE_M` at the top of `game.js`. Add a rule by handling a new remote event name in `onRemote`. See [scripting-api.md](scripting-api.md) for everything `ctx` offers.
