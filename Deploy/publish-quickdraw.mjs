// Publishes Games/QuickDraw to a Pear backend and prints the two phone URLs.
// Usage: node Deploy/publish-quickdraw.mjs [https://host] [gameId]
// Signs in with the developer login from env PEAR_DEV_USER / PEAR_DEV_PASSWORD (a developer may publish any game);
// without them it falls back to the passwordless "quickdraw-owner" dev account (local servers with PEAR_DEV_SIGNIN=1).
// With a gameId it publishes a new version of that game instead of creating one.
import fs from "node:fs";
import path from "node:path";

const base = (process.argv[2] || "https://155-138-208-146.sslip.io").replace(/\/$/, "");
const existing = process.argv[3];
const dir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "Games", "QuickDraw");

async function api(method, p, token, body) {
  const r = await fetch(base + p, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const read = (rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const scene = JSON.parse(read("scene.json"));
const manifest = JSON.parse(read("pear-game.json")); // the package manifest (Phase 13.1), stored as metadata.manifest
const scripts = (names) => Object.fromEntries(names.map((n) => [n, read(`scripts/${n}.js`)]));

const owner = process.env.PEAR_DEV_USER && process.env.PEAR_DEV_PASSWORD
  ? await api("POST", "/api/accounts/signin", null, { provider: "developer", subject: process.env.PEAR_DEV_USER, password: process.env.PEAR_DEV_PASSWORD })
  : await api("POST", "/api/accounts/signin", null, { provider: "dev", subject: "quickdraw-owner", display_name: "Quick Draw" });
const id = existing || (await api("POST", "/api/games", owner.token, { title: "Quick Draw" })).id;
const v = await api("POST", `/api/games/${id}/versions`, owner.token, {
  scene,
  client_scripts: scripts(scene.clientScripts),
  server_scripts: scripts(scene.serverScripts),
  assets: {},
  metadata: { manifest },
  run_mode: scene.runMode,
});
console.log(`game ${id} version ${v.version}`);
console.log(`phone 1: ${base}/qd-phone.html?game=${id}&name=Player1`);
console.log(`phone 2: ${base}/qd-phone.html?game=${id}&name=Player2`);
