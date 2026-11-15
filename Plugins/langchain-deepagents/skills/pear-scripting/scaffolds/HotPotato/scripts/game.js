// Hot potato round logic (server script). Never sees input; talks only through remote events.
// One player holds the potato. A fuse (ctx.after) eliminates the holder; the holder passes it by tagging a player who is
// close enough (positions are reported by clients as game events, never raw sensor data). Last player alive wins.
// `export default` stays the first statement (the engine rewrites a leading one); helpers live in the IIFE.
export default (function () {
  const RANGE_M = 1.5;        // tag distance, plus both players' reported accuracy
  const FRESH_MS = 3000;      // a position older than this does not count
  const FUSE_MIN_MS = 10000;
  const FUSE_MAX_MS = 25000;
  const MAX_PLAYERS = 32;

  function init(ctx) {
    if (!ctx.state.players) {
      ctx.state.players = {};
      ctx.state.phase = "lobby"; // lobby -> play -> over
      ctx.state.holder = null;
      ctx.state.round = 0;
      ctx.state.fuse = null;
    }
  }

  function alive(ctx) {
    return Object.keys(ctx.state.players).filter(function (id) { return ctx.state.players[id].alive; });
  }

  function pick(ids) {
    return ids[Math.floor(Math.random() * ids.length)];
  }

  function nameOf(ctx, id) {
    const p = ctx.state.players[id];
    return p ? p.name : "";
  }

  function clearFuse(ctx) {
    if (ctx.state.fuse !== null) ctx.cancel(ctx.state.fuse);
    ctx.state.fuse = null;
  }

  function armFuse(ctx) {
    clearFuse(ctx);
    const ms = FUSE_MIN_MS + Math.random() * (FUSE_MAX_MS - FUSE_MIN_MS);
    ctx.state.fuse = ctx.after(ms, "boom", { round: ctx.state.round });
  }

  function setHolder(ctx, id, from) {
    ctx.state.holder = id;
    ctx.remote.fireAll("holder", { id: id, name: nameOf(ctx, id), from: from });
  }

  function finish(ctx, winner) {
    clearFuse(ctx);
    ctx.state.holder = null;
    if (winner === undefined) {
      ctx.state.phase = "lobby"; // nobody left
      return;
    }
    ctx.state.phase = "over";
    ctx.remote.fireAll("winner", { id: winner, name: nameOf(ctx, winner), round: ctx.state.round });
  }

  function fresh(ctx, p) {
    return p.at !== null && ctx.now() - p.at <= FRESH_MS;
  }

  return serverScript({
    onPlayerJoin(ctx, player) {
      init(ctx);
      if (!ctx.state.players[player.id] && Object.keys(ctx.state.players).length >= MAX_PLAYERS) return;
      // Joining mid-round spectates until the next `start`.
      ctx.state.players[player.id] = { name: player.name || player.id, alive: ctx.state.phase === "lobby", x: null, z: null, acc: 0, at: null };
    },

    onPlayerLeave(ctx, player) {
      init(ctx);
      delete ctx.state.players[player.id];
      if (ctx.state.phase !== "play") return;
      const left = alive(ctx);
      if (left.length <= 1) return finish(ctx, left[0]);
      if (ctx.state.holder === player.id) setHolder(ctx, pick(left), null);
    },

    onRemote(ctx, player, name, data) {
      init(ctx);
      data = data || {};
      const me = ctx.state.players[player.id];
      if (!me || !me.alive) return; // unknown, spectating and eliminated players are ignored

      if (name === "pos") {
        const x = Number(data.x), z = Number(data.z), acc = Number(data.acc);
        if (!isFinite(x) || !isFinite(z)) return;
        me.x = x;
        me.z = z;
        me.acc = isFinite(acc) ? Math.min(50, Math.max(0, acc)) : 0;
        me.at = ctx.now();
      } else if (name === "start") {
        if (ctx.state.phase === "play") return;
        if (ctx.state.phase === "over") {
          Object.keys(ctx.state.players).forEach(function (id) { ctx.state.players[id].alive = true; });
        }
        const ids = alive(ctx);
        if (ids.length < 2) return;
        ctx.state.round += 1;
        ctx.state.phase = "play";
        armFuse(ctx);
        setHolder(ctx, pick(ids), null);
      } else if (name === "tag") {
        if (ctx.state.phase !== "play" || ctx.state.holder !== player.id) return;
        // A miss tells the holder why, so a creator testing in Studio is never left guessing.
        if (!fresh(ctx, me)) return ctx.remote.fire(player.id, "tagMissed", { reason: "your position is older than " + FRESH_MS / 1000 + " s" });
        let best = null, bestDist = Infinity, near = null;
        alive(ctx).forEach(function (id) {
          const o = ctx.state.players[id];
          if (id === player.id || !fresh(ctx, o)) return;
          const d = Math.hypot(o.x - me.x, o.z - me.z);
          const range = RANGE_M + me.acc + o.acc;
          if (near === null || d < near.d) near = { d: d, range: range, name: o.name };
          if (d <= range && d < bestDist) {
            best = id;
            bestDist = d;
          }
        });
        if (best !== null) setHolder(ctx, best, player.id);
        else ctx.remote.fire(player.id, "tagMissed", {
          reason: near === null ? "no other player has a recent position" : "nearest player " + near.name + " is " + near.d.toFixed(1) + " m away, range " + near.range.toFixed(1) + " m",
        });
      }
    },

    onTimer(ctx, tag, data) {
      init(ctx);
      // A fuse from an earlier round (cancelled too late, or a restart) is ignored.
      if (tag !== "boom" || ctx.state.phase !== "play" || !data || data.round !== ctx.state.round) return;
      ctx.state.fuse = null;
      const out = ctx.state.holder;
      if (out === null || !ctx.state.players[out]) return;
      ctx.state.players[out].alive = false;
      ctx.remote.fireAll("eliminated", { id: out, name: nameOf(ctx, out), round: ctx.state.round });
      const left = alive(ctx);
      if (left.length <= 1) return finish(ctx, left[0]);
      armFuse(ctx);
      setHolder(ctx, pick(left), null);
    },
  });
})();
