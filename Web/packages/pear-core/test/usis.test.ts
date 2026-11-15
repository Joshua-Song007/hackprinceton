import { describe, expect, it } from 'vitest';
import schema from '../../../../Schema/usis.schema.json';
import demo from '../../../../Recordings/demo-fallback.usis.jsonl?raw';
import {
  DEVICE_KINDS, GESTURE_TYPES, QUATERNION_TOLERANCE, SLOTS, SOURCES, TOUCH_PHASES, quat, validateUsis, vec3,
} from '../src';

const base = { v: 1, deviceId: 'd', kind: 'phone', slot: 'hand', source: 'sim', t: 0, seq: 0 };
const withCh = (ch: unknown) => ({ ...base, ch });
const bad = (packet: unknown, fragment: string) => {
  const r = validateUsis(packet);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors.join('\n')).toContain(fragment);
};

describe('usis.ts matches Schema/usis.schema.json', () => {
  const p = schema.properties;
  it('enums and required fields', () => {
    expect(schema.required).toEqual(['v', 'deviceId', 'kind', 'slot', 'source', 't', 'seq']);
    expect(p.kind.enum).toEqual([...DEVICE_KINDS]);
    expect(p.slot.enum).toEqual([...SLOTS]);
    expect(p.source.enum).toEqual([...SOURCES]);
    expect(p.v.const).toBe(1);
    expect(p.ch.properties.gesture.properties.type.enum).toEqual([...GESTURE_TYPES]);
    expect(p.ch.properties.touch.items.properties.phase.enum).toEqual([...TOUCH_PHASES]);
    expect(p.ch.properties.pencil.required).toEqual(['tip', 'pressure', 'roll', 'hover']);
    expect(QUATERNION_TOLERANCE).toBe(0.01);
  });
});

describe('validateUsis', () => {
  it('accepts every packet of the demo fallback recording', () => {
    const lines = demo.split('\n').filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(100);
    for (const line of lines) expect(validateUsis(JSON.parse(line)).ok).toBe(true);
  });

  it('accepts a packet without ch, unknown channels and every channel kind', () => {
    expect(validateUsis(base).ok).toBe(true);
    expect(validateUsis(withCh({ future: { a: 1 } })).ok).toBe(true);
    expect(
      validateUsis(
        withCh({
          orientation: [0, 0, 0, 1], position: [1, 2, 3], accel: [0, -9.8, 0],
          touch: [{ id: 1, x: 0, y: 1, phase: 'began' }],
          gesture: { type: 'flick', dir: [1, 0, 0] }, heartRate: 0,
          pencil: { tip: [0, 0, 0], pressure: 1, roll: 0, hover: 0.1 },
        }),
      ).ok,
    ).toBe(true);
  });

  it('rejects non-objects and each missing required field', () => {
    bad(null, 'expected object');
    bad([], 'expected object');
    for (const key of schema.required) {
      const { [key]: _omitted, ...rest } = base as Record<string, unknown>;
      bad(rest, key);
    }
  });

  it('rejects each top-level rule', () => {
    bad({ ...base, v: 2 }, 'v:');
    bad({ ...base, deviceId: '' }, 'deviceId');
    bad({ ...base, deviceId: 'x'.repeat(129) }, 'deviceId');
    bad({ ...base, kind: 'toaster' }, 'kind');
    bad({ ...base, slot: 'foot' }, 'slot');
    bad({ ...base, source: 'cloud' }, 'source');
    bad({ ...base, t: -1 }, 't:');
    bad({ ...base, t: 1.5 }, 't:');
    bad({ ...base, seq: -1 }, 'seq');
    bad({ ...base, seq: '1' }, 'seq');
    bad({ ...base, ch: 3 }, 'ch:');
  });

  it('rejects each channel rule', () => {
    bad(withCh({ orientation: [0, 0, 0] }), 'ch.orientation');
    bad(withCh({ orientation: [0, 0, 0, 2] }), 'unit quaternion');
    bad(withCh({ orientation: [0, 0, 0, Number.NaN] }), 'ch.orientation');
    bad(withCh({ position: [0, 0] }), 'ch.position');
    bad(withCh({ position: [0, 0, 'z'] }), 'ch.position');
    bad(withCh({ accel: [0, 0, 0, 0] }), 'ch.accel');
    bad(withCh({ touch: {} }), 'ch.touch');
    bad(withCh({ touch: [{ id: 1.5, x: 0, y: 0, phase: 'began' }] }), 'ch.touch[0].id');
    bad(withCh({ touch: [{ id: 1, x: 1.1, y: 0, phase: 'began' }] }), 'ch.touch[0].x');
    bad(withCh({ touch: [{ id: 1, x: 0, y: -0.1, phase: 'began' }] }), 'ch.touch[0].y');
    bad(withCh({ touch: [{ id: 1, x: 0, y: 0, phase: 'lifted' }] }), 'ch.touch[0].phase');
    bad(withCh({ gesture: {} }), 'ch.gesture.type');
    bad(withCh({ gesture: { type: 'wave' } }), 'ch.gesture.type');
    bad(withCh({ gesture: { type: 'tap', dir: [1] } }), 'ch.gesture.dir');
    bad(withCh({ heartRate: -1 }), 'ch.heartRate');
    bad(withCh({ pencil: {} }), 'ch.pencil.tip');
    bad(withCh({ pencil: { tip: [0, 0, 0], pressure: 2, roll: 0, hover: 0 } }), 'ch.pencil.pressure');
    bad(withCh({ pencil: { tip: [0, 0, 0], pressure: 0, hover: 0 } }), 'ch.pencil.roll');
    bad(withCh({ pencil: { tip: [0, 0, 0], pressure: 0, roll: 0 } }), 'ch.pencil.hover');
  });
});

describe('math helpers', () => {
  it('rotates forward by yaw and composes with vec3', () => {
    const f = quat.forward(quat.fromYawPitch(Math.PI / 2, 0));
    expect(f[0]).toBeCloseTo(-1);
    expect(f[2]).toBeCloseTo(0);
    expect(vec3.length(vec3.normalize([3, 0, 4]))).toBeCloseTo(1);
    expect(vec3.normalize(vec3.zero)).toEqual([0, 0, 0]);
  });
});
