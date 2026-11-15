// Quick Draw as a headless contract harness (actual Play does not use it: it opens the two real phones' pages, see the
// routing tests below): the real game.js in the in-page LocalServer, the real player.js in LocalRuns (two phones, no
// referee), driven by an explicit tap per phone and the simulated phones' raisePhone. Server time and the runs' input
// clock are one fake clock; the only real time is the 60 ms gap that separates the two phones' reaction times, because
// the client measures sinceFireMs with Date.now() in its worker.
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseScene } from '@pear/runtime';
import { ScriptSandbox, type WorkerLike } from '@pear/script';
import gameSource from '../../../Games/QuickDraw/scripts/game.js?raw';
import playerSource from '../../../Games/QuickDraw/scripts/player.js?raw';
import sceneJson from '../../../Games/QuickDraw/scene.json';
import flagshipScene from '../../../Games/Flagship/scene.json';
import hotPotatoScene from '../../../Games/HotPotato/scene.json';
import { rigFor } from '../src/needs';
import { isPhoneOnly, phoneLinks } from '../src/phonePlay';
import { Project } from '../src/project';
import { LocalRun, RunController, createPlayServer, joinPlay, type EffectOutput } from '../src/run';

class NodeWorkerLike implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  private worker = new Worker(new URL('../../packages/pear-script/test/node-worker.ts', import.meta.url), { execArgv: ['--experimental-strip-types'] });
  constructor() {
    this.worker.on('message', (data) => this.onmessage?.({ data }));
    this.worker.on('error', (e) => this.onerror?.({ message: e.message }));
  }
  postMessage(m: unknown) {
    this.worker.postMessage(m);
  }
  terminate() {
    void this.worker.terminate();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Quick Draw in the Studio local server', () => {
  const runs: LocalRun[] = [];
  let dispose = () => {};
  afterEach(() => {
    runs.forEach((r) => r.stop());
    runs.length = 0;
    dispose();
  });

  async function setup(phones = 2) {
    const scene = parseScene(sceneJson);
    let clock = 1000;
    const timers = new Map<number, { at: number; fn: () => void }>();
    let nextTimer = 1;
    const pending = new Set<Promise<unknown>>();
    const seen: { to: string; name: string; data: any }[] = [];
    const outputs: Record<string, EffectOutput[]> = {};
    const clients = new Map<string, { deliverRemote: LocalRun['deliverRemote'] }>();
    const server = createPlayServer(clients, {
      now: () => clock,
      setTimer: (fn, ms) => { const id = nextTimer++; timers.set(id, { at: clock + ms, fn }); return id; },
      clearTimer: (h) => void timers.delete(h as number),
      onError: (m) => { throw new Error(m); },
    });
    dispose = () => server.dispose();
    server.load([gameSource]);

    const ids = Array.from({ length: phones }, (_, i) => `p${i + 1}`);
    for (const id of ids) {
      outputs[id] = [];
      const run = new LocalRun({
        scene, clientScripts: { player: playerSource }, now: () => clock,
        devices: { kinds: rigFor(scene.inputs, scene.gestures, scene.peripherals, !!scene.raise) },
        sandbox: new ScriptSandbox({ createWorker: () => new NodeWorkerLike() }),
        onOutput: (o) => {
          outputs[id]!.push(o);
          if (o.kind === 'remote') server.remote(id, o.name, o.data);
        },
      });
      await run.load();
      runs.push(run);
      const track = (name: string, data: unknown) => {
        seen.push({ to: id, name, data });
        const p = run.deliverRemote(name, data);
        pending.add(p);
        void p.finally(() => pending.delete(p));
        return p;
      };
      joinPlay(server, clients, id, id, { deliverRemote: track });
    }
    const [p1, p2] = runs as [LocalRun, LocalRun];

    // Runs the clients' steps and drains every remote event (a delivery can cause a send, which causes a delivery).
    async function settle() {
      do {
        await Promise.all([...pending]);
        await Promise.all(runs.map((r) => r.step()));
      } while (pending.size);
    }
    async function advance(ms: number) {
      clock += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (t.at <= clock && timers.delete(id)) t.fn();
      await settle();
    }
    const state = () => JSON.parse(server.stateJSON());
    const results = (to = 'p1') => seen.filter((e) => e.to === to && e.name === 'roundResult').map((e) => e.data);
    const tap = async (run: LocalRun) => { run.devices.gesture('tap'); await advance(20); };
    const lowerBoth = async () => { p1.raisePhone(false); p2.raisePhone(false); await advance(20); };
    // Both phones tap Ready, the countdown runs by itself, then the arming delay (at most 6 s) ends in the cue.
    const readyToFire = async () => {
      await tap(p1);
      await tap(p2);
      expect(state().phase).toBe('countdown');
      await advance(3001);
      expect(state().phase).toBe('arming');
      await advance(6001);
      expect(state().phase).toBe('fire');
    };
    return { runs, p1, p2, server, state, results, outputs, seen, tap, readyToFire, lowerBoth, advance };
  }

  it('plays a match with two explicit taps per round: foul, two fast rounds, matchOver, replay', async () => {
    const t = await setup();

    await t.advance(250); // first onTick: both phones announce their role; nobody readies on its own
    expect(t.state().phase).toBe('lobby');
    expect(Object.values(t.state().players).map((p: any) => p.role)).toEqual(['phone', 'phone']);
    expect(t.outputs.p1!.some((o) => o.kind === 'remote' && o.name === 'ready')).toBe(false);

    // Round 1: one tap is not enough; the second starts the countdown by itself, then p2 raises early: foul, p1 takes it.
    await t.tap(t.p1);
    expect(t.outputs.p1!).toContainEqual({ kind: 'remote', name: 'ready', data: { round: 0 } });
    expect(t.state().phase).toBe('lobby');
    await t.tap(t.p2);
    expect(t.state().phase).toBe('countdown');
    expect(t.seen.filter((e) => e.name === 'countdown').map((e) => [e.to, e.data])).toEqual([['p1', { round: 1, matchRound: 1, ms: 3000 }], ['p2', { round: 1, matchRound: 1, ms: 3000 }]]);
    await t.advance(3001);
    expect(t.state().phase).toBe('arming');
    t.p2.raisePhone(true);
    await t.advance(20);
    expect(t.results()).toEqual([expect.objectContaining({ round: 1, winnerId: 'p1', reason: 'foul' })]);
    expect(t.state().phase).toBe('roundOver');
    await t.lowerBoth();
    expect(t.outputs.p2!.some((o) => o.kind === 'remote' && o.name === 'lowered')).toBe(true);

    // Round 2: ready again (readiness was consumed), cue on both phones from the PlayerScriptHost, p2 first, p1 60 ms later.
    await t.readyToFire();
    for (const id of ['p1', 'p2']) expect(t.outputs[id]!).toContainEqual({ kind: 'audio', entity: 'PlayerScriptHost', action: 'play', sound: 'beep' });
    expect(t.outputs.p1!.some((o) => o.kind === 'haptic')).toBe(true);
    t.p2.raisePhone(true);
    await t.advance(20);
    await sleep(60);
    t.p1.raisePhone(true);
    await t.advance(20);
    const round2 = t.results()[1];
    expect(round2).toMatchObject({ matchRound: 2, winnerId: 'p2', reason: 'fast', scores: { p1: 1, p2: 1 } });
    expect(round2.reactionMs.p2).toBeLessThan(round2.reactionMs.p1);
    expect(round2.reactionMs.p1).toBeGreaterThanOrEqual(50);
    expect(t.results('p2')).toEqual(t.results('p1')); // both phones see the same authoritative result
    await t.lowerBoth();

    // Round 3: p1 first, p2 later: p1 wins the match 2 - 1.
    await t.readyToFire();
    t.p1.raisePhone(true);
    await t.advance(20);
    await sleep(60);
    t.p2.raisePhone(true);
    await t.advance(20);
    expect(t.results()[2]).toMatchObject({ matchRound: 3, winnerId: 'p1', reason: 'fast' });
    expect(t.state().phase).toBe('matchOver');
    expect(t.seen.filter((e) => e.to === 'p2' && e.name === 'matchOver').map((e) => e.data)).toEqual([{ winnerId: 'p1', scores: { p1: 2, p2: 1 } }]);

    // Replay: both phones lower and tap Ready again; scores reset, a fresh match.
    await t.lowerBoth();
    await t.tap(t.p1);
    expect(t.state().phase).toBe('matchOver');
    await t.tap(t.p2);
    expect(t.state()).toMatchObject({ phase: 'countdown', matchRound: 1, scores: { p1: 0, p2: 0 } });
  }, 30_000);

  it('drops stale and duplicate input, and keeps an extra phone queued until a slot frees', async () => {
    const t = await setup(3);
    await t.advance(250);
    // The phones' first ticks run in parallel, so which one queues is not fixed: take whoever the server put in line.
    const [queued] = t.state().queue as string[];
    expect(t.state().queue).toHaveLength(1);
    const [a, b] = ['p1', 'p2', 'p3'].filter((id) => id !== queued) as [string, string];
    const run = (id: string) => t.runs[Number(id.slice(1)) - 1]!;
    await t.tap(run(queued!)); // a queued phone cannot ready
    expect(t.state().players[queued!]).toMatchObject({ role: 'queued', ready: false });

    await t.tap(run(a));
    await t.tap(run(b));
    expect(t.state().phase).toBe('countdown');
    await t.advance(3001);
    await t.advance(6001);
    expect(t.state().phase).toBe('fire');
    const round = t.state().round;
    t.server.remote(a, 'raised', { round: round - 1, sinceFireMs: 5 }); // from an earlier round
    t.server.remote(a, 'raised', { sinceFireMs: 5 }); // no round at all
    run(queued!).raisePhone(true); // the queued phone raises: not a draw
    await t.advance(20);
    expect(t.state().reactions).toEqual([]);
    run(a).raisePhone(true);
    await t.advance(20);
    t.server.remote(a, 'raised', { round, sinceFireMs: 1 }); // duplicate keeps the first report
    expect(t.state().reactions).toHaveLength(1);
    await t.advance(500); // report window: the other phone never raised
    expect(t.results(a)).toEqual([expect.objectContaining({ round, winnerId: a, reason: 'fast', reactionMs: expect.objectContaining({ [b]: null }) })]);
    t.server.remote(a, 'ready', { round: round - 1 });
    t.server.remote(b, 'ready', { round: round - 1 });
    expect(t.state().phase).toBe('roundOver'); // stale readies start nothing

    t.server.leave(b); // a phone leaves: lobby, the queue head takes the slot
    expect(t.state()).toMatchObject({ phase: 'lobby', queue: [] });
    expect(t.state().players[queued!].role).toBe('phone');
  }, 30_000);
});

