// Editor camera math: orbit around a target, pan in the view plane, zoom along the view ray. Pure, so it runs in Node.
export type Xyz = readonly [number, number, number];

export interface OrbitState {
  target: Xyz;
  /** Radians around +Y; 0 puts the camera on +Z looking toward -Z. */
  yaw: number;
  /** Radians above the horizon, clamped short of straight up / down. */
  pitch: number;
  distance: number;
}

export const DEFAULT_ORBIT: OrbitState = { target: [0, 1, 0], yaw: 0, pitch: 0.32, distance: 7 };

const MAX_PITCH = Math.PI / 2 - 0.05;
export const MIN_DISTANCE = 0.5;
export const MAX_DISTANCE = 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function orbitPosition(s: OrbitState): Xyz {
  const cp = Math.cos(s.pitch);
  return [
    s.target[0] + s.distance * Math.sin(s.yaw) * cp,
    s.target[1] + s.distance * Math.sin(s.pitch),
    s.target[2] + s.distance * Math.cos(s.yaw) * cp,
  ];
}

/** Drag in pixels: right turns the scene with the pointer, down tilts the camera up. */
export function orbitBy(s: OrbitState, dxPx: number, dyPx: number, radPerPx = 0.005): OrbitState {
  return { ...s, yaw: s.yaw - dxPx * radPerPx, pitch: clamp(s.pitch + dyPx * radPerPx, -MAX_PITCH, MAX_PITCH) };
}

/** Drag in pixels: the scene follows the pointer. Speed scales with distance so far-away scenes pan as fast as near ones. */
export function panBy(s: OrbitState, dxPx: number, dyPx: number, unitsPerPxAtOne = 0.0015): OrbitState {
  const k = s.distance * unitsPerPxAtOne;
  const [sy, cy, sp, cp] = [Math.sin(s.yaw), Math.cos(s.yaw), Math.sin(s.pitch), Math.cos(s.pitch)];
  const right: Xyz = [cy, 0, -sy];
  const up: Xyz = [-sy * sp, cp, -cy * sp];
  return {
    ...s,
    target: [
      s.target[0] - right[0] * dxPx * k + up[0] * dyPx * k,
      s.target[1] - right[1] * dxPx * k + up[1] * dyPx * k,
      s.target[2] - right[2] * dxPx * k + up[2] * dyPx * k,
    ],
  };
}

/**
 * Fly the camera: each input is -1, 0 or 1 (forward / right / up), `distance` is the world units to travel.
 * Forward follows the view direction including pitch; the orbit target moves with the camera, so the distance stays the same.
 */
export function moveBy(s: OrbitState, forward: number, right: number, up: number, distance: number): OrbitState {
  const [sy, cy, sp, cp] = [Math.sin(s.yaw), Math.cos(s.yaw), Math.sin(s.pitch), Math.cos(s.pitch)];
  const f: Xyz = [-sy * cp, -sp, -cy * cp];
  const r: Xyz = [cy, 0, -sy];
  const len = Math.hypot(forward, right, up) || 1; // diagonals are not faster
  const k = distance / len;
  return {
    ...s,
    target: [
      s.target[0] + (f[0] * forward + r[0] * right) * k,
      s.target[1] + (f[1] * forward + up) * k,
      s.target[2] + (f[2] * forward + r[2] * right) * k,
    ],
  };
}

/** Wheel delta (positive = away from the scene), exponential so each notch is the same percentage. */
export function zoomBy(s: OrbitState, wheelDelta: number): OrbitState {
  return { ...s, distance: clamp(s.distance * Math.exp(wheelDelta * 0.001), MIN_DISTANCE, MAX_DISTANCE) };
}

/** Centers on a box (position, scale) from the current direction. */
export function frameBox(s: OrbitState, center: Xyz, size: Xyz): OrbitState {
  const radius = Math.max(0.5, Math.hypot(size[0], size[1], size[2]) / 2);
  return { ...s, target: center, distance: clamp(radius * 2.5, MIN_DISTANCE, MAX_DISTANCE) };
}

/** Where a ray meets the horizontal plane y = `planeY`; null when it is parallel or points away. */
export function rayPlaneY(origin: Xyz, dir: Xyz, planeY: number): Xyz | null {
  if (Math.abs(dir[1]) < 1e-6) return null;
  const t = (planeY - origin[1]) / dir[1];
  return t < 0 ? null : [origin[0] + dir[0] * t, planeY, origin[2] + dir[2] * t];
}
