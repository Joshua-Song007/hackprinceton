// Regression self-check for scripts/game.js. Run: node Games/QuickDraw/selfcheck.mjs  (exit 0 = pass)
// Drives the server handlers directly with a fake ctx (state, fireAll, manual timers); no Studio or backend needed.
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.serverScript = (def) => def;
const src = fs.readFileSync(new URL("./scripts/game.js", import.meta.url), "utf8").replace(/^export default/m, "return");
const game = new Function(src)();

function make() {
  const fired = [], timers = [];
  const ctx = {
    state: {},
    remote: { fireAll: (name, data) => fired.push([name, JSON.parse(JSON.stringify(data))]) },
    now: () => 1_000_000,
    after: (ms, tag, data) => timers.push({ ms, tag, data, live: true }) - 1,
    cancel: (id) => { timers[id].live = false; },
  };
  const s = ctx.state;
  const h = {
    ctx, fired, timers,
    join: (id) => game.onPlayerJoin(ctx, { id, name: id }),
    leave: (id) => game.onPlayerLeave(ctx, { id }),
    send: (id, name, data = {}) => game.onRemote(ctx, { id }, name, data),
    ready: (id) => h.send(id, "ready", { round: s.round }),
    raised: (id, ms) => h.send(id, "raised", { round: s.round, sinceFireMs: ms }),
    // runs the newest live timer, as the host would when it elapses
    tick: () => { const t = timers.filter((x) => x.live).at(-1); t.live = false; game.onTimer(ctx, t.tag, t.data); },
    results: () => fired.filter((f) => f[0] === "roundResult").map((f) => f[1]),
    lobby() {
      ["p1", "p2"].forEach(h.join);
      h.send("p1", "role", { role: "phone" }); h.send("p2", "role", { role: "phone" });
    },
    // both ready -> countdown -> arming -> fire
    toFire() {
      if (s.phase === "roundOver") { h.send("p1", "lowered"); h.send("p2", "lowered"); h.tick(); } // min display time over, both lowered: the next round starts by itself
      else { h.ready("p1"); h.ready("p2"); }
      assert.equal(s.phase, "countdown");
      h.tick(); assert.equal(s.phase, "arming");
      h.tick(); assert.equal(s.phase, "fire");
    },
  };
  return h;
}

// Scene: two phones on their own devices, nothing visible, one zero-scale host for the client script.
{
  const scene = JSON.parse(fs.readFileSync(new URL("./scene.json", import.meta.url), "utf8"));
  assert.equal(scene.runMode, "device");
  assert.deepEqual(scene.inputs.players, [2, 2]);
  assert.deepEqual(scene.clientScripts, ["player"]);
  assert.equal(scene.entities.length, 1);
  const [host] = scene.entities;
  assert.notEqual(host.name, "Arena");
  assert.deepEqual(host.scale, [0, 0, 0]);
  assert.equal(host.color, undefined);
  assert.deepEqual(host.components, [{ type: "script", name: "player" }]);
  const player = fs.readFileSync(new URL("./scripts/player.js", import.meta.url), "utf8");
  assert.ok(!/"ref"/.test(player) && !/"start"/.test(player)); // no referee role or start event on the client
  assert.ok(player.includes('audio.play("beep")') && player.includes("ctx.haptic")); // the phone plays its own cue
}

// Auto-start only when both phones are ready; no host start, no ref needed, ref start ignored.
{
  const h = make(); h.lobby();
  h.ready("p1"); assert.equal(h.ctx.state.phase, "lobby");
  h.send("p1", "start"); assert.equal(h.ctx.state.phase, "lobby"); // legacy start event does nothing
  h.join("r"); h.send("r", "role", { role: "ref" }); assert.equal(h.ctx.state.players.r.role, null); // no referee role
  h.send("p2", "ready", { round: 99 }); assert.equal(h.ctx.state.phase, "lobby"); // stale ready
  h.ready("p2"); assert.equal(h.ctx.state.phase, "countdown");
  assert.deepEqual(h.ctx.state.players.p1.ready, false); // readiness consumed by the start
  const h2 = make(); ["p1", "p2"].forEach(h2.join); // no ref at all
  h2.send("p1", "role", { role: "phone" }); h2.send("p2", "role", { role: "phone" });
  h2.ready("p1"); h2.ready("p2"); assert.equal(h2.ctx.state.phase, "countdown");
}

