// Hollow Choir round logic (server script). Never sees input; talks only through remote events.
// `export default` stays the first statement (the engine rewrites a leading one); helpers live in the IIFE.
// Win: all 3 wraiths banished. Lose: a player is touched MAX_HITS times. No reset after a round ends.
// [provisional: needs-tien-review] ctx.state is a plain object; fireAll is used for every
// outbound event (payloads carry the player id) since per-player fire's signature is unspecified.
export default (function () {
  const WRAITHS = ["WraithLeft", "WraithRight", "WraithAhead"];
  const MAX_HITS = 3;

  function init(ctx) {
    if (!ctx.state.hits) {
      ctx.state.hits = {};
      ctx.state.banished = {};
      ctx.state.score = {};
      ctx.state.over = false;
    }
  }

  function remaining(ctx) {
    return WRAITHS.filter(function (w) { return !ctx.state.banished[w]; });
  }

  return serverScript({
    onPlayerJoin(ctx, player) {
      init(ctx);
      ctx.state.hits[player.id] = 0;
      ctx.state.score[player.id] = 0;
    },

    onPlayerLeave(ctx, player) {
      init(ctx);
      delete ctx.state.hits[player.id];
      delete ctx.state.score[player.id];
    },

    onRemote(ctx, player, name, data) {
      init(ctx);
      if (ctx.state.over) return;

      if (name === "banish" && WRAITHS.indexOf(data.enemy) >= 0 && !ctx.state.banished[data.enemy]) {
        ctx.state.banished[data.enemy] = player.id;
        ctx.state.score[player.id] = (ctx.state.score[player.id] || 0) + 1;
        const left = remaining(ctx).length;
        ctx.remote.fireAll("banished", { enemy: data.enemy, by: player.id, remaining: left });
        if (left === 0) {
          ctx.state.over = true;
          ctx.remote.fireAll("round", { state: "won", scores: ctx.state.score });
        }
      } else if (name === "contact" && WRAITHS.indexOf(data.enemy) >= 0 && !ctx.state.banished[data.enemy]) {
        const hits = (ctx.state.hits[player.id] || 0) + 1;
        ctx.state.hits[player.id] = hits;
        ctx.remote.fireAll("damage", { id: player.id, hits: hits, max: MAX_HITS });
        if (hits >= MAX_HITS) {
          ctx.state.over = true;
          ctx.remote.fireAll("round", { state: "lost", scores: ctx.state.score });
        }
      }
    },
  });
})();
