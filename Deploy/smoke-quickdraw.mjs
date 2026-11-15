// Live smoke: a ref and two simulated phones play Quick Draw to matchOver on a deployed backend.
// Usage: node Deploy/smoke-quickdraw.mjs <https://host> <gameId>   (Node 22+, PEAR_DEV_SIGNIN=1)
const [base = "https://155-138-208-146.sslip.io", game] = process.argv.slice(2);
if (!game) throw new Error("usage: node Deploy/smoke-quickdraw.mjs <host> <gameId>");
const run = Date.now().toString(36);

async function join(who, role) {
  const r = await fetch(`${base}/api/accounts/signin`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "dev", subject: `qd-smoke-${who}-${run}`, display_name: who }),
  });
  if (!r.ok) throw new Error(`signin ${r.status}`);
  const { token } = await r.json();
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/play/${game}?token=${token}`);
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

const ref = await join("Referee", "ref");
const p1 = await join("Smoke1", "phone");
const p2 = await join("Smoke2", "phone");
// phones answer every fire with a reaction; p1 is always faster
for (const [p, ms] of [[p1, 180], [p2, 260]]) {
  p.onEvent = (f) => { if (f.name === "fire") setTimeout(() => p.send("raised", { sinceFireMs: ms }), 20); };
}
await until(ref, (f) => f.name === "state" && f.data.players?.filter((x) => x.role === "phone").length === 2, "two phones in state");
p1.send("ready"); p2.send("ready");
for (let round = 1; ; round++) {
  await until(ref, (f) => f.name === "state" && (f.data.phase === "ready" || f.data.phase === "roundOver") || f.name === "matchOver", `ready for round ${round}`);
  if (ref.events.some((f) => f.name === "matchOver")) break;
  ref.events = ref.events.filter((f) => f.name !== "state");
  ref.send("start");
  const rr = await until(ref, (f) => f.name === "roundResult" && f.data.round === round, `roundResult ${round}`);
  console.log(`round ${round}: winner ${rr.data.winnerId === p1.id ? "Smoke1" : "Smoke2"} (${rr.data.reason})`, JSON.stringify(rr.data.reactionMs));
  if (round > 5) throw new Error("no matchOver after 5 rounds");
}
const mo = ref.events.find((f) => f.name === "matchOver");
if (mo.data.winnerId !== p1.id) throw new Error("expected Smoke1 to win");
console.log("matchOver: Smoke1 wins", JSON.stringify(mo.data.scores));
for (const c of [ref, p1, p2]) c.ws.close();
console.log("SMOKE PASS");
