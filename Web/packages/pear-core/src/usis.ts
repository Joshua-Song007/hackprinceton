// USIS v1 packet types and validator, written by hand from Schema/usis.schema.json (test/usis.test.ts checks
// the enums and required fields against the schema file). Extra rules mirror PacketValidator.swift:
// unit quaternion within 0.01, finite numbers, deviceId at most 128 characters. No I/O, no dependencies.

export type Vec3 = readonly [number, number, number];
/** [x, y, z, w], right-handed, +X right, +Y up, -Z forward. */
export type Quat = readonly [number, number, number, number];
export interface Pose {
  position: Vec3;
  orientation: Quat;
}

export const DEVICE_KINDS = ['phone', 'tablet', 'airpods', 'watch', 'pencil', 'headset', 'custom'] as const;
export const SLOTS = ['head', 'leftWrist', 'rightWrist', 'hand', 'pocket', 'stylus'] as const;
export const SOURCES = ['live', 'sim'] as const;
export const GESTURE_TYPES = ['tap', 'doubleTap', 'flick', 'squeeze', 'pinch'] as const;
export const TOUCH_PHASES = ['began', 'moved', 'ended'] as const;
export const USIS_VERSION = 1;
export const QUATERNION_TOLERANCE = 0.01;
export const MAX_DEVICE_ID_LENGTH = 128;

export type DeviceKind = (typeof DEVICE_KINDS)[number];
export type Slot = (typeof SLOTS)[number];
export type Source = (typeof SOURCES)[number];
export type GestureType = (typeof GESTURE_TYPES)[number];
export type TouchPhase = (typeof TOUCH_PHASES)[number];

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
  phase: TouchPhase;
}
export interface Gesture {
  type: GestureType;
  dir?: Vec3;
}
export interface PencilState {
  tip: Vec3;
  pressure: number;
  roll: number;
  hover: number;
}
export interface UsisChannels {
  orientation?: Quat;
  position?: Vec3;
  accel?: Vec3;
  touch?: TouchPoint[];
  gesture?: Gesture;
  heartRate?: number;
  pencil?: PencilState;
  /** Meters, horizontal accuracy of `position` (GPS-style). Not in usis.schema.json yet: rides on `ch` allowing extra channels. */
  accuracy?: number;
  [unknownChannel: string]: unknown;
}
export interface UsisPacket {
  v: 1;
  deviceId: string;
  kind: DeviceKind;
  slot: Slot;
  source: Source;
  t: number;
  seq: number;
  ch?: UsisChannels;
}

export type UsisValidation = { ok: true; packet: UsisPacket } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => Number.isInteger(x);
const isOneOf = <T extends readonly string[]>(list: T, x: unknown): x is T[number] =>
  typeof x === 'string' && (list as readonly string[]).includes(x);

function checkTuple(x: unknown, n: number, path: string, errors: string[]): boolean {
  if (!Array.isArray(x) || x.length !== n || !x.every(isNum)) {
    errors.push(`${path}: expected ${n} finite numbers`);
    return false;
  }
  return true;
}

function checkChannels(ch: Obj, errors: string[]): void {
  const { orientation, position, accel, touch, gesture, heartRate, pencil } = ch;
  if (orientation !== undefined && checkTuple(orientation, 4, 'ch.orientation', errors)) {
    const norm = Math.hypot(...(orientation as Quat));
    if (Math.abs(norm - 1) > QUATERNION_TOLERANCE) errors.push('ch.orientation: not a unit quaternion');
  }
  if (position !== undefined) checkTuple(position, 3, 'ch.position', errors);
  if (accel !== undefined) checkTuple(accel, 3, 'ch.accel', errors);
  if (touch !== undefined) {
    if (!Array.isArray(touch)) errors.push('ch.touch: expected array');
    else
      touch.forEach((t: unknown, i) => {
        const p = `ch.touch[${i}]`;
        if (!isObj(t)) return void errors.push(`${p}: expected object`);
        if (!isInt(t.id)) errors.push(`${p}.id: expected integer`);
        for (const axis of ['x', 'y'] as const)
          if (!isNum(t[axis]) || t[axis] < 0 || t[axis] > 1) errors.push(`${p}.${axis}: expected number in 0...1`);
        if (!isOneOf(TOUCH_PHASES, t.phase)) errors.push(`${p}.phase: expected ${TOUCH_PHASES.join('|')}`);
      });
  }
  if (gesture !== undefined) {
    if (!isObj(gesture)) errors.push('ch.gesture: expected object');
    else {
      if (!isOneOf(GESTURE_TYPES, gesture.type)) errors.push(`ch.gesture.type: expected ${GESTURE_TYPES.join('|')}`);
      if (gesture.dir !== undefined) checkTuple(gesture.dir, 3, 'ch.gesture.dir', errors);
    }
  }
  if (heartRate !== undefined && (!isNum(heartRate) || heartRate < 0)) errors.push('ch.heartRate: expected number >= 0');
  if (ch.accuracy !== undefined && (!isNum(ch.accuracy) || ch.accuracy < 0)) errors.push('ch.accuracy: expected number >= 0');
  if (pencil !== undefined) {
    if (!isObj(pencil)) errors.push('ch.pencil: expected object');
    else {
      checkTuple(pencil.tip, 3, 'ch.pencil.tip', errors);
      if (!isNum(pencil.pressure) || pencil.pressure < 0 || pencil.pressure > 1)
        errors.push('ch.pencil.pressure: expected number in 0...1');
      if (!isNum(pencil.roll)) errors.push('ch.pencil.roll: expected number');
      if (!isNum(pencil.hover)) errors.push('ch.pencil.hover: expected number');
    }
  }
}

