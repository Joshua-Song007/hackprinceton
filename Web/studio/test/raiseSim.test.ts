import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseScene } from '@pear/runtime';
import type { CallResult, HandlerCall, ScriptSandbox } from '@pear/script';
import { rigFor } from '../src/needs';
import { LocalRun } from '../src/run';

const setup = (scene = parseScene({ gestures: { raise: {} }, entities: [{ name: 'E', components: [{ type: 'script', name: 's' }] }] })) => {
  const calls: HandlerCall[] = [];
  const sandbox = { loadScript: async () => {}, call: async (c: HandlerCall): Promise<CallResult> => (calls.push(c), { outputs: [] }), dispose: () => {} } as unknown as ScriptSandbox;
  let now = 0;
  const run = new LocalRun({ scene, clientScripts: {}, sandbox, now: () => now });
  const tick = async (ms = 20) => { now += ms; await run.step(); };
  const gestures = () => calls.filter((c) => c.handler === 'onGesture').map((c) => (c.args[0] as { type: string }).type);
  return { run, calls, tick, gestures };
};

describe('simulated raise', () => {
  it('raisePhone crosses the threshold (raise) and back (lower) through the InputBus', async () => {
    const { run, tick, gestures } = setup();
    await tick();
    expect(run.raisePhone()).toBe(true);
    await tick();
    expect(gestures()).toEqual(['raise']);
    expect(run.phoneUp).toBe(true);
    expect(run.raisePhone()).toBe(false);
    await tick();
    expect(gestures()).toEqual(['raise', 'lower']);
    expect(run.raisePhone(false)).toBe(false); // explicit set: no change, no gesture
    await tick();
    expect(gestures()).toEqual(['raise', 'lower']);
  });

  it('does nothing without a phone in the rig', () => {
    const { run } = setup();
    run.devices.removeDevice('phone');
    expect(run.raisePhone()).toBeNull();
  });

  it('a scene with gestures.raise gets a simulated phone', () => {
    expect(rigFor(null, {}, [], true)).toEqual(['phone']);
    expect(rigFor(null, {}, [], false)).toEqual([]);
  });
});

describe('referee role', () => {
  it('reaches client scripts as the handler call role, "player" by default', async () => {
    const { run, calls, tick } = setup();
    await tick(250);
    expect(calls.at(-1)!.role).toBe('player');
    run.role = 'ref';
    await tick(250);
    expect(calls.at(-1)!.role).toBe('ref');
  });
});

describe('relay PEAR_RELAY_HOST', () => {
  const listening = (host?: string) => new Promise<string>((resolve, reject) => {
    const env = { ...process.env, PEAR_RELAY_PORT: '17777', PEAR_RELAY_WS_PORT: '18787', ...(host ? { PEAR_RELAY_HOST: host } : { PEAR_RELAY_HOST: '' }) };
    const child = spawn(process.execPath, ['scripts/relay.mjs'], { env, cwd: new URL('..', import.meta.url) });
    const timer = setTimeout(() => (child.kill(), reject(new Error('relay did not start'))), 8000);
    child.stdout.on('data', (d) => { const m = /Studio on (ws:\/\/\S+)/.exec(String(d)); if (m) (clearTimeout(timer), child.kill(), resolve(m[1]!)); });
    child.on('error', reject);
  });
  it('binds 127.0.0.1 by default and the given host when set', async () => {
    expect(await listening()).toBe('ws://127.0.0.1:18787');
    expect(await listening('0.0.0.0')).toBe('ws://0.0.0.0:18787');
  }, 20000);
});
