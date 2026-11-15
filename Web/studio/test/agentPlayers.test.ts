import { describe, expect, it } from 'vitest';
import { parseScene, type Action, type Observation } from '@pear/runtime';
import type { CallResult, HandlerCall, ScriptSandbox } from '@pear/script';
import { AgentDriver, type AgentHost } from '../src/agentPlayers';
import type { AgentTransport, DecideRequest, PlanReply } from '../src/agentTransport';
import { createPauseClock } from '../src/pauseClock';
import { LocalRun, createPlayServer, joinPlay } from '../src/run';

// Hand-driven real time and scheduler under the pause clock.
function world() {
  let t = 5000;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const clock = createPauseClock({
    now: () => t,
    epoch: () => 1_700_000_000_000 + t,
    setTimeout: (fn, ms) => (pending.set(nextHandle, { at: t + ms, fn }), nextHandle++),
    clearTimeout: (h) => void pending.delete(h as number),
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = [...pending].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      t = due[1].at;
      due[1].fn();
    }
    t = end;
  };
  return { clock, advance };
}

const observation = (gameTime = 0): Observation => ({ gameTime, you: { position: [0, 0], facing: 0, arena: 10, devices: [] }, others: [], heard: [] });
const flush = () => new Promise((r) => setTimeout(r, 0));

function fakes() {
  const requests: DecideRequest[] = [];
  const waiting: { resolve(r: PlanReply): void; reject(e: Error): void }[] = [];
  const transport: AgentTransport = {
    decide: (r) => (requests.push(r), new Promise<PlanReply>((resolve, reject) => waiting.push({ resolve, reject }))),
    report: async () => ({ unsure: [], summary: '' }),
    close() {},
  };
  const applied: Action[] = [];
  const state = { walking: false };
  const host: AgentHost = {
    observation: () => observation(requests.length),
    apply: (a) => void applied.push(a),
    walking: () => state.walking,
    intro: () => ({ role: { id: 'r', name: 'R', brief: 'b', kind: 'player' }, instructions: { title: 'T' } }),
  };
  return { requests, waiting, transport, applied, state, host };
}

const driver = (f: ReturnType<typeof fakes>, w: ReturnType<typeof world>, extra: Partial<ConstructorParameters<typeof AgentDriver>[0]> = {}) =>
  new AgentDriver({ id: 'player-2', run: 'run-1', seat: { persona: 'follows', role: 'r' }, clock: w.clock, transport: f.transport, host: f.host, ...extra });