/** Validates an unknown value against USIS v1. Unknown channels and unknown top-level keys are ignored. */
export function validateUsis(input: unknown): UsisValidation {
  if (!isObj(input)) return { ok: false, errors: ['packet: expected object'] };
  const errors: string[] = [];
  if (input.v !== USIS_VERSION) errors.push(`v: expected ${USIS_VERSION}`);
  if (typeof input.deviceId !== 'string' || input.deviceId.length < 1) errors.push('deviceId: expected non-empty string');
  else if (input.deviceId.length > MAX_DEVICE_ID_LENGTH) errors.push(`deviceId: longer than ${MAX_DEVICE_ID_LENGTH}`);
  if (!isOneOf(DEVICE_KINDS, input.kind)) errors.push(`kind: expected ${DEVICE_KINDS.join('|')}`);
  if (!isOneOf(SLOTS, input.slot)) errors.push(`slot: expected ${SLOTS.join('|')}`);
  if (!isOneOf(SOURCES, input.source)) errors.push(`source: expected ${SOURCES.join('|')}`);
  if (!isInt(input.t) || (input.t as number) < 0) errors.push('t: expected integer >= 0');
  if (!isInt(input.seq) || (input.seq as number) < 0) errors.push('seq: expected integer >= 0');
  if (input.ch !== undefined) {
    if (!isObj(input.ch)) errors.push('ch: expected object');
    else checkChannels(input.ch, errors);
  }
  return errors.length ? { ok: false, errors } : { ok: true, packet: input as unknown as UsisPacket };
}

export const vec3 = {
  zero: [0, 0, 0] as Vec3,
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  mul: (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  length: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  /** The zero vector stays zero. */
  normalize(a: Vec3): Vec3 {
    const n = Math.hypot(a[0], a[1], a[2]);
    return n === 0 ? a : [a[0] / n, a[1] / n, a[2] / n];
  },
};

export const quat = {
  identity: [0, 0, 0, 1] as Quat,
  /** Hamilton product a * b (apply b, then a). */
  mul: (a: Quat, b: Quat): Quat => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  conjugate: (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]],
  normalize(q: Quat): Quat {
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    return n === 0 ? [0, 0, 0, 1] : [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  },
  fromAxisAngle(axis: Vec3, radians: number): Quat {
    const [x, y, z] = vec3.normalize(axis);
    const s = Math.sin(radians / 2);
    return [x * s, y * s, z * s, Math.cos(radians / 2)];
  },
  /** Rotates `v` by the unit quaternion `q`. */
  rotate(q: Quat, v: Vec3): Vec3 {
    const r = quat.mul(quat.mul(q, [v[0], v[1], v[2], 0]), quat.conjugate(q));
    return [r[0], r[1], r[2]];
  },
  /** Head look: yaw about +Y (positive turns left), then pitch about +X (positive looks up). */
  fromYawPitch: (yaw: number, pitch: number): Quat =>
    quat.mul(quat.fromAxisAngle([0, 1, 0], yaw), quat.fromAxisAngle([1, 0, 0], pitch)),
  /** Forward is -Z in the schema's frame. */
  forward: (q: Quat): Vec3 => quat.rotate(q, [0, 0, -1]),
};