// Stale and duplicate input.
{
  const h = make(); h.lobby(); h.toFire();
  const round = h.ctx.state.round;
  h.send("p1", "raised", { round: round - 1, sinceFireMs: 100 }); assert.equal(h.ctx.state.reactions.length, 0); // stale round
  h.send("p1", "raised", { sinceFireMs: 100 }); assert.equal(h.ctx.state.reactions.length, 0); // no round
  h.send("p1", "raised", { round, sinceFireMs: "x" }); assert.equal(h.ctx.state.reactions.length, 0); // malformed
  h.raised("p1", 200); h.raised("p1", 50); // duplicate keeps the first report
  assert.deepEqual(h.ctx.state.reactions, [{ id: "p1", ms: 200 }]);
  h.raised("p2", 300);
  assert.deepEqual(h.results().at(-1), { round, matchRound: 1, winnerId: "p1", reason: "fast", reactionMs: { p1: 200, p2: 300 }, scores: { p1: 1, p2: 0 } });
  h.raised("p2", 10); assert.equal(h.results().length, 1); // late duplicate after the round
  assert.equal(h.ctx.state.phase, "roundOver");
  h.send("p1", "ready", { round: round - 1 }); h.send("p2", "ready", { round: round - 1 });
  assert.equal(h.ctx.state.phase, "roundOver"); // stale readies do not start the next round
}

// Arming schedules the cue 2 to 6 s out; a raise before the cue is a foul whatever time it reports.
{
  const h = make(); h.lobby();
  h.ready("p1"); h.ready("p2"); h.tick();
  const arm = h.fired.find((f) => f[0] === "arming")[1], t = h.timers.at(-1);
  assert.equal(arm.round, h.ctx.state.round);
  assert.ok(t.ms >= 2000 && t.ms <= 6000);
  h.raised("p1", 0); // before the cue: foul, even with a plausible time
  assert.deepEqual([h.results().at(-1).winnerId, h.results().at(-1).reason], ["p2", "foul"]);
}

// Foul: raise while arming, and an early (null) raise after the cue state.
{
  const h = make(); h.lobby();
  h.ready("p1"); h.ready("p2"); h.raised("p1", 5); // during countdown: ignored
  assert.equal(h.ctx.state.phase, "countdown");
  h.tick(); h.raised("p1", null);
  assert.deepEqual([h.results().at(-1).winnerId, h.results().at(-1).reason], ["p2", "foul"]);
  const g = make(); g.lobby(); g.toFire(); g.raised("p2", null);
  assert.deepEqual([g.results().at(-1).winnerId, g.results().at(-1).reason], ["p1", "foul"]);
}

// Tie: equal times are no win for either phone and nobody scores; arrival order is irrelevant.
{
  const h = make(); h.lobby(); h.toFire();
  h.raised("p2", 250); h.raised("p1", 250);
  assert.deepEqual([h.results().at(-1).winnerId, h.results().at(-1).reason], [null, "tie"]);
  assert.deepEqual(h.ctx.state.scores, { p1: 0, p2: 0 });
  assert.equal(h.ctx.state.phase, "roundOver");
}

