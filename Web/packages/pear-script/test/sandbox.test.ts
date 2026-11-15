import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import enemySource from '../../../../Games/Flagship/scripts/enemy.js?raw';
import playerSource from '../../../../Games/Flagship/scripts/player.js?raw';
import prelude from '../../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js?raw';
import { ScriptRuntime, ScriptSandbox, rewriteExportDefault, type LogEntry, type WorkerLike } from '../src';

const ref = (name: string, position: [number, number, number] = [0, 0, 0]) => ({ id: name, name, position });

describe('rewriteExportDefault', () => {
  it('matches ScriptEngine.swift', () => {
    expect(rewriteExportDefault('export default script({});\n')).toBe('__pearExportDefault(script({}));');
    expect(rewriteExportDefault('// c\nexport default (function () {})();')).toBe('// c\n__pearExportDefault((function () {})());');
    expect(rewriteExportDefault('script({})')).toBe('script({})');
  });
});

describe('ScriptRuntime with Flagship scripts', () => {
  it('player.js: enter plays audio and haptic, remote maps to haptic', () => {
    const rt = new ScriptRuntime(prelude);
    rt.load('player', playerSource);
    const enter = rt.call({ script: 'player', entity: ref('Sanctuary'), handler: 'onTriggerEnter', args: ['head'] });
    expect(enter.error).toBeUndefined();
    expect(enter.outputs).toEqual([
      { kind: 'audio', entity: 'Sanctuary', action: 'play', sound: 'sanctuary_hum' },
      { kind: 'haptic', pattern: 'soft', intensity: 0.2 },
    ]);
    const hit = rt.call({ script: 'player', entity: ref('Sanctuary'), handler: 'onRemote', args: ['damage', { hits: 1 }] });
    expect(hit.outputs).toEqual([{ kind: 'haptic', pattern: 'thud', intensity: expect.closeTo(0.6) }]);
    expect(rt.call({ script: 'player', entity: ref('Sanctuary'), handler: 'onLookAt', args: [] }).outputs).toEqual([]);
  });

  it('enemy.js: lock on look, fire banish on flick, keep state per entity name', () => {
    const rt = new ScriptRuntime(prelude);
    rt.load('enemy', enemySource);
    const call = (entity: string, handler: string, args: unknown[] = [], intensity?: number) =>
      rt.call({ script: 'enemy', entity: ref(entity), handler, args, intensity });
    expect(call('WraithLeft', 'onGesture', [{ type: 'flick' }]).outputs).toEqual([]);
    expect(call('WraithLeft', 'onLookAt').outputs).toHaveLength(2);
    expect(call('WraithRight', 'onGesture', [{ type: 'flick' }]).outputs).toEqual([]);
    expect(call('WraithLeft', 'onGesture', [{ type: 'flick' }]).outputs).toEqual([
      { kind: 'remote', name: 'banish', data: { enemy: 'WraithLeft' } },
    ]);
    expect(call('WraithAhead', 'onTriggerEnter', ['head']).outputs).toEqual([
      { kind: 'remote', name: 'contact', data: { enemy: 'WraithAhead' } },
    ]);
    expect(call('WraithLeft', 'onHeartRate', [180], 1).error).toBeUndefined();
  });

  it('rejects an unknown handler with the prelude message, keeping the previous version', () => {
    const rt = new ScriptRuntime(prelude);
    rt.load('enemy', enemySource);
    expect(() => rt.load('enemy', 'export default script({ onJump() {} });')).toThrow("script: unknown handler 'onJump'");
    expect(() => rt.load('x', 'export default script({ onLookAt: 3 });')).toThrow("handler 'onLookAt' must be a function");
    expect(() => rt.load('x', 'script({});')).toThrow('no default export');
    expect(() => rt.load('x', 'export default script({')).toThrow(/SyntaxError/);
    expect(rt.loadedScriptNames).toEqual(['enemy']);
  });

  it('records a throwing handler and routes console output', () => {
    const rt = new ScriptRuntime(prelude);
    rt.load(
      't',
      'export default script({ onLookAt(self, ctx) { console.log("hi", 1, {a: 2}); console.warn("w"); ctx.haptic("tick", 1); throw new Error("boom"); } });',
    );
    const r = rt.call({ script: 't', entity: ref('E'), handler: 'onLookAt', args: [] });
    expect(r.error).toBe('t.onLookAt: Error: boom (line 1)');
    expect(r.outputs).toEqual([
      { kind: 'log', level: 'log', text: 'hi 1 {"a":2}' },
      { kind: 'log', level: 'warn', text: 'w' },
      { kind: 'haptic', pattern: 'tick', intensity: 1 },
    ]);
  });

  it('reports the script line of a runtime error', () => {
    const rt = new ScriptRuntime(prelude);
    rt.load('m', ['// header', 'export default script({', '  onLookAt() {', '    undefinedThing.go();', '  },', '});'].join('\n'));
    expect(rt.call({ script: 'm', entity: ref('E'), handler: 'onLookAt', args: [] }).error).toMatch(/is not defined \(line 4\)$/);
  });

  it('self.audio.speak, self.audio.play and self.calibrate become outputs; ctx has none', () => {
    const rt = new ScriptRuntime(prelude);
    rt.load(
      't',
      'export default script({ onGesture(self, ctx, g) { self.audio.speak("hands up " + g.t); self.audio.play("beep"); self.calibrate(); } });',
    );
    const r = rt.call({ script: 't', entity: ref('E'), handler: 'onGesture', args: [{ type: 'raise', t: 7 }] });
    expect(r.error).toBeUndefined();
    expect(r.outputs).toEqual([
      { kind: 'audio', entity: 'E', action: 'speak', text: 'hands up 7' },
      { kind: 'audio', entity: 'E', action: 'play', sound: 'beep' },
      { kind: 'calibrate' },
    ]);
  });

  it('exposes self.position and hides page globals', () => {
    const rt = new ScriptRuntime(prelude);
    rt.load(
      't',
      'export default script({ onLookAt(self, ctx) { ctx.remote.fire("p", { p: self.position, f: typeof fetch, n: self.name, s: self.speed }); } });',
    );
    const r = rt.call({ script: 't', entity: ref('E', [1, 2, 3]), handler: 'onLookAt', args: [] });
    expect(r.outputs).toEqual([{ kind: 'remote', name: 'p', data: { p: [1, 2, 3], f: 'undefined', n: 'E', s: 1 } }]);
  });
});

