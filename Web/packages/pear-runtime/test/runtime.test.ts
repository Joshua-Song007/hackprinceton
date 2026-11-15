import { describe, expect, it } from 'vitest';
import { quat, type Quat, type Vec3 } from '@pear/core';
import flagship from '../../../../Games/Flagship/scene.json';
import { InputBus, SceneEvents, flattenScene, parseScene, parseInputs, parsePeripherals, SceneError, STALE_AFTER_MS } from '../src';

const scene = parseScene(flagship);

function headPacket(over: { position?: Vec3; orientation?: Quat; t?: number; source?: string } = {}) {
  const { position, orientation = [0, 0, 0, 1], t = 0, source = 'sim' } = over;
  return {
    v: 1, deviceId: 'airpods-1', kind: 'airpods', slot: 'head', source, t, seq: t,
    ch: { orientation, ...(position ? { position } : {}) },
  };
}

/** Feeds one head pose through InputBus -> SceneEvents for `dtMs`, as the run loop does. */
function makeRig() {
  const bus = new InputBus();
  const events = new SceneEvents(scene);
  let now = 1000;
  return {
    step(packet: unknown, dtMs = 20) {
      now += dtMs;
      bus.ingest(packet, now);
      return events.step(bus.frame(now), dtMs);
    },
  };
}

describe('scene.ts', () => {
  it('loads Games/Flagship/scene.json', () => {
    expect(scene.name).toBe('Hollow Choir');
    expect(scene.requiredTier).toBe(1); // lowered in 43b5dd1: heart rate only scales aggression
    expect(scene.runMode).toBe('screen');
    expect(scene.clientScripts).toEqual(['enemy', 'player']);
    expect(scene.serverScripts).toEqual(['game']);
    expect(scene.playerOrigin).toEqual([0, 1.6, 0]);
    const world = flattenScene(scene);
    expect(world.map((e) => e.id)).toEqual([
      'Crypt', 'Crypt/Floor', 'Crypt/Ceiling', 'Crypt/Brazier', 'Crypt/DripCistern',
      'Sanctuary', 'WraithLeft', 'WraithRight', 'WraithAhead',
    ]);
    expect(world.find((e) => e.id === 'Crypt/Floor')!.position).toEqual([0, 0, -6]);
    const sanctuary = scene.entities.find((e) => e.name === 'Sanctuary')!;
    expect(sanctuary.components[0]).toEqual({ type: 'trigger', shape: 'sphere', radius: 1.2, probeSlots: ['head'] });
    expect(sanctuary.rotation).toEqual([0, 0, 0, 1]);
    expect(sanctuary.scale).toEqual([1, 1, 1]);
  });

  it('applies defaults and composes parent transforms', () => {
    const s = parseScene({ entities: [{ name: 'A', position: [1, 0, 0], scale: [2, 2, 2], children: [{ name: 'B', position: [1, 0, 0] }] }] });
    expect(s.requiredTier).toBe(1);
    expect(s.runMode).toBe('screen');
    expect(flattenScene(s)[1]).toMatchObject({ id: 'A/B', position: [3, 0, 0], scale: [2, 2, 2] });
  });

  it('rejects what SceneLoader rejects', () => {
    const entity = (component: unknown) => ({ entities: [{ name: 'x', components: [component] }] });
    expect(() => parseScene({ requiredTier: 4 })).toThrow('requiredTier must be 1...3, got 4');
    expect(() => parseScene({ requiredTier: 0 })).toThrow(SceneError);
    expect(() => parseScene({ runMode: 'vr' })).toThrow('runMode');
    expect(() => parseScene(entity({ type: 'physics' }))).toThrow("unknown component type 'physics'");
    expect(() => parseScene(entity({ type: 'trigger', shape: 'cone' }))).toThrow("unknown trigger shape 'cone'");
    expect(() => parseScene(entity({ type: 'trigger', shape: 'sphere', radius: 0 }))).toThrow('sphere radius must be > 0');
    expect(() => parseScene(entity({ type: 'trigger', shape: 'box', size: [1, 0, 1] }))).toThrow('box size must be > 0');
    expect(() => parseScene(entity({ type: 'script' }))).toThrow('name: expected string');
    expect(() => parseScene(entity({ type: 'trigger', shape: 'sphere', radius: 1, probeSlots: ['foot'] }))).toThrow('unknown slot');
    expect(() => parseScene([])).toThrow('expected object');
  });
});

describe('input.ts', () => {
  it('strips source, holds channels per slot, delivers gestures once and goes stale after 500 ms', () => {
    const bus = new InputBus();
    expect(bus.ingest(headPacket({ position: [0, 1, 0] }), 0)).toBe(true);
    bus.ingest({ ...headPacket(), ch: { gesture: { type: 'tap' } } }, 10);
    const first = bus.frame(20);
    expect(first.devices).toHaveLength(1);
    expect(first.devices[0]).not.toHaveProperty('source');
    expect(first.devices[0]).toMatchObject({ slot: 'head', position: [0, 1, 0], gestures: [{ type: 'tap' }], stale: false });
    expect(bus.frame(30).devices[0]!.gestures).toEqual([]);
    expect(bus.frame(10 + STALE_AFTER_MS).devices[0]!.stale).toBe(false);
    expect(bus.frame(11 + STALE_AFTER_MS).devices[0]!.stale).toBe(true);
  });

  it('drops invalid packets and counts them', () => {
    const bus = new InputBus();
    expect(bus.ingest({ ...headPacket(), slot: 'foot' }, 0)).toBe(false);
    expect(bus.dropped).toBe(1);
    expect(bus.frame(1).devices).toEqual([]);
  });
});

