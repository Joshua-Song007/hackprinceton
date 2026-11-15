// Virtual devices: AirPods (head yaw/pitch from viewport mouse-look), phone (gesture keys), watch (heart-rate slider).
// Packets carry source "sim" and are emitted at 50 Hz on a device clock that starts at 0. They stay inside the Studio
// process (Network Rule); only the Studio debug panel ever looks at `source`.
import { quat, type DeviceKind, type GestureType, type Slot, type UsisChannels, type UsisPacket, type Vec3 } from '@pear/core';

export const SIM_RATE_HZ = 50;
const MAX_PITCH = (89 * Math.PI) / 180;

interface Device {
  deviceId: string;
  kind: DeviceKind;
  slot: Slot;
  seq: number;
}

export type SimDeviceKind = 'airpods' | 'phone' | 'watch';
export const SIM_DEVICE_KINDS: readonly SimDeviceKind[] = ['airpods', 'phone', 'watch'];

export interface SimDevicesOptions {
  /** Which virtual devices exist; default all three. */
  kinds?: readonly SimDeviceKind[];
  rateHz?: number;
  /** Host clock in ms. Defaults to performance.now. */
  now?: () => number;
  /** Prefix of the device ids (`sim-phone`); a shared room device uses another so it never collides with a player's own. */
  idPrefix?: string;
}

export class SimDevices {
  private emit: (packet: UsisPacket) => void;
  private rateHz: number;
  private now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private airpods: Device;
  private phone: Device;
  private watch: Device;
  private present: Set<SimDeviceKind>;
  private yaw = 0;
  private pitch = 0;
  private heartRate = 72;
  private pos: [number, number, number] | null = null;
  private gpsAccuracy = 3;
  private drift: [number, number] = [0, 0];
  private ticks = 0;
  /** Queued accel samples per device, one sent per tick; a [0, 0, 0] follows the last so the held value resets. */
  private accelQueue = new Map<SimDeviceKind, Vec3[]>();

  constructor(emit: (packet: UsisPacket) => void, options: SimDevicesOptions = {}) {
    this.emit = emit;
    this.present = new Set(options.kinds ?? SIM_DEVICE_KINDS);
    const id = options.idPrefix ?? 'sim';
    this.airpods = { deviceId: `${id}-airpods`, kind: 'airpods', slot: 'head', seq: 0 };
    this.phone = { deviceId: `${id}-phone`, kind: 'phone', slot: 'hand', seq: 0 };
    this.watch = { deviceId: `${id}-watch`, kind: 'watch', slot: 'leftWrist', seq: 0 };
    this.rateHz = options.rateHz ?? SIM_RATE_HZ;
    this.now = options.now ?? (() => performance.now());
  }

  has(kind: SimDeviceKind): boolean {
    return this.present.has(kind);
  }

  list(): SimDeviceKind[] {
    return SIM_DEVICE_KINDS.filter((k) => this.present.has(k));
  }

  addDevice(kind: SimDeviceKind): void {
    this.present.add(kind);
  }

  removeDevice(kind: SimDeviceKind): void {
    this.present.delete(kind);
  }

  private redirects = new Map<SimDeviceKind, { target: SimDevices; allow: () => boolean }>();

  /**
   * Sends this instance's phone gestures, accel clips and heart rate for `kind` to `target` (a device shared by the room or
   * passed between players) while `allow()` holds; otherwise they are dropped, since this player has no such device.
   * Pass null to stop redirecting.
   */
  redirect(kind: SimDeviceKind, target: SimDevices | null, allow: () => boolean = () => true): void {
    if (target) this.redirects.set(kind, { target, allow });
    else this.redirects.delete(kind);
  }