// Give-up: nobody raises during fire -> tie after GIVE_UP_MS; a stale giveup from an earlier round is ignored.
{
  const h = make(); h.lobby(); h.toFire();
  const t = h.timers.at(-1);
  assert.equal(t.tag, "giveup");
  assert.ok(t.ms >= 1000);
  const staleRound = h.ctx.state.round;
  h.tick();
  assert.deepEqual([h.results().at(-1).winnerId, h.results().at(-1).reason], [null, "tie"]);
  assert.equal(h.ctx.state.phase, "roundOver");
  h.tick(); h.tick(); h.tick(); assert.equal(h.ctx.state.phase, "fire"); // next-round timer, countdown, arming
  game.onTimer(h.ctx, "giveup", { round: staleRound }); // stale token
  assert.equal(h.ctx.state.phase, "fire");
  h.raised("p1", 100); // report window replaces the give-up timer; one raise still resolves
  assert.equal(h.timers.at(-1).tag, "resolve");
  h.tick();
  assert.equal(h.results().at(-1).winnerId, "p1");
}

// Disconnect and reconnect invalidate readiness and the round in progress.
{
  const h = make(); h.lobby(); h.ready("p1");
  const before = h.ctx.state.round;
  h.send("p2", "role", { role: "phone" }); // reload of p2 in the lobby: only p2 loses readiness
  assert.equal(h.ctx.state.players.p1.ready, true);
  h.ready("p2"); assert.equal(h.ctx.state.phase, "countdown");
  h.send("p1", "role", { role: "phone" }); // reload during the countdown voids it
  assert.equal(h.ctx.state.phase, "lobby");
  assert.ok(h.ctx.state.round > before + 1);
  assert.deepEqual(Object.values(h.ctx.state.players).map((p) => p.ready), [false, false]);
  h.ready("p1"); h.ready("p2"); h.tick(); h.tick(); assert.equal(h.ctx.state.phase, "fire");
  const arm = h.timers.length;
  h.leave("p1"); // disconnect mid-round
  assert.equal(h.ctx.state.phase, "lobby");
  assert.deepEqual(h.ctx.state.scores, { p2: 0 });
  h.raised("p2", 100); assert.equal(h.results().length, 0);
  h.join("p3"); h.send("p3", "role", { role: "phone" }); // a replacement phone must be ready too
  assert.equal(h.ctx.state.phase, "lobby");
  h.ready("p2"); assert.equal(h.ctx.state.phase, "lobby");
  h.ready("p3"); assert.equal(h.ctx.state.phase, "countdown");
  assert.ok(h.timers.length > arm);
  const s = make(); s.lobby(); s.join("spec"); s.leave("spec"); // a spectator leaving changes nothing
  s.ready("p1"); assert.equal(s.ctx.state.players.p1.ready, true);
}

// Replay: after matchOver each phone must report ready again; scores reset.
{
  const h = make(); h.lobby();
  for (let i = 0; i < 2; i++) {
    h.toFire(); h.raised("p1", 100); h.raised("p2", 200);
    if (i === 0) assert.equal(h.ctx.state.phase, "roundOver");
  }
  assert.equal(h.ctx.state.phase, "matchOver");
  assert.equal(h.fired.filter((f) => f[0] === "matchOver").length, 1);
  h.ready("p1"); assert.equal(h.ctx.state.phase, "matchOver"); // one phone is not enough
  h.ready("p2");
  assert.equal(h.ctx.state.phase, "countdown");
  assert.equal(h.ctx.state.matchRound, 1);
  assert.deepEqual(h.ctx.state.scores, { p1: 0, p2: 0 });
}

