// The simulator's body: where a player's head, ears, wrist, hand and gaze sit in the world for a position and a head look,
// and the plain data the viewport draws. Pure, so the layout is tested without WebGL.
export type RigVec = readonly [number, number, number];
export type RigDevice = 'airpods' | 'phone' | 'watch';

/** Half the look-at cone (overview.md: the runtime fires onLookAt inside 15 degrees). */
export const LOOK_LOCK_DEG = 15;
/** How far the gaze ray is drawn. */
export const GAZE_LENGTH = 3;
/** How long a haptic pulse ring stays on screen. */
export const PULSE_MS = 400;

export interface RigPose {
  /** Head position in meters. */
  position: RigVec;
  /** Radians: yaw about +Y (positive turns left), pitch about +X (positive looks up). Forward at yaw 0 is -Z. */
  yaw: number;
  pitch: number;
}

export interface RigLayout {
  head: RigVec;
  feet: RigVec;
  /** Unit vector the head looks along. */
  forward: RigVec;
  gazeTip: RigVec;
  leftEar: RigVec;
  rightEar: RigVec;
  leftWrist: RigVec;
  /** Where the phone is held. */
  hand: RigVec;
}

const add = (a: RigVec, b: RigVec, k = 1): RigVec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Body-relative device spots rotated by yaw only (the body turns with the head, the pitch only tilts the gaze). */
export function rigLayout(pose: RigPose): RigLayout {
  const { position: head, yaw, pitch } = pose;
  const [s, c] = [Math.sin(yaw), Math.cos(yaw)];
  const fwdH: RigVec = [-s, 0, -c];
  const right: RigVec = [c, 0, -s];
  const forward: RigVec = [-s * Math.cos(pitch), Math.sin(pitch), -c * Math.cos(pitch)];
  const at = (r: number, f: number, down: number): RigVec => [head[0] + right[0] * r + fwdH[0] * f, head[1] - down, head[2] + right[2] * r + fwdH[2] * f];
  return {
    head,
    feet: [head[0], 0, head[2]],
    forward,
    gazeTip: add(head, forward, GAZE_LENGTH),
    leftEar: at(-0.09, 0, 0),
    rightEar: at(0.09, 0, 0),
    leftWrist: at(-0.25, 0.3, 0.7),
    hand: at(0.2, 0.35, 0.55),
  };
}

/** One simulated player as the viewport draws it. */
export interface AvatarView {
  id: string;
  position: RigVec;
  yaw: number;
  pitch: number;
  /** The player the keyboard and Test panel drive. */
  driven: boolean;
  /** Devices this player has now: their own, or a passed one they hold (`shared`). */
  devices: { kind: RigDevice; shared: boolean }[];
  /** `Date.now()` of the last haptic, 0 for never. */
  hapticAt: number;
}

export interface RigView {
  avatars: AvatarView[];
  /** Free-floating devices, drawn where they sit. */
  free: { kind: RigDevice; at: RigVec }[];
}

/** What a click in the viewport hit: a device marker (of a player, or of the room when `owner` is null) or a player's body. */
export type RigHit = { type: 'device'; kind: RigDevice; owner: string | null } | { type: 'avatar'; id: string };

/** A short string that changes whenever the picture would, so the viewport rebuilds only then. Haptic age is bucketed to 50 ms. */
export function rigKey(view: RigView | null, now: number): string {
  if (!view) return '';
  const q = (n: number) => Math.round(n * 100);
  const a = view.avatars.map((v) => {
    const age = now - v.hapticAt;
    const pulse = v.hapticAt && age >= 0 && age < PULSE_MS ? Math.floor(age / 50) + 1 : 0;
    return [v.id, v.driven ? 1 : 0, q(v.position[0]), q(v.position[1]), q(v.position[2]), Math.round(v.yaw * 200), Math.round(v.pitch * 200), pulse,
      v.devices.map((d) => `${d.kind}${d.shared ? '*' : ''}`).join('+')].join(',');
  });
  const f = view.free.map((d) => `${d.kind}@${q(d.at[0])},${q(d.at[1])},${q(d.at[2])}`);
  return `${a.join('|')}#${f.join('|')}`;
}