  private redirected(kind: SimDeviceKind): SimDevices | null | undefined {
    const r = this.redirects.get(kind);
    return r ? (r.allow() ? r.target : null) : undefined;
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

  /** Meters, world frame. Until set, head packets carry no `position` and the scene's playerOrigin applies. */
  setPosition(x: number, y: number, z: number): void {
    this.pos = [x, y, z];
  }

  get position(): readonly [number, number, number] {
    return this.pos ?? [0, 1.6, 0];
  }

  /** Phone GPS accuracy in meters (0 = perfect fix). Real phones report about 3 to 10 m outdoors. */
  setGpsAccuracy(meters: number): void {
    this.gpsAccuracy = Math.max(0, meters);
  }

  get gpsAccuracyMeters(): number {
    return this.gpsAccuracy;
  }

  /** Plays an accel clip (m/s², device frame, one sample per tick) on a device, e.g. `accelPulse` for a swing or punch. */
  playAccel(kind: SimDeviceKind, samples: readonly Vec3[]): void {
    const to = this.redirected(kind);
    if (to !== undefined) return to?.playAccel(kind, samples);
    if (this.present.has(kind)) this.accelQueue.set(kind, [...samples, [0, 0, 0]]);
  }

  /** Stored here as well as forwarded: a passed watch copies its holder's own value. */
  setHeartRate(bpm: number): void {
    this.heartRate = Math.max(0, bpm);
    this.redirected('watch')?.setHeartRate(bpm);
  }

  get heartRateBpm(): number {
    return this.heartRate;
  }

  /** A phone gesture, emitted immediately as one packet. */
  gesture(type: GestureType, dir?: Vec3): void {
    const to = this.redirected('phone');
    if (to !== undefined) return to?.gesture(type, dir);
    if (!this.present.has('phone')) return;
    this.send(this.phone, { gesture: dir ? { type, dir } : { type } });
  }

  private tick(): void {
    if (this.present.has('airpods')) this.send(this.airpods, { orientation: quat.fromYawPitch(this.yaw, this.pitch), ...(this.pos ? { position: [...this.pos] as [number, number, number] } : {}) });
    if (this.present.has('watch')) this.send(this.watch, { heartRate: this.heartRate });
    const byKind: Record<SimDeviceKind, Device> = { airpods: this.airpods, phone: this.phone, watch: this.watch };
    for (const [kind, q] of this.accelQueue) {
      const a = q.shift();
      if (a) this.send(byKind[kind], { accel: a });
      if (!q.length) this.accelQueue.delete(kind);
    }
    // Phone GPS: one fix per second, the true position plus slow drift and per-fix noise, both scaled by accuracy.
    if (this.ticks++ % this.rateHz === 0 && this.present.has('phone') && this.pos) {
      const a = this.gpsAccuracy;
      const clamp = (v: number) => Math.max(-a, Math.min(a, v));
      this.drift = [clamp(this.drift[0] + gauss() * 0.1 * a), clamp(this.drift[1] + gauss() * 0.1 * a)];
      const [x, y, z] = this.pos;
      this.send(this.phone, { position: [x + this.drift[0] + gauss() * a / 2, y, z + this.drift[1] + gauss() * a / 2], accuracy: a });
    }
  }

  private send(d: Device, ch: UsisChannels): void {
    this.emit({
      v: 1, deviceId: d.deviceId, kind: d.kind, slot: d.slot, source: 'sim',
      t: Math.max(0, Math.round(this.now() - this.startedAt)), seq: d.seq++, ch,
    });
  }
}

/** A half-sine accel pulse along `axis` (unit), peak m/s², lasting `ms` at `rateHz`: a quick swing, punch or lunge. */
export function accelPulse(axis: Vec3, peak: number, ms = 150, rateHz = SIM_RATE_HZ): Vec3[] {
  const n = Math.max(1, Math.round((ms / 1000) * rateHz));
  return Array.from({ length: n }, (_, i) => {
    const k = peak * Math.sin((Math.PI * (i + 0.5)) / n);
    return [axis[0] * k, axis[1] * k, axis[2] * k] as Vec3;
  });
}

/** Standard normal sample (Box-Muller). */
function gauss(): number {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

const GESTURE_KEYS: Record<string, GestureType> = { t: 'tap', g: 'doubleTap', f: 'flick', p: 'pinch', h: 'squeeze' };

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

/** Keys T = tap, G = double tap, F = flick, P = pinch, H = squeeze (ignored while typing in an input). Returns a detach function. */
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
