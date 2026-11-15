// Manhunt round logic (server script): hunters chase runners on foot. Phones send `location {lat,lng,acc}`; hunters send `tag`.
// There is no per-player send, so every fact is broadcast as one pre-shaped `view` event; per-player data (role, hint) sits in view.players[]
// and the UI picks its own entry with `item.id == me.id`.
// (Lines 2-3 are outdated: per-player data now goes to each player as a private `you` event via ctx.remote.fire; see broadcast.)
export default (function () {
  const ROUND_MS = 300000; // hunt phase length
  const COUNTDOWN_MS = 5000;
  const TAG_M = 15; // hunter must be this close to tag
  const PING_MS = 30000; // hunters see runner positions this often
  const HOT_M = 30, WARM_M = 100;

  function init(ctx) {
    if (!ctx.state.players) {
      ctx.state.players = {};
      ctx.state.order = [];
      ctx.state.fix = {};
      ctx.state.phase = "lobby"; // lobby -> countdown -> hunt -> over
      ctx.state.endsAt = null;
      ctx.state.pings = [];
      ctx.state.lastPingAt = null;
      ctx.state.token = 0; // stale-timer guard
      ctx.state.winner = null;
    }
  }

  function dist(a, b) { // haversine, metres
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function with_(ctx, role, caught) {
    return ctx.state.order.filter(function (id) {
      const p = ctx.state.players[id];
      return p && p.role === role && (caught === undefined || !!p.caught === caught);
    });
  }

  // Distance from a runner to the nearest hunter, or null when either fix is missing.
  function nearestHunter(ctx, id) {
    const f = ctx.state.fix[id];
    let best = null;
    if (!f) return null;
    with_(ctx, "hunter").forEach(function (h) {
      const g = ctx.state.fix[h];
      if (g) { const d = dist(f, g); if (best === null || d < best) best = d; }
    });
    return best;
  }

  function hintFor(ctx, id) {
    const d = nearestHunter(ctx, id);
    if (d === null) return { hint: "...", tone: "neutral" };
    if (d < HOT_M) return { hint: "HOT", tone: "bad" };
    if (d <= WARM_M) return { hint: "WARM", tone: "warn" };
    return { hint: "COLD", tone: "good" };
  }

  // Public facts go to everyone as `view`; role, hint and hunter pings go to each player alone as `you` (runners never receive positions).
  function broadcast(ctx) {
    const st = ctx.state, hunting = st.phase === "hunt";
    const huntersText = with_(ctx, "hunter").map(function (id) { return st.players[id].name; }).join(", ");
    ctx.remote.fireAll("view", {
      phase: st.phase,
      endsAt: st.endsAt,
      players: st.order.map(function (id) { return { id: id, name: st.players[id].name, hasFix: !!st.fix[id] }; }),
      runnersLeft: with_(ctx, "runner", false).length,
      caughtCount: with_(ctx, "runner", true).length,
      lastPingAt: st.lastPingAt,
      winner: st.winner,
      joined: st.order.length,
    });
    st.order.forEach(function (id) {
      const p = st.players[id];
      const h = p.role === "runner" && !p.caught && hunting ? hintFor(ctx, id) : { hint: "", tone: "neutral" };
      ctx.remote.fire(id, "you", {
        role: p.role || "",
        caught: !!p.caught,
        hint: h.hint,
        tone: h.tone,
        alarm: h.hint === "HOT",
        huntersText: p.role === "runner" ? huntersText : "",
        pings: p.role === "hunter" ? st.pings : [],
      });
    });
  }

  function ready(ctx) {
    return ctx.state.order.length >= 3 && ctx.state.order.every(function (id) { return ctx.state.fix[id]; });
  }

  function startCountdown(ctx) {
    const st = ctx.state, n = st.order.length, hunters = Math.max(1, Math.floor(n / 3));
    st.order.forEach(function (id, i) { st.players[id].role = i < hunters ? "hunter" : "runner"; st.players[id].caught = false; });
    st.phase = "countdown";
    st.endsAt = ctx.now() + COUNTDOWN_MS;
    st.token += 1;
    ctx.after(COUNTDOWN_MS, "hunt", { token: st.token });
  }

  function ping(ctx) {
    const st = ctx.state;
    st.lastPingAt = ctx.now();
    st.pings = with_(ctx, "runner", false).filter(function (id) { return st.fix[id]; }).map(function (id) {
      return { lat: st.fix[id].lat, lng: st.fix[id].lng, label: st.players[id].name, tone: "bad" };
    });
  }

  function finish(ctx, winner) {
    ctx.state.phase = "over";
    ctx.state.winner = winner;
    ctx.state.token += 1;
  }

  return serverScript({
    onPlayerJoin(ctx, player) {
      init(ctx);
      if (!ctx.state.players[player.id]) ctx.state.order.push(player.id);
      ctx.state.players[player.id] = { name: player.name || player.id, role: null, caught: false };
      broadcast(ctx);
    },

    onPlayerLeave(ctx, player) {
      init(ctx);
      delete ctx.state.players[player.id];
      delete ctx.state.fix[player.id];
      ctx.state.order = ctx.state.order.filter(function (id) { return id !== player.id; });
      broadcast(ctx);
    },

    onRemote(ctx, player, name, data) {
      init(ctx);
      data = data || {};
      const st = ctx.state, me = st.players[player.id];
      if (!me) return;
      if (name === "location") {
        if (typeof data.lat !== "number" || typeof data.lng !== "number") return;
        st.fix[player.id] = { lat: data.lat, lng: data.lng, acc: data.acc || 0 };
        if (st.phase === "lobby" && ready(ctx)) startCountdown(ctx);
      } else if (name === "start") {
        if (st.phase === "lobby" && st.order.length >= 2) startCountdown(ctx);
        else if (st.phase === "over") { st.phase = "lobby"; st.winner = null; st.pings = []; st.lastPingAt = null; st.endsAt = null; }
      } else if (name === "tag") {
        if (st.phase !== "hunt" || me.role !== "hunter" || !st.fix[player.id]) return;
        let best = null, bestD = TAG_M;
        with_(ctx, "runner", false).forEach(function (id) {
          if (!st.fix[id]) return;
          const d = dist(st.fix[player.id], st.fix[id]);
          if (d <= bestD) { best = id; bestD = d; }
        });
        if (best === null) return;
        st.players[best].caught = true;
        if (with_(ctx, "runner", false).length === 0) finish(ctx, "hunters");
      } else return;
      broadcast(ctx);
    },

    onTimer(ctx, tag, data) {
      init(ctx);
      const st = ctx.state;
      if (!data || data.token !== st.token) return;
      if (tag === "hunt" && st.phase === "countdown") {
        st.phase = "hunt";
        st.endsAt = ctx.now() + ROUND_MS;
        ping(ctx);
        ctx.after(PING_MS, "ping", { token: st.token });
        ctx.after(ROUND_MS, "end", { token: st.token });
      } else if (tag === "ping" && st.phase === "hunt") {
        ping(ctx);
        ctx.after(PING_MS, "ping", { token: st.token });
      } else if (tag === "end" && st.phase === "hunt") {
        finish(ctx, "runners");
      } else return;
      broadcast(ctx);
    },
  });
})();