describe('events.ts', () => {
  it('fires trigger enter and exit from scripted head poses', () => {
    const rig = makeRig();
    expect(rig.step(headPacket({ position: [0, 1.6, 5] }))).toEqual([]);
    expect(rig.step(headPacket({ position: [0, 1.6, 0.5] }))).toEqual([
      { handler: 'onTriggerEnter', entity: 'Sanctuary', args: ['head'] },
    ]);
    expect(rig.step(headPacket({ position: [0, 1.6, 0.6] }))).toEqual([]);
    expect(rig.step(headPacket({ position: [0, 1.6, 3] }))).toEqual([
      { handler: 'onTriggerExit', entity: 'Sanctuary', args: ['head'] },
    ]);
    // Box trigger on WraithAhead (3 local units, scaled 1.2 x 2.2 x 1.2).
    const enter = rig.step(headPacket({ position: [0, 1.9, -8] }));
    expect(enter).toEqual([{ handler: 'onTriggerEnter', entity: 'WraithAhead', args: ['head'] }]);
  });

  it('uses playerOrigin when the head has no position', () => {
    const rig = makeRig();
    expect(rig.step(headPacket()).map((e) => e.handler)).toContain('onTriggerEnter');
  });

  it('fires lookAt once after the dwell, and again after looking away', () => {
    const rig = makeRig();
    const ahead = headPacket({ position: [0, 1.6, 0] });
    expect(rig.step(ahead, 400).filter((e) => e.handler === 'onLookAt')).toEqual([]);
    expect(rig.step(ahead, 200).filter((e) => e.handler === 'onLookAt')).toEqual([
      { handler: 'onLookAt', entity: 'WraithAhead', args: [] },
    ]);
    expect(rig.step(ahead, 600).filter((e) => e.handler === 'onLookAt')).toEqual([]);
    const away = headPacket({ position: [0, 1.6, 0], orientation: quat.fromYawPitch(Math.PI / 2, 0) });
    rig.step(away, 100);
    expect(rig.step(ahead, 400).filter((e) => e.handler === 'onLookAt')).toEqual([]);
    expect(rig.step(ahead, 200).filter((e) => e.handler === 'onLookAt')).toHaveLength(1);
  });

  it('looks at WraithLeft when yawed toward it, not at others', () => {
    const rig = makeRig();
    // Head at origin height 1.6 -> WraithLeft at (-3.5, 1.5, -6): yaw left by atan(3.5/6).
    const yaw = Math.atan2(3.5, 6);
    const look = headPacket({ position: [0, 1.6, 0], orientation: quat.fromYawPitch(yaw, 0) });
    const looks = rig.step(look, 600).filter((e) => e.handler === 'onLookAt');
    expect(looks).toEqual([{ handler: 'onLookAt', entity: 'WraithLeft', args: [] }]);
  });

  it('delivers gestures once and heart rate on change with intensity', () => {
    const rig = makeRig();
    const phone = { v: 1, deviceId: 'p', kind: 'phone', slot: 'hand', source: 'sim', t: 0, seq: 0, ch: { gesture: { type: 'flick', dir: [1, 0, 0] } } };
    expect(rig.step(phone).filter((e) => e.handler === 'onGesture')).toEqual([
      { handler: 'onGesture', args: [{ type: 'flick', dir: [1, 0, 0] }] },
    ]);
    expect(rig.step({ ...phone, ch: {} }).filter((e) => e.handler === 'onGesture')).toEqual([]);
    const watch = (bpm: number) => ({ v: 1, deviceId: 'w', kind: 'watch', slot: 'leftWrist', source: 'sim', t: 0, seq: 0, ch: { heartRate: bpm } });
    expect(rig.step(watch(120))).toEqual([{ handler: 'onHeartRate', args: [120], intensity: 0.5 }]);
    expect(rig.step(watch(120))).toEqual([]);
    expect(rig.step(watch(300))[0]).toMatchObject({ intensity: 1 });
  });
});

describe('parseInputs', () => {
  it('defaults an empty block', () => {
    expect(parseInputs({})).toEqual({ head: false, position: false, heartRate: false, gestures: [], players: [1, 32] });
  });
  it('keeps declared values and dedupes gestures', () => {
    expect(parseInputs({ head: true, gestures: ['tap', 'tap', 'flick'], players: [2, 4] })).toMatchObject({ head: true, gestures: ['tap', 'flick'], players: [2, 4] });
  });
  it('rejects an unknown gesture', () => {
    expect(() => parseInputs({ gestures: ['wave'] })).toThrow(/unknown gesture 'wave'/);
  });
  it('rejects bad players', () => {
    for (const players of [[0, 4], [3, 2], [1, 33], [1.5, 2], [1], 'x']) expect(() => parseInputs({ players })).toThrow(SceneError);
  });
  it('rejects a non-object', () => {
    expect(() => parseInputs(null)).toThrow(SceneError);
  });
});

describe('parsePeripherals', () => {
  it('defaults to none', () => {
    expect(parsePeripherals(undefined)).toEqual([]);
    expect(parsePeripherals(null)).toEqual([]);
    expect(parseScene({}).peripherals).toEqual([]);
  });
  it('keeps order and drops repeats', () => {
    expect(parsePeripherals(['watch', 'phone', 'watch'])).toEqual(['watch', 'phone']);
    expect(parseScene({ peripherals: ['airpods'] }).peripherals).toEqual(['airpods']);
  });
  it('rejects an unknown device and a non-list', () => {
    expect(() => parsePeripherals(['tablet'])).toThrow("peripherals[0]: unknown peripheral 'tablet'");
    expect(() => parsePeripherals('phone')).toThrow('peripherals: expected array');
    expect(() => parseScene({ peripherals: [1] })).toThrow(SceneError);
  });
});
