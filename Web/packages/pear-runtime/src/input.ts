// InputBus: latest sample per slot, `source` stripped (hardware-blind rule), stale after 500 ms, one InputFrame per tick.
import {
  SLOTS, quat, validateUsis, vec3, type DeviceKind, type Gesture, type PencilState, type Quat, type Slot, type TouchPoint, type Vec3,
} from '@pear/core';

export const STALE_AFTER_MS = 500;

/** A gesture in a frame: a USIS gesture, or `raise`/`lower` derived by the bus (with `t`, the packet time that crossed the angle). */
export interface BusGesture extends Omit<Gesture, 'type'> {
  type: Gesture['type'] | 'raise' | 'lower';
  t?: number;
}

/** Raise detection from scene `gestures.raise`: angle between the rest and current gravity direction, in degrees. */
export interface RaiseOptions {
  angleDeg: number;
  hysteresisDeg: number;
}

/** One device's state for a frame. Deliberately has no `source`: games cannot tell sim from live. */
export interface DeviceSample {
  deviceId: string;
  kind: DeviceKind;
  slot: Slot;
  stale: boolean;
  orientation?: Quat;
  position?: Vec3;
  accel?: Vec3;
  touches: TouchPoint[];
  /** Gestures received since the previous frame. */
  gestures: BusGesture[];
  heartRate?: number;
  pencil?: PencilState;
  /** Meters, accuracy of `position`. */
  accuracy?: number;
}

export interface InputFrame {
  /** Host time, ms. */
  timestamp: number;
  devices: DeviceSample[];
}

interface Held {
  sample: DeviceSample;
  receivedAt: number;
}

/** World up seen from the device frame: unchanged by yaw, so no Euler angles and no gimbal lock. */
const gravityDir = (q: Quat): Vec3 => vec3.normalize(quat.rotate(quat.conjugate(q), [0, 1, 0]));

export class InputBus {
  private held = new Map<Slot, Held>();
  /** Per device: rest gravity direction (first orientation packet until `calibrate`) and whether it is raised. */
  private raise = new Map<string, { rest?: Vec3; raised: boolean }>();

  constructor(private options: { raise?: RaiseOptions } = {}) {}

  /** Makes each device's current orientation its rest pose; a device with no orientation yet takes its first. */
  calibrate(): void {
    for (const { sample } of this.held.values()) {
      const state = this.raise.get(sample.deviceId) ?? { raised: false };
      state.rest = sample.orientation && gravityDir(sample.orientation);
      this.raise.set(sample.deviceId, state);
    }
  }

  /** Packets rejected by the USIS validator since creation. */
  dropped = 0;

  /** Validates and ingests one packet at host time `nowMs`. Returns false (and counts it) when invalid. */
  ingest(input: unknown, nowMs: number): boolean {
    const result = validateUsis(input);
    if (!result.ok) {
      this.dropped++;
      return false;
    }
    const { deviceId, kind, slot, ch = {} } = result.packet;
    const prev = this.held.get(slot);
    // Channels are sample-and-hold per device; a different device in the same slot replaces the old one.
    const sample: DeviceSample =
      prev && prev.sample.deviceId === deviceId
        ? prev.sample
        : { deviceId, kind, slot, stale: false, touches: [], gestures: [] };
    if (ch.orientation) {
      sample.orientation = ch.orientation;
      if (this.options.raise) this.detectRaise(sample, ch.orientation, result.packet.t);
    }
    if (ch.position) sample.position = ch.position;
    if (ch.accel) sample.accel = ch.accel;
    if (ch.touch) sample.touches = ch.touch;
    if (ch.gesture) sample.gestures.push(ch.gesture);
    if (ch.heartRate !== undefined) sample.heartRate = ch.heartRate;
    if (ch.pencil) sample.pencil = ch.pencil;
    if (typeof ch.accuracy === 'number') sample.accuracy = ch.accuracy;
    this.held.set(slot, { sample, receivedAt: nowMs });
    return true;
  }

  private detectRaise(sample: DeviceSample, orientation: Quat, t: number): void {
    const { angleDeg, hysteresisDeg } = this.options.raise!;
    const state = this.raise.get(sample.deviceId) ?? { raised: false };
    this.raise.set(sample.deviceId, state);
    const now = gravityDir(orientation);
    state.rest ??= now;
    const angle = (Math.acos(Math.min(1, Math.max(-1, vec3.dot(state.rest, now)))) * 180) / Math.PI;
    if (!state.raised && angle >= angleDeg) sample.gestures.push({ type: 'raise', t });
    else if (state.raised && angle <= angleDeg - hysteresisDeg) sample.gestures.push({ type: 'lower', t });
    else return;
    state.raised = !state.raised;
  }

  /** The frame for this tick. Gestures are delivered once: they are cleared after being returned. */
  frame(nowMs: number): InputFrame {
    const devices: DeviceSample[] = [];
    for (const slot of SLOTS) {
      const h = this.held.get(slot);
      if (!h) continue;
      devices.push({ ...h.sample, gestures: h.sample.gestures, stale: nowMs - h.receivedAt > STALE_AFTER_MS });
      h.sample.gestures = [];
    }
    return { timestamp: nowMs, devices };
  }
}
