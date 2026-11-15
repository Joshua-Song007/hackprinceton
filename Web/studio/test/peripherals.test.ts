import { Worker } from 'node:worker_threads';
import { afterAll, describe, expect, it } from 'vitest';
import { GESTURE_TYPES } from '@pear/core';
import { PERIPHERAL_KINDS, type CustomGesture, type SceneInputs } from '@pear/runtime';
import { ScriptSandbox, type WorkerLike } from '@pear/script';
import { inferInputs, rigFor } from '../src/needs';
import {
  COMING_SOON, PERIPHERALS, addPeripheral, deviceOfSignal, devicesOf, handlerStub, missingSignals, removePeripheral, scriptNameFor,
  placeDevice, readPeripheralState, seedInputs, setOwnership, setSignal, signalOn, toggleSignal, type PeripheralState, type SignalId,
} from '../src/peripherals';

// A real worker thread running the sandbox evaluator (same adapter shape as e2e.test.ts).
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

const none: SceneInputs = { head: false, position: false, heartRate: false, gestures: [], players: [1, 32] };
const empty: PeripheralState = { peripherals: [], ownership: {}, inputs: null, gestures: {} };
const swing: CustomGesture = { slot: 'rightWrist', axis: [0, 0, -1], threshold: 20, cooldownMs: 400 };
const ALL: SignalId[] = ['head', 'position', 'heartRate', ...GESTURE_TYPES];

describe('catalog', () => {
  it('covers every peripheral kind, and each signal belongs to the device that lists it', () => {
    expect(Object.keys(PERIPHERALS).sort()).toEqual([...PERIPHERAL_KINDS].sort());
    for (const kind of PERIPHERAL_KINDS) for (const s of PERIPHERALS[kind].signals) expect(deviceOfSignal(s.id)).toBe(kind);
  });
  it('lists every signal exactly once', () => {
    const ids = PERIPHERAL_KINDS.flatMap((k) => PERIPHERALS[k].signals.map((s) => s.id));
    expect([...ids].sort()).toEqual([...ALL].sort());
  });
  it('shows the iPad as coming soon, not as an addable kind', () => {
    expect(COMING_SOON.map((d) => d.label)).toEqual(['iPad']);
    expect(PERIPHERAL_KINDS).not.toContain('tablet');
  });
});

describe('signals', () => {
  it('turn on and off, starting from no inputs', () => {
    expect(signalOn(null, 'head')).toBe(false);
    const on = setSignal(null, 'heartRate', true);
    expect(on).toEqual({ ...none, heartRate: true });
    expect(signalOn(on, 'heartRate')).toBe(true);
    const tap = setSignal(on, 'tap', true);
    expect(tap.gestures).toEqual(['tap']);
    expect(setSignal(tap, 'tap', false).gestures).toEqual([]);
  });
  it('keep gesture order stable', () => {
    const i = setSignal(setSignal(null, 'pinch', true), 'tap', true);
    expect(i.gestures).toEqual(['tap', 'pinch']);
  });
  it('toggling lists the device, so unticking its last signal keeps its card', () => {
    const on = toggleSignal(empty, 'tap', true);
    expect(on.peripherals).toEqual(['phone']);
    const off = toggleSignal(on, 'tap', false);
    expect(off.peripherals).toEqual(['phone']);
    expect(devicesOf(off)).toEqual(['phone']);
  });
});

describe('devices', () => {
  it('are the listed ones plus those the signals and motion gestures imply, in catalog order', () => {
    expect(devicesOf(empty)).toEqual([]);
    expect(devicesOf({ peripherals: ['airpods'], ownership: {}, inputs: setSignal(null, 'heartRate', true), gestures: {} })).toEqual(['watch', 'airpods']);
    expect(devicesOf({ peripherals: [], ownership: {}, inputs: null, gestures: { swing } })).toEqual(['watch']);
  });
  it('add with the default signal on, once', () => {
    const phone = addPeripheral(empty, 'phone');
    expect(phone.peripherals).toEqual(['phone']);
    expect(phone.inputs).toMatchObject({ gestures: ['tap'] });
    expect(addPeripheral(phone, 'phone')).toBe(phone);
    expect(addPeripheral(empty, 'watch').inputs).toMatchObject({ heartRate: true });
    expect(addPeripheral(empty, 'airpods').inputs).toMatchObject({ head: true });
  });
  it('are not added again when a signal already implies them', () => {
    const implied: PeripheralState = { peripherals: [], ownership: {}, inputs: setSignal(null, 'flick', true), gestures: {} };
    expect(addPeripheral(implied, 'phone')).toBe(implied);
  });
  it('remove their signals and their motion gestures, and leave the others', () => {
    let s = addPeripheral(addPeripheral(addPeripheral(empty, 'phone'), 'watch'), 'airpods');
    s = { ...s, gestures: { swing, nod: { ...swing, slot: 'head' } } };
    const gone = removePeripheral(s, 'watch');
    expect(gone.peripherals).toEqual(['phone', 'airpods']);
    expect(gone.inputs).toMatchObject({ heartRate: false, head: true, gestures: ['tap'] });
    expect(Object.keys(gone.gestures)).toEqual(['nod']);
    expect(devicesOf(gone)).toEqual(['phone', 'airpods']);
  });
  it('remove from a game that lists them without declared inputs', () => {
    const gone = removePeripheral({ peripherals: ['phone'], ownership: {}, inputs: null, gestures: {} }, 'phone');
    expect(gone).toEqual({ peripherals: [], ownership: {}, inputs: null, gestures: {} });
  });
  it('remove their own ownership entry and keep the other devices\'', () => {
    const held: PeripheralState = { ...empty, peripherals: ['phone', 'watch'], ownership: { phone: { mode: 'free', at: [0, 1, -2] }, watch: { mode: 'passed' } } };
    expect(removePeripheral(held, 'phone').ownership).toEqual({ watch: { mode: 'passed' } });
  });
  it('seed the first declaration from what the scripts already use', () => {
    const used = seedInputs(empty, { a: 'export default script({ onHeartRate(self, ctx, bpm) {} });' });
    expect(used.inputs).toMatchObject({ heartRate: true });
    const declared: PeripheralState = { ...empty, inputs: none };
    expect(seedInputs(declared, { a: 'onHeartRate' })).toBe(declared);
  });
  it('decide the simulated rig along with the inputs', () => {
    expect(rigFor(null, {}, ['watch'])).toEqual(['watch']);
    expect(rigFor({ ...none, head: true }, {}, ['phone'])).toEqual(['airpods', 'phone']);
    expect(rigFor(null, {}, [])).toEqual([]);
  });
});

