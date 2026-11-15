import { describe, expect, it } from 'vitest';
import prelude from '../../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js?raw';
import { LocalServer, MAX_TIMERS, type LocalServerOptions } from '../src';

// Same fixture and expectations as Backend/tests/script_host.rs, so the Rust and in-page hosts stay aligned.
const SHARED_FIXTURE = `export default serverScript({
  onPlayerJoin(ctx, player) {
    ctx.state.health = ctx.state.health || {};
    ctx.state.health[player.id] = 100;
  },
  onPlayerLeave(ctx, player) {
    delete ctx.state.health[player.id];
  },
  onRemote(ctx, player, name, data) {
    if (name === "punch") {
      ctx.remote.fireAll("hit", { from: player.id, dir: data.dir });
    }
  },
});`;

function make(sources: string[]) {
  const fired: [string | null, string, unknown][] = [];
  const errors: string[] = [];
  const logs: string[] = [];
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const options: LocalServerOptions = {
    prelude,
    onFire: (p, n, d) => fired.push([p, n, d]),
    onError: (m) => errors.push(m),
    onLog: (l, t) => logs.push(`${l}:${t}`),
    setTimer: (fn, ms) => timers.push({ fn, ms, live: true }) - 1,
    clearTimer: (h) => void (timers[h as number]!.live = false),
  };
  const s = new LocalServer(options);
  s.load(sources);
  const fire = (i: number) => timers[i]!.live && timers[i]!.fn();
  return { s, fired, errors, logs, timers, fire };
}
const state = (s: LocalServer) => JSON.parse(s.stateJSON());

