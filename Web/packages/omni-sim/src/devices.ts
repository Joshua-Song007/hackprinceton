// Virtual devices: AirPods (head yaw/pitch from viewport mouse-look), phone (gesture keys), watch (heart-rate slider).
// Packets carry source "sim" and are emitted at 50 Hz on a device clock that starts at 0. They stay inside the Studio
// process (Network Rule); only the Studio debug panel ever looks at `source`.
import { quat, type DeviceKind, type GestureType, type Slot, type UsisChannels, type UsisPacket, type Vec3 } from '@omni/core';

export const SIM_RATE_HZ = 50;
const MAX_PITCH = (89 * Math.PI) / 180;

interface Device {
  deviceId: string;
  kind: DeviceKind;
  slot: Slot;
  seq: number;
}

export interface SimDevicesOptions {
  rateHz?: number;
  /** Host clock in ms. Defaults to performance.now. */
  now?: () => number;
}

export class SimDevices {
  private emit: (packet: UsisPacket) => void;
  private rateHz: number;
  private now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private airpods: Device = { deviceId: 'sim-airpods', kind: 'airpods', slot: 'head', seq: 0 };
  private phone: Device = { deviceId: 'sim-phone', kind: 'phone', slot: 'hand', seq: 0 };
  private watch: Device = { deviceId: 'sim-watch', kind: 'watch', slot: 'leftWrist', seq: 0 };
  private yaw = 0;
  private pitch = 0;
  private heartRate = 72;

  constructor(emit: (packet: UsisPacket) => void, options: SimDevicesOptions = {}) {
    this.emit = emit;
    this.rateHz = options.rateHz ?? SIM_RATE_HZ;
    this.now = options.now ?? (() => performance.now());
  }

  /** Starts the 50 Hz stream; the device clock restarts at 0. */
  start(): void {
    if (this.timer) return;
    this.startedAt = this.now();
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000 / this.rateHz);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Radians: yaw about +Y (positive turns left), pitch about +X (positive looks up, clamped to 89 degrees). */
  setHeadLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));
  }

  get headLook(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  setHeartRate(bpm: number): void {
    this.heartRate = Math.max(0, bpm);
  }

  /** A phone gesture, emitted immediately as one packet. */
  gesture(type: GestureType, dir?: Vec3): void {
    this.send(this.phone, { gesture: dir ? { type, dir } : { type } });
  }

  private tick(): void {
    this.send(this.airpods, { orientation: quat.fromYawPitch(this.yaw, this.pitch) });
    this.send(this.watch, { heartRate: this.heartRate });
  }

  private send(d: Device, ch: UsisChannels): void {
    this.emit({
      v: 1, deviceId: d.deviceId, kind: d.kind, slot: d.slot, source: 'sim',
      t: Math.max(0, Math.round(this.now() - this.startedAt)), seq: d.seq++, ch,
    });
  }
}

const GESTURE_KEYS: Record<string, GestureType> = { t: 'tap', f: 'flick', p: 'pinch' };

/** Drag to look: horizontal drag changes yaw, vertical changes pitch. Returns a detach function. */
export function attachMouseLook(target: HTMLElement, devices: SimDevices, radiansPerPixel = 0.005): () => void {
  let last: { x: number; y: number } | null = null;
  const down = (e: PointerEvent) => {
    last = { x: e.clientX, y: e.clientY };
    target.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!last) return;
    const { yaw, pitch } = devices.headLook;
    devices.setHeadLook(yaw - (e.clientX - last.x) * radiansPerPixel, pitch - (e.clientY - last.y) * radiansPerPixel);
    last = { x: e.clientX, y: e.clientY };
  };
  const up = () => (last = null);
  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
  return () => {
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
  };
}

/** Keys T = tap, F = flick, P = pinch (ignored while typing in an input). Returns a detach function. */
export function attachGestureKeys(target: EventTarget, devices: SimDevices): () => void {
  const onKey = (e: Event) => {
    const k = e as KeyboardEvent;
    const el = k.target as HTMLElement | null;
    if (k.ctrlKey || k.metaKey || k.altKey || el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? '')) return;
    const type = GESTURE_KEYS[k.key.toLowerCase()];
    if (type) devices.gesture(type, type === 'flick' ? [1, 0, 0] : undefined);
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