describe('AgentDriver', () => {
  it('holds the clock while the agent thinks and releases it after, sending the persona, role and instructions', async () => {
    const w = world(), f = fakes(), d = driver(f, w);
    d.tick();
    expect(d.status).toBe('thinking');
    expect(w.clock.held).toBe(1);
    expect(f.requests[0]).toMatchObject({ run: 'run-1', player: 'player-2', persona: 'follows', role: { id: 'r' }, instructions: { title: 'T' } });
    f.waiting[0]!.resolve({ actions: [{ type: 'say', text: 'hi' }], unsure: [] });
    await flush();
    expect(w.clock.held).toBe(0);
    expect(d.calls).toBe(1);
    d.tick();
    expect(f.applied).toEqual([{ type: 'say', text: 'hi' }]);
    expect(d.lastSay).toBe('hi');
  });

  it('releases on an error, notes it once and waits before asking again', async () => {
    const w = world(), f = fakes(), d = driver(f, w);
    d.tick();
    f.waiting[0]!.reject(new Error('no key'));
    await flush();
    expect(w.clock.held).toBe(0);
    expect(d.notes).toMatchObject([{ from: 'player-2', why: 'no key' }]);
    w.advance(9000);
    d.tick();
    expect(f.requests).toHaveLength(1);
    w.advance(1000);
    d.tick();
    expect(f.requests).toHaveLength(2);
    f.waiting[1]!.reject(new Error('no key'));
    await flush();
    expect(d.notes).toHaveLength(1); // the same message is noted once
  });

  it('two agents thinking hold the clock twice', async () => {
    const w = world(), a = fakes(), b = fakes();
    const da = driver(a, w), db = driver(b, w, { id: 'player-3' });
    da.tick();
    db.tick();
    expect(w.clock.held).toBe(2);
    a.waiting[0]!.resolve({ actions: [], unsure: [] });
    await flush();
    expect(w.clock.held).toBe(1);
    b.waiting[0]!.resolve({ actions: [], unsure: [] });
    await flush();
    expect(w.clock.held).toBe(0);
  });

  it('carries out a plan in order: a walk finishes first, a wait counts clock seconds, then it asks again after 1.5 s', async () => {
    const w = world(), f = fakes(), d = driver(f, w);
    d.tick();
    f.waiting[0]!.resolve({ actions: [{ type: 'walk_to', x: 2, z: 3 }, { type: 'say', text: 'there' }, { type: 'wait', seconds: 2 }, { type: 'gesture', gesture: 'tap' }], unsure: [] });
    await flush();
    f.state.walking = true;
    d.tick();
    expect(f.applied).toEqual([{ type: 'walk_to', x: 2, z: 3 }]);
    w.advance(500);
    d.tick();
    expect(f.applied).toHaveLength(1); // still walking
    f.state.walking = false;
    d.tick();
    expect(f.applied.map((a) => a.type)).toEqual(['walk_to', 'say']);
    w.advance(1900);
    d.tick();
    expect(f.applied).toHaveLength(2);
    w.advance(100);
    d.tick();
    expect(f.applied.map((a) => a.type)).toEqual(['walk_to', 'say', 'gesture']);
    expect(d.status).toBe('idle');
    w.advance(1400);
    d.tick();
    expect(f.requests).toHaveLength(1);
    w.advance(100);
    d.tick();
    expect(f.requests).toHaveLength(2);
  });

  it('a walk that never arrives stops waiting after 10 s of clock time', async () => {
    const w = world(), f = fakes(), d = driver(f, w);
    d.tick();
    f.waiting[0]!.resolve({ actions: [{ type: 'walk_to', x: 1, z: 1 }, { type: 'say', text: 'late' }], unsure: [] });
    await flush();
    f.state.walking = true;
    d.tick();
    w.advance(9900);
    d.tick();
    expect(f.applied).toHaveLength(1);
    w.advance(200);
    d.tick();
    expect(f.applied.map((a) => a.type)).toEqual(['walk_to', 'say']);
  });

  it('never applies an invalid action', async () => {
    const w = world(), f = fakes(), d = driver(f, w);
    d.tick();
    f.waiting[0]!.resolve({ actions: [{ type: 'fly' }, { type: 'gesture', gesture: 'wave' }, { type: 'say', text: 'ok' }], unsure: [] });
    await flush();
    d.tick();
    expect(f.applied).toEqual([{ type: 'say', text: 'ok' }]);
  });

  it('keeps unsure notes with the player and game time, without repeats', async () => {
    const w = world(), f = fakes(), d = driver(f, w, { every: 0 });
    d.tick();
    f.waiting[0]!.resolve({ actions: [], unsure: [{ phase: 'p1', line: 'Pass it', why: 'to whom?' }] });
    await flush();
    d.tick();
    d.tick();
    f.waiting[1]!.resolve({ actions: [], unsure: [{ phase: 'p1', line: 'Pass it', why: 'to whom?' }] });
    await flush();
    expect(d.notes).toEqual([{ from: 'player-2', gameTime: 0, phase: 'p1', line: 'Pass it', why: 'to whom?' }]);
  });

  it('stops at the call cap, noting it once', async () => {
    const w = world(), f = fakes(), d = driver(f, w, { cap: 2, every: 0 });
    for (let i = 0; i < 2; i++) {
      d.tick();
      f.waiting[i]!.resolve({ actions: [], unsure: [] });
      await flush();
      d.tick();
    }
    d.tick();
    d.tick();
    expect(f.requests).toHaveLength(2);
    expect(d.status).toBe('limit');
    expect(d.notes.filter((n) => n.why.includes('call limit'))).toHaveLength(1);
  });

  it('dispose while thinking gives the hold back once and drops the answer', async () => {
    const w = world(), a = fakes(), b = fakes();
    const da = driver(a, w), db = driver(b, w, { id: 'player-3' });
    da.tick();
    db.tick();
    expect(w.clock.held).toBe(2);
    da.dispose();
    expect(w.clock.held).toBe(1);
    a.waiting[0]!.resolve({ actions: [{ type: 'say', text: 'late' }], unsure: [{ phase: '', line: '', why: 'x' }] });
    await flush();
    da.tick();
    expect(w.clock.held).toBe(1); // b's hold is untouched
    expect(a.applied).toEqual([]);
    expect(da.notes).toEqual([]);
    expect(da.status).toBe('stopped');
  });
});

describe('the pause clock in a run', () => {
  const sandbox = (calls: HandlerCall[]) => ({ loadScript: async () => {}, call: async (c: HandlerCall): Promise<CallResult> => (calls.push(c), { outputs: [] }), dispose: () => {} }) as unknown as ScriptSandbox;

  it('a held clock gives client scripts no time: onTick waits for the release', async () => {
    const w = world();
    const calls: HandlerCall[] = [];
    const scene = parseScene({ entities: [{ name: 'E', components: [{ type: 'script', name: 's' }] }] });
    const run = new LocalRun({ scene, clientScripts: {}, sandbox: sandbox(calls), now: w.clock.now });
    const ticks = () => calls.filter((c) => c.handler === 'onTick').length;
    w.advance(250);
    await run.step();
    expect(ticks()).toBe(1);
    w.clock.hold();
    w.advance(5000);
    await run.step();
    expect(ticks()).toBe(1);
    w.clock.release();
    w.advance(250);
    await run.step();
    expect(ticks()).toBe(2);
  });

  it('the in-page server\'s ctx.now and ctx.after stand still while held and resume after', async () => {
    const w = world();
    const got: [string, unknown][] = [];
    const clients = new Map();
    const server = createPlayServer(clients, { now: w.clock.epoch, setTimer: w.clock.setTimer, clearTimer: w.clock.clearTimer });
    server.load([`export default serverScript({
      onPlayerJoin(ctx, player) { ctx.after(1000, 'later', null); },
      onRemote(ctx, player, name) { ctx.remote.fireAll('now', ctx.now()); },
      onTimer(ctx, tag) { ctx.remote.fireAll('timer', tag); },
    });`]);
    joinPlay(server, clients, 'a', 'A', { deliverRemote: async (n: string, d: unknown) => void got.push([n, d]) });
    w.advance(400);
    w.clock.hold();
    const frozen = w.clock.epoch();
    w.advance(10_000);
    server.remote('a', 'ping', null);
    expect(got.filter(([n]) => n === 'timer')).toEqual([]);
    expect(got.find(([n]) => n === 'now')![1]).toBe(frozen);
    w.clock.release();
    w.advance(599);
    expect(got.filter(([n]) => n === 'timer')).toEqual([]);
    w.advance(1);
    expect(got.filter(([n]) => n === 'timer')).toEqual([['timer', 'later']]);
    server.dispose();
  });
});