describe('LocalServer', () => {
  it('join / leave update state, punch fires to all', () => {
    const { s, fired } = make([SHARED_FIXTURE]);
    s.join('p1');
    s.join('p2');
    expect(state(s)).toEqual({ health: { p1: 100, p2: 100 } });
    s.leave('p1');
    expect(state(s)).toEqual({ health: { p2: 100 } });
    s.remote('p2', 'punch', { dir: [1, 0, 0] });
    expect(fired).toEqual([[null, 'hit', { from: 'p2', dir: [1, 0, 0] }]]);
  });

  it('ctx.agent.run rejects with "agent runtime not configured" in a local run', async () => {
    const { s, logs } = make([`export default serverScript({ onRemote(ctx) { ctx.agent.run("hi").catch((e) => console.log("err", String(e.message))); } });`]);
    s.remote('a', 'x', null);
    await Promise.resolve();
    await Promise.resolve();
    expect(logs).toEqual(['log:err agent runtime not configured']);
  });

  it('after / cancel / onTimer, clamped delay, player name', () => {
    const src = `export default serverScript({
      onPlayerJoin(ctx, p) { ctx.state.who = [p.id, p.name]; },
      onRemote(ctx, p, name) {
        if (name === "arm") { ctx.state.a = ctx.after(1, "boom", { n: 1 }); ctx.state.b = ctx.after(2000, "x"); }
        if (name === "disarm") ctx.cancel(ctx.state.b);
      },
      onTimer(ctx, tag, data) { ctx.state.fired = [tag, data]; },
    });`;
    const { s, timers, fire } = make([src]);
    s.join('a', 'Ada');
    expect(state(s).who).toEqual(['a', 'Ada']);
    s.remote('a', 'arm', null);
    expect(timers.map((t) => t.ms)).toEqual([50, 2000]); // 1 ms clamped up to 50
    s.remote('a', 'disarm', null);
    expect(s.pendingTimers).toBe(1);
    fire(1); // cancelled, must not run
    fire(0);
    expect(state(s).fired).toEqual(['boom', { n: 1 }]);
    expect(s.pendingTimers).toBe(0);
  });

  it('caps pending timers and reports it', () => {
    const src = `export default serverScript({ onRemote(ctx) { for (let i = 0; i < ${MAX_TIMERS + 3}; i++) ctx.after(100, "t"); } });`;
    const { s, errors } = make([src]);
    s.remote('a', 'x', null);
    expect(s.pendingTimers).toBe(MAX_TIMERS);
    expect(errors.length).toBe(3);
  });

  it('contains handler errors and keeps running', () => {
    const src = `export default serverScript({ onRemote(ctx, p, name) { if (name === "boom") throw new Error("bad"); ctx.state.ok = true; } });`;
    const { s, errors } = make([src]);
    s.remote('a', 'boom', null);
    expect(errors[0]).toContain('bad');
    s.remote('a', 'fine', null);
    expect(state(s).ok).toBe(true);
  });

  it('ctx is frozen with only state, remote, lobby, players, phases, now, after, cancel, agent; no IO globals', () => {
    const src = `export default serverScript({ onRemote(ctx) {
      ctx.remote.fireAll("probe", { keys: Object.keys(ctx).sort(), frozen: Object.isFrozen(ctx),
        io: [typeof fetch, typeof document, typeof WebSocket, typeof window] });
    } });`;
    const { s, fired } = make([src]);
    s.remote('a', 'x', null);
    expect(fired[0]![2]).toEqual({ keys: ['after', 'agent', 'cancel', 'enterPhase', 'lobby', 'now', 'phaseEnteredAt', 'players', 'remote', 'state'], frozen: true, io: ['undefined', 'undefined', 'undefined', 'undefined'] });
  });

  it('rejects scripts that do not load', () => {
    expect(() => make(['export default serverScript({ onNope() {} });'])).toThrow();
    expect(() => make(['var x = 1;'])).toThrow();
  });

  it('console output is captured', () => {
    const { s, logs } = make([`export default serverScript({ onRemote() { console.log("hi", { n: 1 }); console.warn("w"); } });`]);
    s.remote('a', 'x', null);
    expect(logs).toEqual(['log:hi {"n":1}', 'warn:w']);
  });

  it('ctx.lobby defaults to OPEN and follows the option', () => {
    const src = `export default serverScript({ onRemote(ctx) { ctx.state.l = ctx.lobby; } });`;
    const a = make([src]);
    a.s.remote('a', 'x', null);
    expect(state(a.s).l).toBe('OPEN');
    const s = new LocalServer({ prelude, onFire: () => {}, lobby: 'ABCD' });
    s.load([src]);
    s.remote('a', 'x', null);
    expect(state(s).l).toBe('ABCD');
  });

  it('ctx.players() lists names and last-seen, without a leaver', () => {
    let t = 1000;
    const s = new LocalServer({ prelude, onFire: () => {}, now: () => t });
    s.load([`export default serverScript({
      onPlayerLeave(ctx) { ctx.state.left = ctx.players().map((p) => p.id); },
      onRemote(ctx) { ctx.state.all = ctx.players(); },
    });`]);
    s.join('a', 'Ann');
    s.join('b');
    t = 2500;
    s.remote('a', 'x', null);
    expect(state(s).all).toEqual([{ id: 'a', name: 'Ann', lastSeen: 2500 }, { id: 'b', name: '', lastSeen: 1000 }]);
    s.leave('a');
    expect(state(s).left).toEqual(['b']);
  });

  it('player timers pass the player id and are cancelled when the player leaves', () => {
    const { s, timers, fire } = make([`export default serverScript({
      onRemote(ctx, p) { ctx.after(100, 'ping', { n: 1 }, p.id); ctx.after(100, 'g'); },
      onTimer(ctx, tag, data, pid) { ctx.state.f = (ctx.state.f || []).concat([[tag, data, pid ?? null]]); },
    });`]);
    s.join('a');
    s.remote('a', 'x', null);
    fire(0);
    fire(1);
    expect(state(s).f).toEqual([['ping', { n: 1 }, 'a'], ['g', null, null]]);
    s.remote('a', 'x', null);
    s.leave('a');
    expect(timers[2]!.live).toBe(false);
    expect(timers[3]!.live).toBe(true);
  });

  it('ctx.cancel on a fired or unknown handle returns false without error', () => {
    const { s, fire, errors } = make([`export default serverScript({
      onRemote(ctx, p, name) {
        if (name === 'arm') ctx.state.id = ctx.after(100, 't');
        else ctx.state.r = [ctx.cancel(ctx.state.id), ctx.cancel(ctx.state.id), ctx.cancel(999)];
      },
    });`]);
    s.remote('a', 'arm', null);
    fire(0);
    s.remote('a', 'go', null);
    expect(state(s).r).toEqual([false, false, false]);
    expect(errors).toEqual([]);
  });

  it('phaseEnteredAt returns the current or named phase entry time, else null', () => {
    let t = 10;
    const s = new LocalServer({ prelude, onFire: () => {}, now: () => t });
    s.load([`export default serverScript({
      onRemote(ctx, p, name) {
        if (name === 'ask') ctx.state.r = [ctx.phaseEnteredAt(), ctx.phaseEnteredAt('lobby'), ctx.phaseEnteredAt('nope')];
        else ctx.enterPhase(name);
      },
    });`]);
    s.remote('a', 'ask', null);
    expect(state(s).r).toEqual([null, null, null]);
    s.remote('a', 'lobby', null);
    t = 99;
    s.remote('a', 'play', null);
    s.remote('a', 'ask', null);
    expect(state(s).r).toEqual([99, 10, null]);
  });

  it('ctx.remote.fire sends to one player only', () => {
    const { s, fired } = make([`export default serverScript({ onRemote(ctx) { ctx.remote.fire('hunter', 'pos', { lat: 1 }); } });`]);
    s.remote('prey', 'x', null);
    expect(fired).toEqual([['hunter', 'pos', { lat: 1 }]]);
  });
});
