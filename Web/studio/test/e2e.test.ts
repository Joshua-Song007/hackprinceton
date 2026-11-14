// Headless end-to-end: Flagship template -> Run local (sim devices -> InputBus -> events -> sandbox worker) -> player.js runs.
// The server part runs only against a live backend (OMNI_E2E_URL=http://localhost:8080, backend started with OMNI_DEV_SIGNIN=1).
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { CloudClient } from '@omni/cloud';
import { ScriptSandbox, type WorkerLike } from '@omni/script';
import { DebugStore } from '../src/debug-panel';
import { Project, templateSnapshot } from '../src/project';
import { LocalRun, type EffectOutput } from '../src/run';

// A real worker thread running the sandbox evaluator (same adapter shape as packages/omni-script/test).
class NodeWorkerLike implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  private worker = new Worker(new URL('../../packages/omni-script/test/node-worker.ts', import.meta.url), { execArgv: ['--experimental-strip-types'] }); // Node < 22.18 does not strip TS types by default
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

const headPacket = (t: number, position?: [number, number, number]) => ({
  v: 1 as const, deviceId: 'sim-airpods', kind: 'airpods' as const, slot: 'head' as const, source: 'sim' as const, t, seq: t,
  ch: { orientation: [0, 0, 0, 1] as const, ...(position ? { position } : {}) },
});

describe('Run local against Games/Flagship', () => {
  let run: LocalRun | undefined;
  afterEach(() => run?.stop());

  function open() {
    const project = new Project(templateSnapshot('flagship'));
    const outputs: { script: string; output: EffectOutput }[] = [];
    const loadErrors: string[] = [];
    const packets: string[] = [];
    let now = 1000;
    run = new LocalRun({
      scene: project.description(),
      clientScripts: project.clientScripts,
      sandbox: new ScriptSandbox({ createWorker: () => new NodeWorkerLike() }),
      now: () => now,
      onOutput: (output, script) => outputs.push({ script, output }),
      onLoadError: (script, message) => loadErrors.push(`${script}: ${message}`),
      onPacket: (p) => packets.push(p.source),
    });
    return { run, outputs, loadErrors, packets, advance: (ms: number) => (now += ms) };
  }

  it('loads the Flagship client scripts without errors', async () => {
    const t = open();
    await t.run.load();
    expect(t.loadErrors).toEqual([]);
  });

  it('simulated head pose in Sanctuary runs player.js onTriggerEnter', async () => {
    const t = open();
    await t.run.load();
    t.run.devices.start(); // first tick is immediate; the sim head has no position, so playerOrigin (0, 1.6, 0) is inside Sanctuary
    t.advance(20);
    await t.run.step();
    t.run.devices.stop();
    expect(t.packets).toContain('sim');
    expect(t.outputs).toEqual([
      { script: 'player', output: { kind: 'audio', entity: 'Sanctuary', action: 'play', sound: 'sanctuary_hum' } },
      { script: 'player', output: { kind: 'haptic', pattern: 'soft', intensity: 0.2 } },
    ]);
  });

  it('walking out and back in fires exit then enter, and a phone gesture reaches player.js', async () => {
    const t = open();
    await t.run.load();
    const stepWith = async (position: [number, number, number]) => {
      t.advance(20);
      t.run.ingest(headPacket(t.advance(0), position));
      await t.run.step();
    };
    await stepWith([0, 1.6, 5]);
    t.outputs.length = 0;
    await stepWith([0, 1.6, 0.5]);
    expect(t.outputs.map((o) => o.output.kind)).toEqual(['audio', 'haptic']);
    await stepWith([0, 1.6, 3]);
    expect(t.outputs.at(-1)?.output).toEqual({ kind: 'haptic', pattern: 'thud', intensity: 0.4 });
    t.outputs.length = 0;
    t.run.devices.gesture('flick', [1, 0, 0]);
    t.advance(20);
    await t.run.step();
    expect(t.outputs.some((o) => o.script === 'player' && o.output.kind === 'haptic' && o.output.pattern === 'tick')).toBe(true);
    expect(t.run.latencyMs).not.toBeNull();
  });

  it('a server frame reaches onRemote on scripted entities', async () => {
    const t = open();
    await t.run.load();
    await t.run.deliverRemote('damage', { hits: 1 });
    const haptics = t.outputs.filter((o) => o.output.kind === 'haptic');
    expect(haptics[0]?.output).toEqual({ kind: 'haptic', pattern: 'thud', intensity: expect.closeTo(0.6) });
  });
});

const url = process.env.OMNI_E2E_URL;

describe.skipIf(!url)('Run on server against a live backend', () => {
  it('signs in, publishes, joins /play and banish x3 gives round: won in the debug state', async () => {
    const client = new CloudClient({ baseUrl: url });
    await client.signIn({ provider: 'dev', subject: `e2e-${Date.now()}`, display_name: 'e2e' });
    const game = await client.createGame('E2E Hollow Choir');
    const version = await client.publish(game.id, new Project(templateSnapshot('flagship')).toVersion());
    expect(version.version).toBeGreaterThan(0);

    const store = new DebugStore();
    const debug = client.openDebug(game.id);
    debug.onMessage = (ev) => store.handleDebugEvent(ev);
    const play = client.openPlay(game.id, { version: version.version });
    const until = async (done: () => boolean, what: string) => {
      for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 50));
      if (!done()) throw new Error(`timed out waiting for ${what}`);
    };
    try {
      await until(() => play.status === 'open' && store.players.size === 1, 'join');
      for (const enemy of ['WraithLeft', 'WraithRight', 'WraithAhead']) play.send({ name: 'banish', data: { enemy } });
      await until(() => (store.state as { over?: boolean }).over === true, 'state.over');
      expect(store.server.some((r) => r.kind === 'out' && r.detail.startsWith('round') && r.detail.includes('"won"'))).toBe(true);
      expect(Object.keys((store.state as { banished: object }).banished)).toHaveLength(3);
    } finally {
      play.close();
      debug.close();
    }
  }, 15_000);
});
