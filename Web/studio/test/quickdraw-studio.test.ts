// Quick Draw end to end in the Studio's local Play plumbing: the real game.js in the in-page LocalServer, the real
// player.js in three LocalRuns (2 phones + 1 ref, roles as RunController.setRole sets them), driven by the simulated
// phones' raisePhone. Server time and the runs' input clock are one fake clock; the only real time is the 60 ms gap that
// separates the two phones' reaction times, because the client measures sinceFireMs with Date.now() in its worker.
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { parseScene } from '@pear/runtime';
import { ScriptSandbox, type WorkerLike } from '@pear/script';
import gameSource from '../../../Games/QuickDraw/scripts/game.js?raw';
import playerSource from '../../../Games/QuickDraw/scripts/player.js?raw';
import sceneJson from '../../../Games/QuickDraw/scene.json';
import { rigFor } from '../src/needs';
import { LocalRun, createPlayServer, joinPlay, type EffectOutput } from '../src/run';

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

  async function setup() {
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

    const ids = ['p1', 'p2', 'p3'];
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
      run.role = id === 'p3' ? 'ref' : 'player';
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
    const [p1, p2, ref] = runs as [LocalRun, LocalRun, LocalRun];

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
    const results = () => seen.filter((e) => e.to === 'p3' && e.name === 'roundResult').map((e) => e.data);
    const startRound = async () => { ref.devices.gesture('tap'); await advance(20); };
    const lowerBoth = async () => { p1.raisePhone(false); p2.raisePhone(false); await advance(20); };
    return { p1, p2, ref, state, results, outputs, seen, startRound, lowerBoth, advance, settle };
  }

  it('plays a match: foul round, then two fast rounds to matchOver', async () => {
    const t = await setup();

    await t.advance(250); // first onTick: roles announced, phones calibrate and report ready
    expect(t.state().phase).toBe('ready');
    expect(Object.values(t.state().players).map((p: any) => p.role).sort()).toEqual(['phone', 'phone', 'ref']);
    expect(t.outputs.p1!.some((o) => o.kind === 'remote' && o.name === 'ready')).toBe(true);
    expect(t.outputs.p3!.some((o) => o.kind === 'remote' && o.name === 'ready')).toBe(false); // the ref never readies

    // Round 1: p2 raises before the cue, a foul, p1 takes the round.
    await t.startRound();
    expect(t.state().phase).toBe('arming');
    t.p2.raisePhone(true);
    await t.advance(20);
    expect(t.results()).toEqual([expect.objectContaining({ round: 1, winnerId: 'p1', reason: 'foul' })]);
    expect(t.state().phase).toBe('roundOver');
    await t.lowerBoth();
    expect(t.outputs.p2!.some((o) => o.kind === 'remote' && o.name === 'lowered')).toBe(true);

    // Round 2: cue, p2 raises at once, p1 60 ms later: p2 is faster.
    await t.startRound();
    await t.advance(6001); // past the longest arming delay: fire
    expect(t.state().phase).toBe('fire');
    expect(t.outputs.p3!).toContainEqual({ kind: 'audio', entity: 'Arena', action: 'play', sound: 'beep' });
    expect(t.outputs.p3!).toContainEqual({ kind: 'audio', entity: 'Arena', action: 'speak', text: 'Fire!' });
    t.p2.raisePhone(true);
    await t.advance(20);
    await sleep(60);
    t.p1.raisePhone(true);
    await t.advance(20);
    const round2 = t.results()[1];
    expect(round2).toMatchObject({ round: 2, winnerId: 'p2', reason: 'fast', scores: { p1: 1, p2: 1 } });
    expect(round2.reactionMs.p2).toBeLessThan(round2.reactionMs.p1);
    expect(round2.reactionMs.p1).toBeGreaterThanOrEqual(50);
    expect(t.state().phase).toBe('roundOver');
    await t.lowerBoth();

    // Round 3: p1 first, p2 later: p1 wins the match 2 - 1.
    await t.startRound();
    await t.advance(6001);
    t.p1.raisePhone(true);
    await t.advance(20);
    await sleep(60);
    t.p2.raisePhone(true);
    await t.advance(20);
    expect(t.results()[2]).toMatchObject({ round: 3, winnerId: 'p1', reason: 'fast' });
    expect(t.state().phase).toBe('matchOver');
    expect(t.seen.filter((e) => e.to === 'p3' && e.name === 'matchOver').map((e) => e.data)).toEqual([{ winnerId: 'p1', scores: { p1: 2, p2: 1 } }]);
  }, 30_000);
});
