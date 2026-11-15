// Quick Draw round logic (server script): two phones duel, both ready up and the countdown starts itself; later rounds start themselves. Never sees raw orientation; the
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
  const IDLE_KICK_MS = 45000; // lobby/matchOver: a phone that has not readied this long after the other did loses its slot to the queue
  const ROUND_OVER_MIN_MS = 2500; // roundOver lasts at least this long; then the next countdown starts once both phones are lowered

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
      ctx.state.idle = null; // {id, at, handle}: the phone on the idle-kick clock (at null once it expired with nobody queued)
      ctx.state.nextOk = false; // roundOver: the minimum display time has passed
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
    if (p === "roundOver") return "both phones: lower your phone, the next round starts by itself";
    return "match over, both phones: get ready to play again";
  }

  function broadcast(ctx) {
    ctx.remote.fireAll("state", {
      phase: ctx.state.phase,
      round: ctx.state.round,
      matchRound: ctx.state.matchRound,
      scores: ctx.state.scores,
      queue: ctx.state.queue.slice(),
      phones: ids(ctx, "phone"),
      players: Object.keys(ctx.state.players).map(function (id) {
        const p = ctx.state.players[id];
        const idle = ctx.state.idle && ctx.state.idle.id === id ? ctx.state.idle.at : null;
        return { id: id, name: p.name, ready: p.ready, role: p.role, raised: !!p.raised, idleKickAt: idle };
      }),
      needs: needs(ctx),
    });
  }

  function clearTimer(ctx) {
    if (ctx.state.timer !== null) ctx.cancel(ctx.state.timer);
    ctx.state.timer = null;
  }

  // lobby/matchOver start the countdown once both phones are calibrated and ready.
  function settle(ctx) {
    const p = ctx.state.phase;
    if (p !== "lobby" && p !== "matchOver") return;
    const phones = ids(ctx, "phone");
    const both = phones.length === 2 && phones.every(function (id) { return ctx.state.players[id].ready; });
    if (both) startCountdown(ctx);
  }

  // Fills free phone slots from the queue head; runs from commit() after every state change, never mid-match.
  function promote(ctx) {
    const p = ctx.state.phase;
    if (p !== "lobby" && p !== "roundOver" && p !== "matchOver") return;
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

  // The phone that holds up a ready opponent in lobby/matchOver: the one idle-kick clock runs for it (null otherwise).
  function idleTarget(ctx) {
    const p = ctx.state.phase;
    if (p !== "lobby" && p !== "matchOver") return null;
    const phones = ids(ctx, "phone");
    if (phones.length !== 2) return null;
    const waiting = phones.filter(function (id) { return !ctx.state.players[id].ready; });
    return waiting.length === 1 ? waiting[0] : null;
  }

  function refreshIdle(ctx) {
    const t = idleTarget(ctx), cur = ctx.state.idle;
    if (cur && cur.id === t && (cur.at !== null || ctx.state.queue.length === 0)) return;
    if (cur && cur.handle !== null) ctx.cancel(cur.handle);
    ctx.state.idle = null;
    if (t === null) return;
    const at = ctx.now() + IDLE_KICK_MS;
    ctx.state.idle = { id: t, at: at, handle: ctx.after(IDLE_KICK_MS, "idle", { round: ctx.state.round, id: t }) };
  }

  // The idle phone goes to the back of the queue; the remaining phone keeps its readiness across the reset to lobby.
  function idleKick(ctx, id) {
    const keep = ids(ctx, "phone").filter(function (o) { return o !== id; })[0];
    const keepReady = keep !== undefined && ctx.state.players[keep].ready;
    const me = ctx.state.players[id];
    me.role = "queued";
    me.ready = false;
    me.raised = false;
    ctx.state.queue.push(id);
    ctx.state.idle = null;
    backToLobby(ctx);
    if (keep !== undefined) ctx.state.players[keep].ready = keepReady;
  }

  // roundOver -> next countdown by itself: minimum display time passed and both phones lowered (server-tracked).
  function tryAuto(ctx) {
    if (ctx.state.phase !== "roundOver" || !ctx.state.nextOk) return;
    const phones = ids(ctx, "phone");
    if (phones.length === 2 && phones.every(function (id) { return !ctx.state.players[id].raised; })) startCountdown(ctx);
  }

  function commit(ctx) {
    promote(ctx);
    refreshIdle(ctx);
    broadcast(ctx);
  }

  // Readiness is consumed here; lobby and a replay need both phones to report ready again, later rounds do not need it.
  function startCountdown(ctx) {
    if (ctx.state.phase === "matchOver") {
      ctx.state.matchRound = 0;
      ids(ctx, "phone").forEach(function (id) { ctx.state.scores[id] = 0; });
    }
    ids(ctx, "phone").forEach(function (id) { ctx.state.players[id].ready = false; });
    ctx.state.round += 1;
    ctx.state.matchRound += 1;
    ctx.state.phase = "countdown";
    ctx.state.reactions = [];
    ctx.state.nextOk = false;
    ctx.state.timer = ctx.after(COUNTDOWN_MS, "countdown", { round: ctx.state.round });
    ctx.remote.fireAll("countdown", { round: ctx.state.round, matchRound: ctx.state.matchRound, ms: COUNTDOWN_MS });
  }

  function startArming(ctx) {
    ctx.state.phase = "arming";
    const delay = ARM_MIN_MS + Math.random() * (ARM_MAX_MS - ARM_MIN_MS);
    ctx.state.timer = ctx.after(delay, "arm", { round: ctx.state.round });
    ctx.remote.fireAll("arming", { round: ctx.state.round });
  }

  function finishRound(ctx, winner, reason) {
    clearTimer(ctx);
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
      ctx.state.nextOk = false;
      ctx.state.timer = ctx.after(ROUND_OVER_MIN_MS, "next", { round: ctx.state.round });
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
      ctx.state.players[player.id] = { name: player.name || player.id, role: null, ready: false, raised: false };
      commit(ctx);
    },

    onPlayerLeave(ctx, player) {
      init(ctx);
      const me = ctx.state.players[player.id];
      delete ctx.state.players[player.id];
      delete ctx.state.scores[player.id];
      ctx.state.queue = ctx.state.queue.filter(function (id) { return id !== player.id; });
      if (me && me.role === "phone") backToLobby(ctx); // any phone leaving voids readiness and the match; commit gives the slot to the queue head
      commit(ctx);
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
            me.raised = false;
            if (phase === "countdown" || phase === "arming" || phase === "fire") backToLobby(ctx);
          }
        } else if (data.role === "phone") {
          me.role = "queued"; // commit() promotes it at once when it is first in line for a free slot
          ctx.state.queue.push(player.id);
        } else return;
      } else if (name === "ready") {
        // data.round must be the round the phone last saw in "state": a ready from before an invalidation is stale.
        if (me.role !== "phone" || (phase !== "lobby" && phase !== "matchOver")) return;
        if (data.round !== ctx.state.round) return;
        me.ready = true;
        settle(ctx);
      } else if (name === "lowered") {
        if (me.role !== "phone") return;
        me.raised = false;
        tryAuto(ctx);
      } else if (name === "raised") {
        if (me.role !== "phone") return;
        me.raised = true; // tracked whatever the round: roundOver waits for both phones to be lowered
        if (data.round !== ctx.state.round) return; // a raise from an earlier round is stale
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
        } // other phases: only the raised flag changed
      } else return;
      commit(ctx);
    },

    onTimer(ctx, tag, data) {
      init(ctx);
      if (!data || data.round !== ctx.state.round) return; // a timer from an earlier round
      if (tag === "countdown" && ctx.state.phase === "countdown") {
        startArming(ctx);
      } else if (tag === "arm" && ctx.state.phase === "arming") {
        ctx.state.phase = "fire";
        ctx.state.timer = ctx.after(GIVE_UP_MS, "giveup", { round: ctx.state.round });
        ctx.remote.fireAll("fire", { round: ctx.state.round });
      } else if (tag === "next" && ctx.state.phase === "roundOver") {
        ctx.state.timer = null;
        ctx.state.nextOk = true;
        tryAuto(ctx);
      } else if (tag === "idle" && ctx.state.idle && ctx.state.idle.id === data.id && idleTarget(ctx) === data.id) {
        ctx.state.idle.handle = null;
        if (ctx.state.queue.length === 0) ctx.state.idle.at = null; // nobody to give the slot to: it just stays
        else idleKick(ctx, data.id);
      } else if (tag === "resolve" && ctx.state.phase === "fire") {
        ctx.state.timer = null;
        finishRound(ctx, fastest(ctx), "fast");
      } else if (tag === "giveup" && ctx.state.phase === "fire") {
        ctx.state.timer = null;
        finishRound(ctx, ctx.state.reactions.length ? fastest(ctx) : null, "tie");
      } else return;
      commit(ctx);
    },
  });
})();
