// Regression self-check for scripts/game.js. Run: node Games/Manhunt/selfcheck.mjs  (exit 0 = pass)
// Drives the server handlers directly with a fake ctx; records fireAll (public `view`) and fire (private `you`) separately.
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.serverScript = (def) => def;
const src = fs.readFileSync(new URL("./scripts/game.js", import.meta.url), "utf8").replace(/^export default/m, "return");
const game = new Function(src)();

const fired = [], priv = [], timers = [];
const ctx = {
  state: {},
  remote: {
    fireAll: (name, data) => fired.push([name, JSON.parse(JSON.stringify(data))]),
    fire: (id, name, data) => priv.push([id, name, JSON.parse(JSON.stringify(data))]),
  },
  now: () => 1_000_000,
  after: (ms, tag, data) => timers.push({ tag, data }),
};
const ids = ["a", "b", "c"];
const send = (id, name, data = {}) => game.onRemote(ctx, { id }, name, data);
ids.forEach((id) => game.onPlayerJoin(ctx, { id, name: id }));
// a is the hunter (3 players -> 1 hunter), b and c run; b is 20 m from a (HOT), c is ~1.1 km away
send("a", "location", { lat: 40.3431, lng: -74.6551 });
send("b", "location", { lat: 40.3431, lng: -74.6551 + 0.00018 });
send("c", "location", { lat: 40.3531, lng: -74.6551 }); // all three fixes: countdown starts
assert.equal(ctx.state.phase, "countdown");
const t = timers.find((x) => x.tag === "hunt"); game.onTimer(ctx, t.tag, t.data);
assert.equal(ctx.state.phase, "hunt");

const last = (id) => priv.filter((p) => p[0] === id && p[1] === "you").at(-1)[2];
assert.equal(last("a").role, "hunter");
assert.equal(last("a").pings.length, 2); // hunters see runner positions
assert.equal(last("b").role, "runner");
assert.equal(last("b").hint, "HOT");
assert.equal(last("b").alarm, true);
assert.equal(last("c").alarm, false, "alarm is per player");
assert.deepEqual(last("b").pings, []); // runners never get positions
assert.deepEqual(last("c").pings, []);
// public view: no hunter/runner positions, roles or hints anywhere
for (const [name, v] of fired) {
  assert.equal(name, "view");
  const s = JSON.stringify(v);
  assert.ok(!("pings" in v) && !("alarm" in v), "view carries no pings or alarm");
  assert.ok(!/"(role|hint|lat|lng)"/.test(s), "view carries no role, hint or position: " + s);
}
// every event a runner ever received contains no position
for (const [id, , d] of priv.filter((p) => p[0] !== "a")) assert.ok(!/"(lat|lng)"/.test(JSON.stringify(d)), id + " received a position");

send("a", "location", { lat: 40.3431, lng: -74.6551 });
send("c", "location", { lat: 40.3431, lng: -74.6551 + 0.00005 }); // c within tag range
send("a", "tag"); // tags nearest runner in range
assert.equal(fired.at(-1)[1].caughtCount, 1);
assert.equal(last("c").caught, true);
console.log("manhunt selfcheck ok");
