// Regression self-check for scripts/game.js. Run: node Games/Manhunt/selfcheck.mjs  (exit 0 = pass)
// Replays scenario.json's device scripts against the server handlers with a fake ctx and a virtual clock; no backend needed.
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.serverScript = (def) => def;
const read = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const game = new Function(read("./scripts/game.js").replace(/^export default/m, "return"))();
const scenario = JSON.parse(read("./scenario.json"));

let clock = 0;
const timers = [], views = {};
const ctx = {
  state: {},
  remote: {
    fire: (id, name, data) => { if (name === "view") views[id] = JSON.parse(JSON.stringify(data)); },
    fireAll: () => {},
  },
  now: () => clock,
  after: (ms, tag, data) => timers.push({ at: clock + ms, tag, data, live: true }) - 1,
  cancel: (i) => { timers[i].live = false; },
};

// timeline: scenario steps (gps -> location, send -> as is) merged with timers, ordered by time
const events = [];
scenario.devices.forEach((d, i) => {
  events.push({ at: 0, join: d.name });
  (d.script || []).forEach((s) => events.push({ at: s.at, id: d.name, name: s.gps ? "location" : s.send.name, data: s.gps ? { acc: 5, ...s.gps } : s.send.data }));
});
events.sort((a, b) => a.at - b.at);
const fireTimers = (upTo) => {
  for (;;) {
    const t = timers.filter((x) => x.live && x.at <= upTo).sort((a, b) => a.at - b.at)[0];
    if (!t) return;
    t.live = false; clock = t.at; game.onTimer(ctx, t.tag, t.data);
  }
};
for (const e of events) {
  fireTimers(e.at); clock = e.at;
  if (e.join) game.onPlayerJoin(ctx, { id: e.join, name: e.join });
  else game.onRemote(ctx, { id: e.id }, e.name, e.data);
}
fireTimers(scenario.durationMs);

const s = ctx.state.players;
assert.equal(s.Hunter.role, "hunter");
assert.equal(s.Runner1.role, "runner");
assert.equal(s.Runner1.caught, true, "runner 1 caught by the tag");
assert.equal(s.Runner2.caught, false, "runner 2 survives");
assert.equal(views.Hunter.caughtCount, 1);
assert.equal(views.Runner1.caught, true);
assert.equal(views.Runner2.winner, "runners");
assert.equal(ctx.state.phase, "over");

// tag out of range is refused and does not catch
{
  const c2 = { ...ctx, state: {} };
  c2.remote = ctx.remote;
  game.onPlayerJoin(c2, { id: "H", name: "H" }); game.onPlayerJoin(c2, { id: "R", name: "R" });
  game.onTimer(c2, "begin", {});
  game.onRemote(c2, { id: "H" }, "location", { lat: 40, lng: -74, acc: 5 });
  game.onRemote(c2, { id: "R" }, "location", { lat: 40.0003, lng: -74, acc: 5 }); // ~33 m
  game.onRemote(c2, { id: "H" }, "tag", {});
  assert.equal(c2.state.players.R.caught, false);
  game.onRemote(c2, { id: "R" }, "location", { lat: 40.0001, lng: -74, acc: 5 }); // ~11 m
  game.onRemote(c2, { id: "H" }, "tag", {});
  assert.equal(c2.state.players.R.caught, true);
  assert.equal(c2.state.winner, "hunters");
}

// ui.json shape + scene
const ui = JSON.parse(read("./ui.json"));
assert.equal(ui.pearui, 1);
assert.ok(JSON.stringify(ui).includes('"kind":"location"') || JSON.stringify(ui).includes('"kind": "location"'));
console.log("manhunt selfcheck ok");
