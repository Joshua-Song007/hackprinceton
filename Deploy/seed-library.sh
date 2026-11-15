#!/usr/bin/env bash
# Fills a fresh Pear server with a demo library: the real Hollow Choir (Games/Flagship) plus placeholder
# games from made-up studios, so the player app shows a believable catalog. Placeholders carry only a
# scene with runMode and requiredTier; they list and open, but have no game logic.
#   Deploy/seed-library.sh [base-url]      default http://localhost:8080
# Needs Node 22+ and a server started with PEAR_DEV_SIGNIN=1. Re-running adds duplicates (no dedupe).
set -euo pipefail

BASE="${1:-http://localhost:8080}"
GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../Games/Flagship" && pwd)"

exec node - "${BASE%/}" "$GAME_DIR" <<'JS'
const fs = require("fs");
const path = require("path");
const [base, gameDir] = process.argv.slice(2);

async function api(method, route, token, body) {
  const res = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) { console.error(`FAIL: ${method} ${route} -> ${res.status} ${text}`); process.exit(1); }
  return JSON.parse(text);
}

// [title, studio, runMode, requiredTier]. Tier 1 = orientation and touch, 2 = position, 3 = heart rate.
const placeholders = [
  ["Lantern Hunt", "Driftwood Games", "screen", 3],
  ["Sky Swat", "Paper Kite", "device", 1],
  ["Duck & Weave", "Little Lantern", "screen", 1],
  ["Orbit Ball", "Pear Studios", "screen", 1],
  ["Tempo Run", "Northpaw Interactive", "device", 1],
  ["Echo Garden", "Mossbyte", "screen", 2],
  ["Pulse Rally", "Heartline Labs", "screen", 3],
  ["Shadow Tag", "Fourfold", "device", 2],
  ["Stillwater", "Quiet Hours", "screen", 1],
];

const studios = {};
async function studio(name) {
  studios[name] ??= (await api("POST", "/api/accounts/signin", null, { provider: "dev", subject: "studio-" + name, display_name: name })).token;
  return studios[name];
}

async function publish(title, token, version) {
  const game = await api("POST", "/api/games", token, { title });
  await api("POST", `/api/games/${game.id}/versions`, token, version);
  console.log("published " + title);
}

(async () => {
  const read = (rel) => fs.readFileSync(path.join(gameDir, rel), "utf8");
  const scene = JSON.parse(read("scene.json"));
  const scripts = (names) => Object.fromEntries(names.map((n) => [n, read(`scripts/${n}.js`)]));
  for (const [title, by, runMode, tier] of placeholders) {
    await publish(title, await studio(by), {
      scene: { runMode, requiredTier: tier }, client_scripts: {}, server_scripts: {},
      assets: {}, metadata: { placeholder: true }, run_mode: runMode,
    });
  }
  // Last, so it is the newest: the library lists newest first and the player features the first playable game.
  await publish("Hollow Choir", await studio("Pear Studios"), {
    scene, client_scripts: scripts(scene.clientScripts), server_scripts: scripts(scene.serverScripts),
    assets: {}, metadata: {}, run_mode: scene.runMode,
  });
})();
JS