// A real worker thread running src/evaluate.ts, so the watchdog's terminate() is exercised for real.
class NodeWorkerLike implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  private worker = new Worker(new URL('./node-worker.ts', import.meta.url), { execArgv: ['--experimental-strip-types'] }); // Node < 22.18 does not strip TS types by default
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

describe('ScriptSandbox in a worker', () => {
  let sandbox: ScriptSandbox | undefined;
  afterEach(() => sandbox?.dispose());
  const logs: LogEntry[] = [];
  const make = () => (sandbox = new ScriptSandbox({ createWorker: () => new NodeWorkerLike(), prelude, onLog: (e) => logs.push(e) }));

  it('loads Flagship scripts and runs handlers', async () => {
    const s = make();
    await s.loadScript('player', playerSource);
    await s.loadScript('enemy', enemySource);
    const r = await s.call({ script: 'player', entity: ref('Sanctuary'), handler: 'onTriggerExit', args: ['head'] });
    expect(r).toEqual({ outputs: [{ kind: 'haptic', pattern: 'thud', intensity: 0.4 }] });
  });

  it('rejects an unknown handler with the prelude message', async () => {
    await expect(make().loadScript('bad', 'export default script({ onJump() {} });')).rejects.toThrow("unknown handler 'onJump'");
  });

  it('stops an infinite loop at 250 ms, reports it, and recovers with scripts reloaded', async () => {
    const s = make();
    await s.loadScript('player', playerSource);
    await s.loadScript('spin', 'export default script({ onLookAt() { while (true) {} } });');
    const started = Date.now();
    const r = await s.call({ script: 'spin', entity: ref('E'), handler: 'onLookAt', args: [] });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.error).toMatch(/spin\.onLookAt: exceeded 250 ms/);
    expect(s.errors).toHaveLength(1);
    expect(logs.at(-1)).toMatchObject({ level: 'error', script: 'spin' });
    const after = await s.call({ script: 'player', entity: ref('Sanctuary'), handler: 'onTriggerEnter', args: ['head'] });
    expect(after.error).toBeUndefined();
    expect(after.outputs).toHaveLength(2);
  }, 10_000);
});

describe('ctx.player, ctx.position and onTick', () => {
  const src = `export default script({
    onTick(self, ctx, dt) { ctx.remote.fire("tick", { id: ctx.player.id, pos: ctx.position, dt }); },
  });`;
  it('exposes the player id and position, null when absent', () => {
    const rt = new ScriptRuntime(prelude);
    rt.load('t', src);
    const withIds = rt.call({ script: 't', entity: ref('E'), handler: 'onTick', args: [0.2], playerId: 'p1', position: [1, 2, 3] });
    expect(withIds.outputs).toEqual([{ kind: 'remote', name: 'tick', data: { id: 'p1', pos: [1, 2, 3], dt: 0.2 } }]);
    const without = rt.call({ script: 't', entity: ref('E'), handler: 'onTick', args: [0.2] });
    expect(without.outputs).toEqual([{ kind: 'remote', name: 'tick', data: { id: null, pos: null, dt: 0.2 } }]);
  });
});
