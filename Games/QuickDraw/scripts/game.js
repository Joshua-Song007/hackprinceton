// Quick Draw round logic (server script): two phones duel, both ready up and the countdown starts itself. Never sees raw orientation; the
// phones report only "raised" (with their own reaction time) over remote events. Best of 3, first to 2 wins.
// `export default` stays the first statement (the engine rewrites a leading one); helpers live in the IIFE.
export default (function () {
  // Tuned on the day: degrees of rise from the calibrated rest pose. The phone page owns the pitch maths and mirrors
  // this value; the server never sees orientation, so it does not use it.
  const RAISE_DEG = 80;
  const ARM_MIN_MS = 2000;
  const ARM_MAX_MS = 6000;
  const WINS_NEEDED = 2;
  const COUNTDOWN_MS = 3000;
  const GIVE_UP_MS = 10000; // fire phase with no valid raise from either phone ends as a tie
  const REPORT_WINDOW_MS = 400; // after the first valid raise, wait this long for the other phone's (lower) time

  function init(ctx) {
    if (!ctx.state.players) {
      ctx.state.players = {};
      ctx.state.phase = "lobby"; // lobby -> ready -> arming -> fire -> roundOver -> (arming ...) -> matchOver
      ctx.state.round = 0; // never reset: every start and every invalidation changes it, so it is the stale-input token
      ctx.state.matchRound = 0; // 1.. within the current match, for display only
      ctx.state.scores = {};
      ctx.state.timer = null;
      ctx.state.queue = []; // phone ids waiting for a slot, FIFO; their role is "queued" and they cannot ready or draw
      ctx.state.reactions = []; // [{id, ms}] in arrival order, current round only
      ctx.state.fireAt = null; // server unix ms of the cue, announced when arming starts; null outside arming/fire
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
      return "waiting for both phones to calibrate";
    }
    if (p === "countdown") return "get ready";
    if (p === "arming") return "hold still";
    if (p === "fire") return "draw!";
    if (p === "roundOver") return "both phones: lower and get ready for the next round";
    return "match over, both phones: get ready to play again";
  }

  function broadcast(ctx) {
    ctx.remote.fireAll("state", {
      phase: ctx.state.phase,
      round: ctx.state.round,
      matchRound: ctx.state.matchRound,
      fireAt: ctx.state.fireAt,
      scores: ctx.state.scores,
      queue: ctx.state.queue.slice(),
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
    const p = ctx.state.phase;
    if (p !== "lobby" && p !== "roundOver" && p !== "matchOver") return;
    const phones = ids(ctx, "phone");
    const both = phones.length === 2 && phones.every(function (id) { return ctx.state.players[id].ready; });
    if (both) startCountdown(ctx);
  }

  // Fills free phone slots from the queue head. Only called from lobby, right after readiness was reset.
  function promote(ctx) {
    while (ids(ctx, "phone").length < 2 && ctx.state.queue.length > 0) {
      const id = ctx.state.queue.shift();
      const q = ctx.state.players[id];
      if (!q || q.role !== "queued") continue;
      q.role = "phone";
      q.ready = false;
      ctx.state.scores[id] = 0;
    }
  }

  function backToLobby(ctx) {
    clearTimer(ctx);
    ctx.state.phase = "lobby";
    ctx.state.fireAt = null;
    ctx.state.round += 1;
    ctx.state.matchRound = 0;
    ctx.state.reactions = [];
    ctx.state.scores = {};
    Object.keys(ctx.state.players).forEach(function (id) {
      const p = ctx.state.players[id];
      p.ready = false;
      if (p.role === "phone") ctx.state.scores[id] = 0;
    });
  }

  // Readiness is consumed here, so every round (and a replay) needs both phones to report ready again.
  function startCountdown(ctx) {
    if (ctx.state.phase === "matchOver") {
      ctx.state.matchRound = 0;
      ids(ctx, "phone").forEach(function (id) { ctx.state.scores[id] = 0; });
    }
    ids(ctx, "phone").forEach(function (id) { ctx.state.players[id].ready = false; });
    ctx.state.round += 1;
    ctx.state.matchRound += 1;
    ctx.state.phase = "countdown";
    ctx.state.fireAt = null;
    ctx.state.reactions = [];
    ctx.state.timer = ctx.after(COUNTDOWN_MS, "countdown", { round: ctx.state.round });
    ctx.remote.fireAll("countdown", { round: ctx.state.round, matchRound: ctx.state.matchRound, ms: COUNTDOWN_MS });
  }

  function startArming(ctx) {
    ctx.state.phase = "arming";
    const delay = ARM_MIN_MS + Math.random() * (ARM_MAX_MS - ARM_MIN_MS);
    // ctx.now() is Date.now() (server unix ms, same epoch as the _time reply), so clients map fireAt to local time.
    ctx.state.fireAt = Math.round(ctx.now() + delay);
    ctx.state.timer = ctx.after(delay, "arm", { round: ctx.state.round });
    ctx.remote.fireAll("arming", { round: ctx.state.round, fireAt: ctx.state.fireAt });
  }

  function finishRound(ctx, winner, reason) {
    clearTimer(ctx);
    ctx.state.fireAt = null;
    const phones = ids(ctx, "phone");
    const reactionMs = {};
    phones.forEach(function (id) { reactionMs[id] = null; });
    ctx.state.reactions.forEach(function (r) { reactionMs[r.id] = r.ms; });
    // winner is null on a tie: nobody scores and the round is simply played again.
    if (winner === null) reason = "tie";
    else ctx.state.scores[winner] = (ctx.state.scores[winner] || 0) + 1;
    ctx.remote.fireAll("roundResult", { round: ctx.state.round, matchRound: ctx.state.matchRound, winnerId: winner, reason: reason, reactionMs: reactionMs, scores: ctx.state.scores });
    if (winner !== null && ctx.state.scores[winner] >= WINS_NEEDED) {
      ctx.state.phase = "matchOver";
      ctx.remote.fireAll("matchOver", { winnerId: winner, scores: ctx.state.scores });
    } else {
      ctx.state.phase = "roundOver";
    }
  }

  function otherPhone(ctx, id) {
    return ids(ctx, "phone").filter(function (o) { return o !== id; })[0];
  }

  // Lowest sinceFireMs wins; arrival order says nothing about who was faster, so equal times are a tie (null).
  function fastest(ctx) {
    let best = null, tie = false;
    ctx.state.reactions.forEach(function (r) {
      if (best === null || r.ms < best.ms) { best = r; tie = false; } else if (r.ms === best.ms) tie = true;
    });
    return tie ? null : best.id;
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
      ctx.state.queue = ctx.state.queue.filter(function (id) { return id !== player.id; });
      if (me && me.role === "phone") { // any phone leaving voids readiness and the match; the queue head takes the slot
        backToLobby(ctx);
        promote(ctx);
      }
      broadcast(ctx);
    },

    onRemote(ctx, player, name, data) {
      init(ctx);
      data = data || {};
      const me = ctx.state.players[player.id];
      if (!me) return;
      const phase = ctx.state.phase;

      if (name === "role") {
        // A repeat of the same role is a reload/reconnect (the server never sees it as leave + join): that phone's
        // calibration is gone, and a round in progress is void. Anyone not a phone keeps spectating.
        // A phone beyond the two slots (or arriving mid-match) is queued, keeping its place across repeats.
        if (me.role !== null) {
          if (me.role === "queued" ? data.role !== "phone" : data.role !== me.role) return;
          if (me.role === "phone") {
            me.ready = false;
            if (phase === "countdown" || phase === "arming" || phase === "fire") backToLobby(ctx);
          }
        } else if (data.role === "phone") {
          if (phase === "lobby" && ids(ctx, "phone").length < 2 && ctx.state.queue.length === 0) {
            me.role = "phone";
            ctx.state.scores[player.id] = 0;
          } else {
            me.role = "queued";
            ctx.state.queue.push(player.id);
          }
        } else return;
      } else if (name === "ready") {
        // data.round must be the round the phone last saw in "state": a ready from before an invalidation is stale.
        if (me.role !== "phone" || (phase !== "lobby" && phase !== "roundOver" && phase !== "matchOver")) return;
        if (data.round !== ctx.state.round) return;
        me.ready = true;
        settle(ctx);
      } else if (name === "raised") {
        if (me.role !== "phone" || data.round !== ctx.state.round) return; // a raise from an earlier round is stale
        if (phase === "arming") {
          // Moved before the cue: a foul, the other phone takes the round.
          finishRound(ctx, otherPhone(ctx, player.id), "foul");
        } else if (phase === "fire") {
          if (ctx.state.reactions.some(function (r) { return r.id === player.id; })) return;
          const ms = typeof data.sinceFireMs === "number" && isFinite(data.sinceFireMs) && data.sinceFireMs >= 0 ? data.sinceFireMs : undefined;
          // null: the phone had not yet seen "fire" when it raised, so it anticipated the cue. Anything else invalid is ignored.
          if (ms === undefined && data.sinceFireMs !== null) return;
          if (ms === undefined) {
            finishRound(ctx, otherPhone(ctx, player.id), "foul");
          } else {
            ctx.state.reactions.push({ id: player.id, ms: ms });
            if (ctx.state.reactions.length === 2) finishRound(ctx, fastest(ctx), "fast");
            else {
              clearTimer(ctx); // drops the give-up timer
              ctx.state.timer = ctx.after(REPORT_WINDOW_MS, "resolve", { round: ctx.state.round });
            }
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
      if (tag === "countdown" && ctx.state.phase === "countdown") {
        startArming(ctx);
      } else if (tag === "arm" && ctx.state.phase === "arming") {
        ctx.state.phase = "fire";
        ctx.state.timer = ctx.after(GIVE_UP_MS, "giveup", { round: ctx.state.round });
        ctx.remote.fireAll("fire", { round: ctx.state.round, fireAt: ctx.state.fireAt });
      } else if (tag === "resolve" && ctx.state.phase === "fire") {
        ctx.state.timer = null;
        finishRound(ctx, fastest(ctx), "fast");
      } else if (tag === "giveup" && ctx.state.phase === "fire") {
        ctx.state.timer = null;
        finishRound(ctx, ctx.state.reactions.length ? fastest(ctx) : null, "tie");
      } else return;
      broadcast(ctx);
    },
  });
})();
