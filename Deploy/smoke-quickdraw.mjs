// Live smoke: two simulated phones play Quick Draw to matchOver on a deployed backend (no referee: both Ready, the server counts down).
// Usage: node Deploy/smoke-quickdraw.mjs <https://host> <gameId> [LOBBY]   (Node 22+, PEAR_DEV_SIGNIN=1)
// Plays in its own lobby (random code unless given), so a smoke run never takes a real player's slot.
const [base = "https://155-138-208-146.sslip.io", game, lobbyArg] = process.argv.slice(2);
if (!game) throw new Error("usage: node Deploy/smoke-quickdraw.mjs <host> <gameId>");
const run = Date.now().toString(36);
const lobby = (lobbyArg || "SMK" + Math.random().toString(36).slice(2, 6)).toUpperCase();

async function join(who, role) {
  const r = await fetch(`${base}/api/accounts/signin`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "dev", subject: `qd-smoke-${who}-${run}`, display_name: who }),
  });
  if (!r.ok) throw new Error(`signin ${r.status}`);
  const { token } = await r.json();
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/play/${game}?token=${token}&lobby=${lobby}`);
  const c = { who, ws, id: null, events: [], send: (name, data = {}) => ws.send(JSON.stringify({ name, data })) };
  ws.onmessage = (m) => {
    const f = JSON.parse(m.data);
    if (f.name === "_welcome") { c.id = f.data.id; c.send("role", { role }); }
    c.events.push(f);
    c.onEvent?.(f);
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error(`${who} socket failed`)); });
  return c;
}

const until = (c, pred, what, ms = 15000) => new Promise((res, rej) => {
  const hit = c.events.find(pred); if (hit) return res(hit);
  const t = setTimeout(() => rej(new Error(`${c.who}: timed out waiting for ${what}`)), ms);
  const prev = c.onEvent;
  c.onEvent = (f) => { prev?.(f); if (pred(f)) { clearTimeout(t); c.onEvent = prev; res(f); } };
});

const p1 = await join("Smoke1", "phone");
const p2 = await join("Smoke2", "phone");
// Each phone taps Ready once in the lobby, answers every fire and lowers again (later rounds start once both are lowered); p1 is always faster.
for (const [p, ms] of [[p1, 180], [p2, 260]]) {
  let readied = null;
  p.onEvent = (f) => {
    if (f.name === "state" && (f.data.phase === "lobby" || f.data.phase === "roundOver") && readied !== f.data.round
      && f.data.players?.filter((x) => x.role === "phone").length === 2) { readied = f.data.round; p.send("ready", { round: f.data.round }); }
    if (f.name === "fire") setTimeout(() => {
      p.send("raised", { round: f.data.round, sinceFireMs: ms });
      setTimeout(() => p.send("lowered", {}), 300);
    }, 20);
  };
}
const mo = await until(p1, (f) => f.name === "matchOver", "matchOver", 90000);
for (const rr of p1.events.filter((f) => f.name === "roundResult"))
  console.log(`round ${rr.data.matchRound}: winner ${rr.data.winnerId === p1.id ? "Smoke1" : rr.data.winnerId === p2.id ? "Smoke2" : "none"} (${rr.data.reason})`, JSON.stringify(rr.data.reactionMs));
if (mo.data.winnerId !== p1.id) throw new Error("expected Smoke1 to win");
console.log("matchOver: Smoke1 wins", JSON.stringify(mo.data.scores));
for (const c of [p1, p2]) c.ws.close();
console.log(`SMOKE PASS (lobby ${lobby}, welcome lobby ${p1.events.find((f) => f.name === "_welcome")?.data?.lobby})`);