// Actual Play of a phone-only game: no LocalRun, no simulated players, no viewport; the two real phones' pages instead.
describe('Quick Draw Play routing', () => {
  const quickDraw = () => {
    const project = new Project();
    project.load({ scene: structuredClone(sceneJson) as never, clientScripts: { player: playerSource }, serverScripts: { game: gameSource }, gameId: null, version: null });
    return project;
  };
  const harness = (signedIn: boolean) => {
    const viewport = { setRunning: vi.fn(), onRaise: null, others: null };
    const onPhones = vi.fn();
    const account = {
      account: signedIn ? { id: 'a' } : null, gameId: signedIn ? 'g1' : null, serverUrl: 'https://qd.example/', game: { title: 'Quick Draw' },
      publishIfChanged: vi.fn(async () => ({ version: 4, published: true })),
    };
    const debug = { addOutput: vi.fn(), setServerConnected: vi.fn() };
    const run = new RunController({ project: quickDraw(), debug, account, viewport, editor: {}, onPhones } as never);
    return { run, viewport, onPhones, account };
  };

  it('classifies only the invisible-entity device game as phone-only', () => {
    expect(isPhoneOnly(parseScene(sceneJson))).toBe(true);
    expect(isPhoneOnly(parseScene(hotPotatoScene))).toBe(false); // device mode, but visible entities
    expect(isPhoneOnly(parseScene(flagshipScene))).toBe(false);
    expect(isPhoneOnly({ ...parseScene(sceneJson), entities: [] })).toBe(false); // an empty device scene is not a phone-only game
  });

  it('Play publishes if changed, then offers the two phone pages of that game and version, with no run and no viewport', async () => {
    const { run, viewport, onPhones, account } = harness(true);
    await run.runLocal();
    expect(account.publishIfChanged).toHaveBeenCalledTimes(1);
    expect(onPhones).toHaveBeenCalledWith(phoneLinks('https://qd.example/', 'g1', 4));
    expect(onPhones.mock.calls[0]![0].map((l: { url: string }) => l.url)).toEqual([
      'https://qd.example/qd-phone.html?game=g1&name=Player1&version=4',
      'https://qd.example/qd-phone.html?game=g1&name=Player2&version=4',
    ]);
    expect(run.running).toBe(false);
    expect(run.players).toEqual([]);
    expect(viewport.setRunning.mock.calls.every((c) => c[0] === null)).toBe(true); // stop() clears; nothing is ever driven
  });

  it('Play without a signed-in account and game says to publish first, and opens nothing', async () => {
    const { run, viewport, onPhones, account } = harness(false);
    await expect(run.runLocal()).rejects.toThrow(/must be published first.*Sign in/);
    await expect(run.runServer()).rejects.toThrow(/must be published first/);
    expect(account.publishIfChanged).not.toHaveBeenCalled();
    expect(onPhones).not.toHaveBeenCalled();
    expect(viewport.setRunning).not.toHaveBeenCalled();
    expect(run.running).toBe(false);
  });

  it('a test-player tab joining a phone-only version gets that version\'s phone pages, not a simulated player', async () => {
    const { run, viewport, onPhones } = harness(true);
    await run.join('g9', 7);
    expect(onPhones).toHaveBeenCalledWith(phoneLinks('https://qd.example/', 'g9', 7));
    expect(run.running).toBe(false);
    expect(viewport.setRunning).not.toHaveBeenCalled();
  });
});
