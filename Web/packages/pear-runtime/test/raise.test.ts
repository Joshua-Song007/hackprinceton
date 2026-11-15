import { describe, expect, it } from 'vitest';
import { quat, type Quat } from '@pear/core';
import { InputBus, SceneEvents, parseScene, SceneError } from '../src';

const pitch = (deg: number): Quat => quat.fromAxisAngle([1, 0, 0], (deg * Math.PI) / 180);
const yaw = (deg: number): Quat => quat.fromAxisAngle([0, 1, 0], (deg * Math.PI) / 180);

/** A phone orientation stream: `pose(q, t)` ingests one packet and returns the gestures the frame carried. */
function rig(raise = { angleDeg: 80, hysteresisDeg: 10 }) {
  const bus = new InputBus({ raise });
  return {
    bus,
    pose(orientation: Quat, t: number, deviceId = 'phone-1') {
      bus.ingest({ v: 1, deviceId, kind: 'phone', slot: 'hand', source: 'sim', t, seq: t, ch: { orientation } }, t);
      return bus.frame(t).devices.find((d) => d.deviceId === deviceId)!.gestures;
    },
  };
}

describe('raise gesture', () => {
  it('flat then pitched 85 degrees raises once, with the packet time', () => {
    const r = rig();
    expect(r.pose(pitch(0), 100)).toEqual([]);
    expect(r.pose(pitch(40), 120)).toEqual([]);
    expect(r.pose(pitch(85), 140)).toEqual([{ type: 'raise', t: 140 }]);
    expect(r.pose(pitch(88), 160)).toEqual([]);
  });

  it('jitter inside the hysteresis band makes no extra events; below angle - hysteresis lowers', () => {
    const r = rig();
    r.pose(pitch(0), 0);
    expect(r.pose(pitch(81), 20)).toEqual([{ type: 'raise', t: 20 }]);
    for (const [i, deg] of [79, 82, 75, 71.5, 80, 78].entries()) expect(r.pose(pitch(deg), 40 + i * 20)).toEqual([]);
    expect(r.pose(pitch(69), 300)).toEqual([{ type: 'lower', t: 300 }]);
    expect(r.pose(pitch(75), 320)).toEqual([]); // below 80 and re-armed: needs 80 again
    expect(r.pose(pitch(80), 340)).toEqual([{ type: 'raise', t: 340 }]);
  });

  it('calibrate moves the rest pose', () => {
    const r = rig();
    r.pose(pitch(0), 0);
    expect(r.pose(pitch(60), 20)).toEqual([]);
    r.bus.calibrate();
    expect(r.pose(pitch(120), 40)).toEqual([]); // 120 from the first rest, 60 from the calibrated one
    expect(r.pose(pitch(145), 60)).toEqual([{ type: 'raise', t: 60 }]);
  });

  it('calibrate before any packet leaves the first packet as the rest pose', () => {
    const r = rig();
    r.bus.calibrate();
    expect(r.pose(pitch(60), 0)).toEqual([]);
    expect(r.pose(pitch(145), 20)).toEqual([{ type: 'raise', t: 20 }]);
  });

  it('turning in place (any yaw) does not raise', () => {
    const r = rig();
    r.pose(pitch(0), 0);
    for (const [i, deg] of [45, 90, 135, 180, -120].entries()) expect(r.pose(quat.mul(yaw(deg), pitch(0)), 20 + i * 20)).toEqual([]);
    expect(r.pose(quat.mul(yaw(90), pitch(85)), 200)).toEqual([{ type: 'raise', t: 200 }]);
  });

  it('is off without scene.gestures.raise, and devices are tracked separately', () => {
    const off = new InputBus();
    off.ingest({ v: 1, deviceId: 'a', kind: 'phone', slot: 'hand', source: 'sim', t: 0, seq: 0, ch: { orientation: pitch(0) } }, 0);
    off.ingest({ v: 1, deviceId: 'a', kind: 'phone', slot: 'hand', source: 'sim', t: 1, seq: 1, ch: { orientation: pitch(90) } }, 1);
    expect(off.frame(1).devices[0]!.gestures).toEqual([]);
    const r = rig();
    r.pose(pitch(0), 0, 'p1');
    expect(r.pose(pitch(90), 10, 'p1')).toEqual([{ type: 'raise', t: 10 }]);
    expect(r.bus.frame(10).devices).toHaveLength(1);
  });

  it('reaches onGesture args as { type, t } through SceneEvents', () => {
    const scene = parseScene({ name: 'x', gestures: { raise: {} } });
    expect(scene.raise).toEqual({ angleDeg: 80, hysteresisDeg: 10 });
    const bus = new InputBus({ raise: scene.raise });
    const events = new SceneEvents(scene);
    const send = (q: Quat, t: number) => {
      bus.ingest({ v: 1, deviceId: 'p', kind: 'phone', slot: 'hand', source: 'live', t, seq: t, ch: { orientation: q } }, t);
      return events.step(bus.frame(t), 20);
    };
    send(pitch(0), 5);
    expect(send(pitch(90), 25)).toEqual([{ handler: 'onGesture', args: [{ type: 'raise', t: 25 }] }]);
    expect(send(pitch(0), 45)).toEqual([{ handler: 'onGesture', args: [{ type: 'lower', t: 45 }] }]);
  });
});

describe('scene gestures.raise', () => {
  it('has defaults, is not a motion gesture, and is validated', () => {
    expect(parseScene({ gestures: { raise: { angleDeg: 60, hysteresisDeg: 5 } } })).toMatchObject({ raise: { angleDeg: 60, hysteresisDeg: 5 }, gestures: {} });
    expect(parseScene({}).raise).toBeUndefined();
    expect(() => parseScene({ gestures: { raise: { angleDeg: 0 } } })).toThrow(SceneError);
    expect(() => parseScene({ gestures: { raise: { angleDeg: 40, hysteresisDeg: 40 } } })).toThrow(SceneError);
  });
});