// Queue: extra phones wait FIFO, cannot ready/draw, are promoted on a disconnect with readiness reset, no phantom slots.
{
  const h = make(); h.lobby();
  const phones = () => Object.keys(h.ctx.state.players).filter((id) => h.ctx.state.players[id].role === "phone");
  ["q1", "q2", "q3"].forEach((id) => { h.join(id); h.send(id, "role", { role: "phone" }); });
  h.send("q1", "role", { role: "phone" }); h.send("q1", "role", { role: "phone" }); // duplicate role keeps place, no second entry
  h.send("q2", "role", { role: "ref" }); // a different role from a queued phone is ignored
  assert.deepEqual(h.ctx.state.queue, ["q1", "q2", "q3"]);
  assert.deepEqual(phones(), ["p1", "p2"]);
  assert.equal(h.ctx.state.players.q1.role, "queued");
  h.ready("p1");
  h.ready("q1"); h.ready("q2"); // queued phones cannot ready
  assert.equal(h.ctx.state.phase, "lobby");
  h.ready("p2"); h.tick(); h.tick(); assert.equal(h.ctx.state.phase, "fire");
  h.raised("q1", 1); h.raised("q2", 2); // nor draw
  assert.equal(h.ctx.state.reactions.length, 0);
  h.join("late"); h.send("late", "role", { role: "phone" }); // mid-match arrival queues behind
  assert.deepEqual(h.ctx.state.queue, ["q1", "q2", "q3", "late"]);
  h.leave("q2"); // a queued phone leaving frees no slot and leaves no hole
  assert.deepEqual(h.ctx.state.queue, ["q1", "q3", "late"]);
  assert.equal(h.ctx.state.phase, "fire");
  h.leave("p2"); // assigned phone leaves: lobby, readiness reset, head promoted
  assert.equal(h.ctx.state.phase, "lobby");
  assert.deepEqual(phones().sort(), ["p1", "q1"]);
  assert.deepEqual(h.ctx.state.queue, ["q3", "late"]);
  assert.deepEqual(Object.values(h.ctx.state.players).map((p) => p.ready), Object.values(h.ctx.state.players).map(() => false));
  assert.deepEqual(h.ctx.state.scores, { p1: 0, q1: 0 });
  h.ready("p1"); h.ready("q3"); assert.equal(h.ctx.state.phase, "lobby"); // still queued
  h.ready("q1"); assert.equal(h.ctx.state.phase, "countdown");
  h.leave("q1"); h.leave("p1"); // both slots freed: two promotions in FIFO order
  assert.deepEqual(phones().sort(), ["late", "q3"]);
  assert.deepEqual(h.ctx.state.queue, []);
  h.leave("q3"); // nobody left in the queue: the slot stays free
  assert.deepEqual(phones(), ["late"]);
  assert.equal(h.ctx.state.phase, "lobby");
  // a reload (repeat role) of a queued phone keeps its place
  h.join("z"); h.join("y"); h.send("z", "role", { role: "phone" }); h.send("y", "role", { role: "phone" });
  assert.deepEqual([h.ctx.state.players.z.role, h.ctx.state.players.y.role], ["phone", "queued"]);
  h.send("y", "role", { role: "phone" }); assert.deepEqual(h.ctx.state.queue, ["y"]);
}

// Idle kick, auto next round, raised tracking (details in Web/packages/pear-script/test/quickdraw-server.test.ts).
{
  const h = make(); h.lobby(); h.join("q"); h.send("q", "role", { role: "phone" });
  h.ready("p1");
  const t = h.timers.at(-1);
  assert.equal(t.tag, "idle");
  h.tick(); // p2 never readied: back of the queue, q promoted, p1 stays ready
  assert.deepEqual([h.ctx.state.queue, h.ctx.state.players.q.role, h.ctx.state.players.p1.ready], [["p2"], "phone", true]);
  h.ready("q"); h.tick(); h.tick(); h.raised("p1", 100); h.raised("q", 200);
  assert.equal(h.ctx.state.players.p1.raised, true);
  h.tick(); assert.equal(h.ctx.state.phase, "roundOver"); // minimum time over but both still raised
  h.send("p1", "lowered"); assert.equal(h.ctx.state.phase, "roundOver");
  h.send("q", "lowered"); assert.equal(h.ctx.state.phase, "countdown"); // no re-tap
}

console.log("QuickDraw selfcheck passed");