describe('missing signals', () => {
  it('are what the scripts use and the inputs leave off', () => {
    const used: SceneInputs = { ...none, head: true, heartRate: true, gestures: ['tap'] };
    expect(missingSignals({ ...none, head: true }, used)).toEqual(['heartRate', 'tap']);
    expect(missingSignals(used, used)).toEqual([]);
  });
});

describe('handler scripts', () => {
  it('every signal gets a stub that reads as used', () => {
    for (const id of ALL) expect(signalOn(inferInputs({ x: handlerStub(id) }), id), id).toBe(true);
  });
  it('names stay free of clashes', () => {
    expect(scriptNameFor('heartRate', [])).toBe('heartRate');
    expect(scriptNameFor('heartRate', ['heartRate'])).toBe('heartRate2');
    expect(scriptNameFor('heartRate', ['heartRate', 'heartRate2'])).toBe('heartRate3');
    expect(scriptNameFor('head', [])).toBe('lookAt');
  });

  const sandbox = new ScriptSandbox({ createWorker: () => new NodeWorkerLike() });
  afterAll(() => sandbox.dispose());
  it('every stub loads in the real sandbox', async () => {
    for (const id of ALL) await expect(sandbox.loadScript(`stub-${id}`, handlerStub(id)), id).resolves.toBeUndefined();
  });
});

describe('readPeripheralState', () => {
  it('reads the three device fields of a scene', () => {
    const s = readPeripheralState({ peripherals: ['watch'], inputs: { head: true, gestures: ['tap'], players: [1, 4] }, gestures: { swing } });
    expect(s.peripherals).toEqual(['watch']);
    expect(s.inputs).toMatchObject({ head: true, gestures: ['tap'], players: [1, 4] });
    expect(Object.keys(s.gestures)).toEqual(['swing']);
  });
  it('counts a missing or invalid field as empty', () => {
    expect(readPeripheralState({})).toEqual({ peripherals: [], ownership: {}, inputs: null, gestures: {} });
    expect(readPeripheralState({ peripherals: ['tablet'], ownership: { phone: { mode: 'sideways' } }, inputs: { gestures: ['wave'] }, gestures: { 'bad name': {} } })).toEqual({ peripherals: [], ownership: {}, inputs: null, gestures: {} });
  });
  it('reads ownership', () => {
    expect(readPeripheralState({ ownership: { phone: { mode: 'free' }, watch: { mode: 'passed' } } }).ownership).toEqual({ phone: { mode: 'free', at: [0, 1, -2] }, watch: { mode: 'passed' } });
  });
});

describe('ownership', () => {
  it('free puts the device at the default spot, passed has no position, player clears the entry', () => {
    const free = setOwnership(empty, 'phone', 'free');
    expect(free.ownership.phone).toEqual({ mode: 'free', at: [0, 1, -2] });
    expect(setOwnership(free, 'phone', 'passed').ownership.phone).toEqual({ mode: 'passed' });
    expect(setOwnership(free, 'phone', 'player').ownership).toEqual({});
  });
  it('keeps where a free device was put when it is set to free again', () => {
    const moved = placeDevice(setOwnership(empty, 'watch', 'free'), 'watch', [3, 1, 4]);
    expect(setOwnership(moved, 'watch', 'free').ownership.watch).toEqual({ mode: 'free', at: [3, 1, 4] });
  });
  it('refuses a mode the device cannot have, and placing a device that is not free', () => {
    expect(setOwnership(empty, 'airpods', 'free')).toBe(empty);
    expect(setOwnership(empty, 'airpods', 'passed').ownership.airpods).toEqual({ mode: 'passed' });
    expect(placeDevice(empty, 'phone', [1, 1, 1])).toBe(empty);
  });
  it('the catalog allows free for the phone and the watch only', () => {
    expect(PERIPHERAL_KINDS.filter((k) => PERIPHERALS[k].ownership.includes('free'))).toEqual(['phone', 'watch']);
  });
});
