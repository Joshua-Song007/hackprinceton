// What an agent player perceives and what it may do. Pure: the Studio run builds the inputs and applies the actions, a person
// standing in the room is the model (so nobody behind you, out of range or hidden is in the Observation, and no scene or server state).
// The action shapes mirror Plugins/langchain-deepagents/runtime/players.py (`clean_actions`); a test compares the two.
import { GESTURE_TYPES, type GestureType } from '@pear/core';
import type { AvatarView, RigDevice } from './rig';

export const OBSERVATION_RANGE = 8;
export const OBSERVATION_FOV_HALF_DEG = 90;
const GAZE_DEG = 30;
export const MAX_ACTIONS = 5;
export const ARENA_HALF = 10;
const MAX_NAME = 64;
const MAX_SAY = 200;
const WAIT_MIN = 0.5;
const WAIT_MAX = 10;
const DEVICES: readonly RigDevice[] = ['phone', 'watch', 'airpods'];

/** Something one player sensed: its own haptic or audio, a sentence said nearby, or feedback on an action that could not be done. */
export interface Cue {
  /** Game seconds when it happened. */
  t: number;
  kind: 'haptic' | 'audio' | 'speech' | 'note';
  text: string;
  /** Who spoke, for speech. */
  from?: string;
}

export interface SeenPlayer {
  id: string;
  /** Meters, one decimal. */
  distance: number;
  /** Degrees from straight ahead, positive to the left, whole numbers. */
  bearing: number;
  gaze: 'at you' | 'away';
}

export interface Observation {
  gameTime: number;
  you: { position: [number, number]; facing: number; arena: number; devices: { kind: RigDevice; shared: boolean }[] };
  others: SeenPlayer[];
  heard: Cue[];
}

const DEG = 180 / Math.PI;
/** An angle in degrees wrapped to (-180, 180]. */
const wrap = (deg: number): number => {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
};

/**
 * The Observation of `self`: others within `range` m and within 90 degrees of straight ahead (forward at yaw 0 is -Z, positive
 * yaw turns left, as in the run), with distance, bearing and whether they look at you. Everyone else is left out, not counted.
 */
export function buildObservation(self: AvatarView, others: readonly AvatarView[], cues: readonly Cue[], gameTime: number, range = OBSERVATION_RANGE): Observation {
  const seen: SeenPlayer[] = [];
  for (const o of others) {
    if (o.id === self.id) continue;
    const dx = o.position[0] - self.position[0], dz = o.position[2] - self.position[2];
    const distance = Math.hypot(dx, dz);
    if (distance > range) continue;
    const bearing = distance < 0.01 ? 0 : wrap(Math.atan2(-dx, -dz) * DEG - self.yaw * DEG);
    if (Math.abs(bearing) > OBSERVATION_FOV_HALF_DEG) continue;
    const gaze = distance >= 0.01 && Math.abs(wrap(o.yaw * DEG - Math.atan2(dx, dz) * DEG)) <= GAZE_DEG ? 'at you' : 'away';
    seen.push({ id: o.id, distance: Math.round(distance * 10) / 10, bearing: Math.round(bearing), gaze });
  }
  seen.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  return {
    gameTime: Math.round(gameTime * 10) / 10,
    you: {
      position: [Math.round(self.position[0] * 10) / 10, Math.round(self.position[2] * 10) / 10],
      facing: Math.round(wrap(self.yaw * DEG)),
      arena: ARENA_HALF,
      devices: self.devices.map((d) => ({ kind: d.kind, shared: d.shared })),
    },
    others: seen,
    heard: cues.map((c) => ({ ...c })),
  };
}

export type Action =
  | { type: 'walk_to'; x: number; z: number }
  | { type: 'look_at'; player: string }
  | { type: 'look_at'; x: number; z: number }
  | { type: 'gesture'; gesture: GestureType }
  | { type: 'give_device'; device: RigDevice; to: string }
  | { type: 'say'; text: string }
  | { type: 'wait'; seconds: number };

const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isName = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_NAME;

/** The valid actions of a reply, in order, at most 5; anything else is dropped and nothing throws. Coordinates are clamped to the arena. */
export function parseActions(raw: unknown, arena = ARENA_HALF): Action[] {
  const clamp = (n: number) => Math.max(-arena, Math.min(arena, n));
  const out: Action[] = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    if (typeof a !== 'object' || a === null) continue;
    const r = a as Record<string, unknown>;
    if (r.type === 'walk_to' && isNumber(r.x) && isNumber(r.z)) out.push({ type: 'walk_to', x: clamp(r.x), z: clamp(r.z) });
    else if (r.type === 'look_at' && isName(r.player)) out.push({ type: 'look_at', player: r.player });
    else if (r.type === 'look_at' && isNumber(r.x) && isNumber(r.z)) out.push({ type: 'look_at', x: clamp(r.x), z: clamp(r.z) });
    else if (r.type === 'gesture' && (GESTURE_TYPES as readonly unknown[]).includes(r.gesture)) out.push({ type: 'gesture', gesture: r.gesture as GestureType });
    else if (r.type === 'give_device' && (DEVICES as readonly unknown[]).includes(r.device) && isName(r.to)) out.push({ type: 'give_device', device: r.device as RigDevice, to: r.to });
    else if (r.type === 'say' && typeof r.text === 'string' && r.text.trim()) out.push({ type: 'say', text: r.text.trim().slice(0, MAX_SAY) });
    else if (r.type === 'wait' && isNumber(r.seconds)) out.push({ type: 'wait', seconds: Math.min(WAIT_MAX, Math.max(WAIT_MIN, r.seconds)) });
    if (out.length === MAX_ACTIONS) break;
  }
  return out;
}
