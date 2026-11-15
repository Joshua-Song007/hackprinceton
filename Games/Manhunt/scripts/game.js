// Manhunt (server script): the first player to join is the hunter, everyone else runs. Phones stream `location {lat,lng,acc}`;
// a hunter within TAG_M of a runner who taps Tag catches them. Hunters win when every runner is caught, runners win at timeout.
// Each player gets their own pre-shaped `view` event (PearUI cannot index maps or format).
// `export default` stays the first statement (the engine rewrites a leading one); helpers live in the IIFE.
export default (function () {
  const TAG_M = 15;
  const HOT_M = 25; // runner hint: a hunter this close is "hot"
  const WARM_M = 60;
  const SEE_M = 80; // hunters see runners, and runners see hunters, only within this range
  const ROUND_MS = 5 * 60 * 1000; // a `config {roundMs}` event in the lobby overrides this (scenarios use short rounds)
  const START_MS = 3000; // grace after the second player joins, so late joiners get roles and config can arrive

  function init(ctx) {
    if (!ctx.state.players) {
      ctx.state.players = {};
      ctx.state.phase = "lobby"; // lobby -> running -> over
      ctx.state.roundMs = ROUND_MS;
      ctx.state.endsAt = null;
      ctx.state.winner = null;
      ctx.state.startHandle = null;
    }
  }

  function haversine(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function ids(ctx, role, alive) {
    return Object.keys(ctx.state.players).filter(function (id) {
      const p = ctx.state.players[id];
      return p.role === role && (!alive || !p.caught);
    });
  }

  function nearest(ctx, me, targets) {
    let best = null;
    targets.forEach(function (id) {
      const o = ctx.state.players[id];
      if (!me.loc || !o.loc) return;
      const d = haversine(me.loc, o.loc);
      if (best === null || d < best.d) best = { id: id, d: d };
    });
    return best;
  }

  function viewFor(ctx, id) {
    const st = ctx.state, me = st.players[id];
    const hunter = me.role === "hunter";
    const others = hunter ? ids(ctx, "runner", true) : ids(ctx, "hunter", false);
    const near = nearest(ctx, me, others);
    const markers = [];
    if (me.loc) markers.push({ lat: me.loc.lat, lng: me.loc.lng, label: "You", tone: "accent" });
    others.forEach(function (oid) {
      const o = st.players[oid];
      if (me.loc && o.loc && haversine(me.loc, o.loc) <= SEE_M) markers.push({ lat: o.loc.lat, lng: o.loc.lng, label: o.name, tone: hunter ? "good" : "bad" });
    });
    let status, hint = "", tone = "neutral";
    if (st.phase === "lobby") status = "Waiting for players";
    else if (st.phase === "over") { status = st.winner === "hunters" ? "Hunters win" : "Runners win"; tone = (st.winner === "hunters") === hunter ? "good" : "bad"; }
    else if (me.caught) { status = "You were caught"; tone = "bad"; }
    else if (hunter) {
      status = "Hunt the runners";
      hint = near ? "Nearest runner " + Math.round(near.d) + " m" + (near.d <= TAG_M ? " - TAG!" : "") : "Looking for runners";
      tone = near && near.d <= TAG_M ? "good" : "neutral";
    } else {
      status = "Stay away from hunters";
      if (near) { hint = near.d <= HOT_M ? "HOT: " : near.d <= WARM_M ? "Warm: " : "Cold: "; hint += "hunter " + Math.round(near.d) + " m"; tone = near.d <= HOT_M ? "bad" : near.d <= WARM_M ? "warn" : "good"; }
      else hint = "No hunter nearby";
    }
    const runners = ids(ctx, "runner", false).length;
    return {
      role: me.role, phase: st.phase, status: status, hint: hint, tone: tone, markers: markers,
      caught: !!me.caught, caughtAt: me.caughtAt || 0, hot: near && !hunter && near.d <= HOT_M ? 1 : 0, hotN: me.hotN || 0,
      endsAt: st.endsAt, winner: st.winner, tagMsg: me.tagMsg || "",
      runners: runners, caughtCount: runners - ids(ctx, "runner", true).length,
    };
  }

  function broadcast(ctx) {
    Object.keys(ctx.state.players).forEach(function (id) {
      const p = ctx.state.players[id];
      const hot = viewFor(ctx, id).hot;
      if (hot && !p.wasHot) p.hotN = (p.hotN || 0) + 1; // changes only when a hunter newly comes close: drives the near haptic
      p.wasHot = hot;
      ctx.remote.fire(id, "view", viewFor(ctx, id));
    });
  }

  function finish(ctx, winner) {
    ctx.state.phase = "over";
    ctx.state.winner = winner;
    ctx.remote.fireAll("roundResult", { winner: winner });
  }

  function maybeStart(ctx) {
    const st = ctx.state;
    if (st.phase !== "lobby" || st.startHandle !== null) return;
    if (ids(ctx, "hunter", false).length < 1 || ids(ctx, "runner", false).length < 1) return;
    st.startHandle = ctx.after(START_MS, "begin", {});
  }

  return serverScript({
    onPlayerJoin(ctx, player) {
      init(ctx);
      const hunters = ids(ctx, "hunter", false).length;
      ctx.state.players[player.id] = { name: player.name || player.id, role: hunters === 0 ? "hunter" : "runner", loc: null, caught: false };
      maybeStart(ctx);
      broadcast(ctx);
    },

    onPlayerLeave(ctx, player) {
      init(ctx);
      delete ctx.state.players[player.id];
      if (ctx.state.phase === "running" && ids(ctx, "runner", true).length === 0) finish(ctx, "hunters");
      broadcast(ctx);
    },

    onRemote(ctx, player, name, data) {
      init(ctx);
      data = data || {};
      const me = ctx.state.players[player.id];
      if (!me) return;
      if (name === "config") {
        if (ctx.state.phase === "lobby" && typeof data.roundMs === "number" && data.roundMs >= 1000 && data.roundMs <= 3600000) ctx.state.roundMs = data.roundMs;
        return;
      }
      if (name === "location") {
        if (typeof data.lat !== "number" || typeof data.lng !== "number" || !isFinite(data.lat) || !isFinite(data.lng) || Math.abs(data.lat) > 90 || Math.abs(data.lng) > 180) return;
        me.loc = { lat: data.lat, lng: data.lng, acc: typeof data.acc === "number" ? data.acc : null };
        broadcast(ctx);
        return;
      }
      if (name === "tag") {
        if (ctx.state.phase !== "running" || me.role !== "hunter") return;
        const near = nearest(ctx, me, ids(ctx, "runner", true));
        if (!near || near.d > TAG_M) {
          me.tagMsg = near ? "Too far: " + Math.round(near.d) + " m (need " + TAG_M + ")" : "No runner in range";
          ctx.remote.fire(player.id, "tagMissed", { meters: near ? near.d : null });
        } else {
          const r = ctx.state.players[near.id];
          me.tagMsg = "Tagged " + r.name;
          r.caught = true;
          r.caughtAt = ctx.now();
          ctx.remote.fireAll("caught", { id: near.id, name: r.name, by: player.id });
          if (ids(ctx, "runner", true).length === 0) finish(ctx, "hunters");
        }
        broadcast(ctx);
      }
    },

    onTimer(ctx, tag, data) {
      init(ctx);
      if (tag === "begin") {
        ctx.state.startHandle = null;
        if (ctx.state.phase !== "lobby") return;
        ctx.state.phase = "running";
        ctx.state.endsAt = ctx.now() + ctx.state.roundMs;
        ctx.after(ctx.state.roundMs, "end", {});
        ctx.remote.fireAll("roundStart", { endsAt: ctx.state.endsAt });
      } else if (tag === "end") {
        if (ctx.state.phase === "running") finish(ctx, ids(ctx, "runner", true).length ? "runners" : "hunters");
      }
      broadcast(ctx);
    },
  });
})();
