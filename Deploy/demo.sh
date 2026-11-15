#!/usr/bin/env bash
# Scripted check of a running Pear stack, local or hosted: health, dev sign-in, create game,
# publish Games/QuickDraw, join /play as 2 phones and /debug as the owner, play one round (both ready,
# both draw on the cue, player1 faster), print the debug event log and the final ctx.state. Exits non-zero on any mismatch.
#   Deploy/demo.sh [base-url]      default http://localhost:8080
# Needs Node 22+ (built-in WebSocket, no npm packages) and curl. The server needs PEAR_DEV_SIGNIN=1.
# PEAR_INSECURE=1 accepts the self-signed certificate of an IP-only Vultr box.
set -euo pipefail

BASE="${1:-http://localhost:8080}"
BASE="${BASE%/}"
GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../Games/QuickDraw" && pwd)"
CURL_OPTS=(-fsS --max-time 10)
if [ "${PEAR_INSECURE:-}" = 1 ]; then
  CURL_OPTS+=(-k)
  export NODE_TLS_REJECT_UNAUTHORIZED=0
fi

command -v node >/dev/null || { echo "FAIL: node not found (need Node 22+)" >&2; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "FAIL: Node 22+ required for the built-in WebSocket" >&2; exit 1; }

echo "health: $BASE/health"
[ "$(curl "${CURL_OPTS[@]}" "$BASE/health")" = "ok" ] || { echo "FAIL: /health did not return ok" >&2; exit 1; }

exec node - "$BASE" "$GAME_DIR" <<'JS'
const fs = require("fs");
const path = require("path");
const [base, gameDir] = process.argv.slice(2);
const wsBase = base.replace(/^http/, "ws");

const fail = (msg) => { console.error("FAIL: " + msg); process.exit(1); };
const check = (cond, msg) => { if (!cond) fail(msg); console.log("ok: " + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, route, token, body) {
  const res = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) fail(`${method} ${route} -> ${res.status} ${text}` + (res.status === 403 ? " (start the server with PEAR_DEV_SIGNIN=1)" : ""));
  return JSON.parse(text);
}

// Opens a WebSocket; `frames` collects every JSON frame, `waitFor` resolves on the first match.
function connect(label, url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames = [];
    const waiters = [];
    ws.onmessage = (ev) => {
      const frame = JSON.parse(ev.data);
      frames.push(frame);
      for (const w of [...waiters]) if (w.pred(frame)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(frame); }
    };
    ws.onerror = () => reject(new Error(`${label}: WebSocket failed to open (${url.replace(/token=[^&]+/, "token=...")})`));
    ws.onopen = () => resolve({
      frames,
      send: (name, data) => ws.send(JSON.stringify({ name, data })),
      close: () => ws.close(),
      waitFor: (pred, what, ms = 5000) => {
        const seen = frames.find(pred);
        if (seen) return Promise.resolve(seen);
        return new Promise((res, rej) => {
          const w = { pred, resolve: res };
          waiters.push(w);
          setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error(`${label}: timed out waiting for ${what}; frames: ${JSON.stringify(frames)}`)); }, ms);
        });
      },
    });
  });
}

async function main() {
  const run = Date.now().toString(36);
  const signin = (who) => api("POST", "/api/accounts/signin", null, { provider: "dev", subject: `sim-demo-${who}-${run}`, display_name: who });
  const owner = await signin("owner");
  const p1 = await signin("player1");
  const p2 = await signin("player2");
  check(owner.token && p1.token && p2.token, "dev sign-in for owner, player1, player2");

  const game = await api("POST", "/api/games", owner.token, { title: "Quick Draw demo " + run });
  check(game.id, `created game ${game.id}`);

  const read = (rel) => fs.readFileSync(path.join(gameDir, rel), "utf8");
  const scene = JSON.parse(read("scene.json"));
  const scriptsOf = (names) => Object.fromEntries(names.map((n) => [n, read(`scripts/${n}.js`)]));
  const version = await api("POST", `/api/games/${game.id}/versions`, owner.token, {
    scene,
    client_scripts: scriptsOf(scene.clientScripts),
    server_scripts: scriptsOf(scene.serverScripts),
    assets: {},
    metadata: {},
    run_mode: scene.runMode,
  });
  check(version.version === 1, `published Quick Draw as version ${version.version}`);

  const debug = await connect("debug", `${wsBase}/debug/${game.id}?token=${owner.token}`);
  await debug.waitFor((f) => f.kind === "snapshot", "debug snapshot");
  const a = await connect("player1", `${wsBase}/play/${game.id}?token=${p1.token}`);
  const b = await connect("player2", `${wsBase}/play/${game.id}?token=${p2.token}`);
  await debug.waitFor((f) => f.kind === "state" && Object.keys(f.state.players || {}).length === 2, "both players in ctx.state");
  check(true, "2 players joined /play, owner watching /debug");

  const id1 = p1.account.id;
  const id2 = p2.account.id;
  a.send("role", { role: "phone" });
  b.send("role", { role: "phone" });
  const lobby = (f) => f.name === "state" && f.data && f.data.phase === "lobby" && f.data.phones.length === 2;
  const sa = await a.waitFor(lobby, "both phones in the lobby on player1");
  await b.waitFor(lobby, "both phones in the lobby on player2");
  a.send("ready", { round: sa.data.round });
  b.send("ready", { round: sa.data.round });

  // The countdown (3 s) and the random arming delay (2 to 6 s) run on the server; the cue is the "fire" event.
  const fire = (f) => f.name === "fire";
  const fa = await a.waitFor(fire, "fire cue on player1", 15000);
  await b.waitFor(fire, "fire cue on player2", 15000);
  a.send("raised", { round: fa.data.round, sinceFireMs: 120 });
  b.send("raised", { round: fa.data.round, sinceFireMs: 250 });

  const result = (f) => f.name === "roundResult";
  const ra = await a.waitFor(result, "round result on player1");
  await b.waitFor(result, "round result on player2");
  await debug.waitFor((f) => f.kind === "state" && f.state.phase === "roundOver", "roundOver ctx.state on /debug");
  await sleep(200); // let trailing debug frames arrive before printing the log

  console.log("
debug event log");
  for (const f of debug.frames) {
    const { kind, t, ...rest } = f;
    if (kind === "snapshot") console.log(`  snapshot  version ${f.version} players ${JSON.stringify(f.players)}`);
    else console.log(`  ${String(kind).padEnd(8)}  ${JSON.stringify(rest)}`);
  }
  const state = debug.frames.filter((f) => f.kind === "state").pop().state;
  console.log("
final ctx.state
" + JSON.stringify(state, null, 2) + "
");

  const errors = debug.frames.filter((f) => f.kind === "error");
  check(errors.length === 0, `no script errors on /debug (${errors.length})`);
  check(debug.frames.filter((f) => f.kind === "in" && f.name === "raised").length === 2, "debug saw 2 raised events in");
  check(ra.data.winnerId === id1 && ra.data.reason === "fast", "player1 (120 ms) won the round on reaction time");
  check(state.phase === "roundOver", "ctx.state.phase is roundOver");
  check(state.scores[id1] === 1 && !state.scores[id2], "scores: player1 1, player2 0");
  const roundOut = debug.frames.find((f) => f.kind === "out" && f.name === "roundResult");
  check(roundOut && roundOut.data.winnerId === id1, "server broadcast the round result");

  a.close(); b.close(); debug.close();
  console.log("\nPASS");
  process.exit(0);
}

main().catch((e) => fail(e.message));
JS
