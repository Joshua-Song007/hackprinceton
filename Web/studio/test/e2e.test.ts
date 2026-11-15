// Headless end-to-end: Quick Draw -> Run local (sim devices -> InputBus -> events -> sandbox worker) -> player.js runs.
// The server part runs only against a live backend (PEAR_E2E_URL=http://localhost:8080, backend started with PEAR_DEV_SIGNIN=1).
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { CloudClient } from '@pear/cloud';
import { ScriptSandbox, type WorkerLike } from '@pear/script';
import { DebugStore } from '../src/debug-panel';
import { Project } from '../src/project';
import { gameSnapshot } from './games';
import { LocalRun, type EffectOutput } from '../src/run';

// A real worker thread running the sandbox evaluator (same adapter shape as packages/pear-script/test).
class NodeWorkerLike implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  private worker = new Worker(new URL('../../packages/pear-script/test/node-worker.ts', import.meta.url), { execArgv: ['--experimental-strip-types'] }); // Node < 22.18 does not strip TS types by default
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

describe('Run local against Games/QuickDraw', () => {
  let run: LocalRun | undefined;
  afterEach(() => run?.stop());

  function open() {
    const project = new Project(gameSnapshot('QuickDraw'));
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

  it('loads the Quick Draw client scripts without errors', async () => {
    const t = open();
    await t.run.load();
    expect(t.loadErrors).toEqual([]);
  });
});

const url = process.env.PEAR_E2E_URL;

describe.skipIf(!url)('Run on server against a live backend', () => {
  it('signs in, publishes and joins /play; the debug state starts in the lobby', async () => {
    const client = new CloudClient({ baseUrl: url });
    await client.signIn({ provider: 'dev', subject: `sim-e2e-${Date.now()}`, display_name: 'e2e' });
    const game = await client.createGame('E2E Quick Draw');
    const version = await client.publish(game.id, new Project(gameSnapshot('QuickDraw')).toVersion());
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
      await until(() => (store.state as { phase?: string }).phase === 'lobby', 'lobby state');
    } finally {
      play.close();
      debug.close();
    }
  }, 15_000);
});
