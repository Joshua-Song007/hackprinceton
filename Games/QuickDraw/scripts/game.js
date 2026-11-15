// Quick Draw round logic (server script): two phones duel, one ref starts rounds. Never sees raw orientation; the
// phones report only "raised" (with their own reaction time) over remote events. Best of 3, first to 2 wins.
// `export default` stays the first statement (the engine rewrites a leading one); helpers live in the IIFE.
export default (function () {
  // Tuned on the day: degrees of rise from the calibrated rest pose. The phone page owns the pitch maths and mirrors
  // this value; the server never sees orientation, so it does not use it.
  const RAISE_DEG = 80;
  const ARM_MIN_MS = 2000;
  const ARM_MAX_MS = 6000;
  const WINS_NEEDED = 2;
  const REPORT_WINDOW_MS = 400; // after the first valid raise, wait this long for the other phone's (lower) time

  function init(ctx) {
    if (!ctx.state.players) {
      ctx.state.players = {};
      ctx.state.phase = "lobby"; // lobby -> ready -> arming -> fire -> roundOver -> (arming ...) -> matchOver
      ctx.state.round = 0;
      ctx.state.scores = {};
      ctx.state.timer = null;
      ctx.state.reactions = []; // [{id, ms}] in arrival order, current round only
    }
  }

  function ids(ctx, role) {
    return Object.keys(ctx.state.players).filter(function (id) { return ctx.state.players[id].role === role; });
  }

  function inMatch(ctx) {
    const p = ctx.state.phase;
    return p === "arming" || p === "fire" || p === "roundOver";
  }

  function needs(ctx) {
    const phones = ids(ctx, "phone");
    const p = ctx.state.phase;
    if (p === "lobby") {
      if (phones.length < 2) return "waiting for " + (2 - phones.length) + " more phone" + (phones.length === 0 ? "s" : "");
      if (ids(ctx, "ref").length < 1) return "waiting for the ref";
      return "waiting for both phones to calibrate";
    }
    if (p === "ready") return ids(ctx, "ref").length < 1 ? "waiting for the ref" : "ref: press start";
    if (p === "arming") return "hold still";
    if (p === "fire") return "draw!";
    if (p === "roundOver") return "ref: press start for the next round";
    return "match over, ref: press start for a rematch";
  }

  function broadcast(ctx) {
    ctx.remote.fireAll("state", {
      phase: ctx.state.phase,
      round: ctx.state.round,
      scores: ctx.state.scores,
      players: Object.keys(ctx.state.players).map(function (id) {
        const p = ctx.state.players[id];
        return { id: id, name: p.name, ready: p.ready, role: p.role };
      }),
      needs: needs(ctx),
    });
  }

  function clearTimer(ctx) {
    if (ctx.state.timer !== null) ctx.cancel(ctx.state.timer);
    ctx.state.timer = null;
  }

  // lobby <-> ready follows whether both phones are calibrated.
  function settle(ctx) {
    if (ctx.state.phase !== "lobby" && ctx.state.phase !== "ready") return;
    const phones = ids(ctx, "phone");
    const both = phones.length === 2 && phones.every(function (id) { return ctx.state.players[id].ready; });
    ctx.state.phase = both ? "ready" : "lobby";
  }

  function backToLobby(ctx) {
    clearTimer(ctx);
    ctx.state.phase = "lobby";
    ctx.state.round = 0;
    ctx.state.reactions = [];
    ctx.state.scores = {};
    Object.keys(ctx.state.players).forEach(function (id) {
      const p = ctx.state.players[id];
      p.ready = false;
      if (p.role === "phone") ctx.state.scores[id] = 0;
    });
  }

  function startRound(ctx) {
    ctx.state.round += 1;
    ctx.state.phase = "arming";
    ctx.state.reactions = [];
    ctx.state.timer = ctx.after(ARM_MIN_MS + Math.random() * (ARM_MAX_MS - ARM_MIN_MS), "arm", { round: ctx.state.round });
  }

  function finishRound(ctx, winner, reason) {
    clearTimer(ctx);
    const phones = ids(ctx, "phone");
    const reactionMs = {};
    phones.forEach(function (id) { reactionMs[id] = null; });
    ctx.state.reactions.forEach(function (r) { reactionMs[r.id] = r.ms; });
    ctx.state.scores[winner] = (ctx.state.scores[winner] || 0) + 1;
    ctx.remote.fireAll("roundResult", { round: ctx.state.round, winnerId: winner, reason: reason, reactionMs: reactionMs, scores: ctx.state.scores });
    if (ctx.state.scores[winner] >= WINS_NEEDED) {
      ctx.state.phase = "matchOver";
      ctx.remote.fireAll("matchOver", { winnerId: winner, scores: ctx.state.scores });
    } else {
      ctx.state.phase = "roundOver";
    }
  }

  function otherPhone(ctx, id) {
    return ids(ctx, "phone").filter(function (o) { return o !== id; })[0];
  }

  // Lowest sinceFireMs wins; Array order is arrival order, so a strict < keeps the first to arrive on a tie.
  function fastest(ctx) {
    let best = null;
    ctx.state.reactions.forEach(function (r) { if (best === null || r.ms < best.ms) best = r; });
    return best.id;
  }

  return serverScript({
    onPlayerJoin(ctx, player) {
      init(ctx);
      // role stays null until the client says which it is; joining mid-match leaves it null (spectating).
      ctx.state.players[player.id] = { name: player.name || player.id, role: null, ready: false, pos: null };
      broadcast(ctx);
    },

    onPlayerLeave(ctx, player) {
      init(ctx);
      const me = ctx.state.players[player.id];
      delete ctx.state.players[player.id];
      delete ctx.state.scores[player.id];
      if (me && me.role !== null && ctx.state.phase !== "lobby" && ctx.state.phase !== "ready") backToLobby(ctx);
      else settle(ctx);
      broadcast(ctx);
    },

    onRemote(ctx, player, name, data) {
      init(ctx);
      data = data || {};
      const me = ctx.state.players[player.id];
      if (!me) return;
      const phase = ctx.state.phase;

      if (name === "role") {
        // Once per player; only before a match, and only while a slot is free. Anyone else keeps spectating.
        if (me.role !== null || (phase !== "lobby" && phase !== "ready")) return;
        if (data.role === "phone" && ids(ctx, "phone").length < 2) {
          me.role = "phone";
          ctx.state.scores[player.id] = 0;
        } else if (data.role === "ref" && ids(ctx, "ref").length < 1) {
          me.role = "ref";
        } else return;
        settle(ctx);
      } else if (name === "ready") {
        if (me.role !== "phone" || (phase !== "lobby" && phase !== "ready")) return;
        me.ready = true;
        settle(ctx);
      } else if (name === "start") {
        if (me.role !== "ref" || (phase !== "ready" && phase !== "roundOver" && phase !== "matchOver")) return;
        if (phase === "matchOver") {
          ctx.state.round = 0;
          ids(ctx, "phone").forEach(function (id) { ctx.state.scores[id] = 0; });
        }
        startRound(ctx);
      } else if (name === "raised") {
        if (me.role !== "phone") return;
        if (phase === "arming") {
          // Moved before the cue: a foul, the other phone takes the round.
          finishRound(ctx, otherPhone(ctx, player.id), "foul");
        } else if (phase === "fire") {
          if (ctx.state.reactions.some(function (r) { return r.id === player.id; })) return;
          const ms = typeof data.sinceFireMs === "number" && isFinite(data.sinceFireMs) && data.sinceFireMs >= 0 ? data.sinceFireMs : null;
          // null: the phone had not yet seen "fire" when it raised, so it anticipated the cue.
          if (ms === null) {
            finishRound(ctx, otherPhone(ctx, player.id), "foul");
          } else {
            ctx.state.reactions.push({ id: player.id, ms: ms });
            if (ctx.state.reactions.length === 2) finishRound(ctx, fastest(ctx), "fast");
            else ctx.state.timer = ctx.after(REPORT_WINDOW_MS, "resolve", { round: ctx.state.round });
          }
        } else return;
      } else if (name === "pos") {
        // Position-streaming demo: kept in state only, never forwarded to other clients.
        const lat = Number(data.lat), lon = Number(data.lon), acc = Number(data.acc);
        if (me.role !== "phone" || !isFinite(lat) || !isFinite(lon)) return;
        me.pos = { lat: lat, lon: lon, acc: isFinite(acc) ? acc : 0, at: ctx.now() };
        return;
      } else return;
      broadcast(ctx);
    },

    onTimer(ctx, tag, data) {
      init(ctx);
      if (!data || data.round !== ctx.state.round) return; // a timer from an earlier round
      if (tag === "arm" && ctx.state.phase === "arming") {
        ctx.state.timer = null;
        ctx.state.phase = "fire";
        ctx.remote.fireAll("fire", { round: ctx.state.round });
      } else if (tag === "resolve" && ctx.state.phase === "fire") {
        ctx.state.timer = null;
        finishRound(ctx, fastest(ctx), "fast");
      } else return;
      broadcast(ctx);
    },
  });
})();
