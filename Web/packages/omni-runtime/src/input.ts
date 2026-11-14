// InputBus: latest sample per slot, `source` stripped (hardware-blind rule), stale after 500 ms, one InputFrame per tick.
import {
  SLOTS, validateUsis, type DeviceKind, type Gesture, type PencilState, type Quat, type Slot, type TouchPoint, type Vec3,
} from '@omni/core';

export const STALE_AFTER_MS = 500;

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
  gestures: Gesture[];
  heartRate?: number;
  pencil?: PencilState;
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

export class InputBus {
  private held = new Map<Slot, Held>();
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
    if (ch.orientation) sample.orientation = ch.orientation;
    if (ch.position) sample.position = ch.position;
    if (ch.accel) sample.accel = ch.accel;
    if (ch.touch) sample.touches = ch.touch;
    if (ch.gesture) sample.gestures.push(ch.gesture);
    if (ch.heartRate !== undefined) sample.heartRate = ch.heartRate;
    if (ch.pencil) sample.pencil = ch.pencil;
    this.held.set(slot, { sample, receivedAt: nowMs });
    return true;
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
