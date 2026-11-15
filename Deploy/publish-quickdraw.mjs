// Publishes Games/QuickDraw to a Pear backend and prints the phone/iPad URLs.
// Usage: node Deploy/publish-quickdraw.mjs [https://host] [gameId]   (needs PEAR_DEV_SIGNIN=1 on the server)
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
const scripts = (names) => Object.fromEntries(names.map((n) => [n, read(`scripts/${n}.js`)]));

const owner = await api("POST", "/api/accounts/signin", null, { provider: "dev", subject: "quickdraw-owner", display_name: "Quick Draw" });
const id = existing || (await api("POST", "/api/games", owner.token, { title: "Quick Draw" })).id;
const v = await api("POST", `/api/games/${id}/versions`, owner.token, {
  scene,
  client_scripts: scripts(scene.clientScripts),
  server_scripts: scripts(scene.serverScripts),
  assets: {},
  metadata: {},
  run_mode: scene.runMode,
});
console.log(`game ${id} version ${v.version}`);
console.log(`iPad:    ${base}/qd-ref.html?game=${id}&name=Referee`);
console.log(`phone 1: ${base}/qd-phone.html?game=${id}&name=Player1`);
console.log(`phone 2: ${base}/qd-phone.html?game=${id}&name=Player2`);
