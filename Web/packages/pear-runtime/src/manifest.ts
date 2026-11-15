// Game package manifest (`pear-game.json`): the contract a game declares beside its scene and scripts (name, players, device needs,
// gesture thresholds), plus the single home for the gesture defaults. Pure, so Studio, the check command and the tests share one answer.
// Backend/src/manifest.rs applies the same rules on publish; Schema/pear-game.schema.json documents them. Unknown fields are kept.
import { GESTURE_TYPES, type GestureType } from '@pear/core';
import type { RaiseGesture, SceneDescription } from './scene';

export class ManifestError extends Error {
  override name = 'ManifestError';
}

export const MANIFEST_FORMAT = 'pear-game/1';
export const MANIFEST_KEYS = ['format', 'name', 'scene', 'scripts', 'players', 'capabilities', 'controller', 'cues', 'instructions', 'checks'] as const;
export const MAX_NAME_LENGTH = 256;

/** What a game may ask of a player's devices; `motion` is the phone's accelerometer and gravity (raise, shake). */
export const SENSORS = ['head', 'position', 'heartRate', 'motion'] as const;
export type Sensor = (typeof SENSORS)[number];

/** Raise detection defaults: the one place these numbers live in TypeScript (scene.ts reads them from here). */
export const RAISE_DEFAULTS: RaiseGesture = { angleDeg: 80, hysteresisDeg: 10 };

export interface ManifestCapabilities {
  /** Capability tier the game needs, 1...3. */
  tier?: number;
  sensors: Sensor[];
  gestures: { builtin: GestureType[]; raise?: RaiseGesture };
}

export interface GameManifest {
  format: typeof MANIFEST_FORMAT;
  name: string;
  /** Path of the scene file inside the package. */
  scene: string;
  scripts?: { client: string[]; server: string[] };
  players?: { min: number; max: number };
  capabilities?: ManifestCapabilities;
  /** Reserved for the data-driven phone controller; kept as written, not interpreted. */
  controller?: Record<string, unknown>;
  cues?: Record<string, unknown>;
  instructions?: Record<string, unknown>;
  /** Path of the check spec inside the package. */
  checks?: string;
  [key: string]: unknown;
}

type Obj = Record<string, unknown>;

function obj(x: unknown, path: string): Obj {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new ManifestError(`${path} must be an object`);
  return x as Obj;
}

function list(x: unknown, path: string): unknown[] {
  if (!Array.isArray(x)) throw new ManifestError(`${path} must be an array`);
  return x;
}

/** A path inside the package: relative, forward slashes, nothing that climbs out. */
function packagePath(x: unknown, path: string): string {
  if (typeof x !== 'string' || x === '') throw new ManifestError(`${path} must be a non-empty string`);
  if (x.startsWith('/') || /[\\:\0]/.test(x) || x.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new ManifestError(`${path} must be a relative path inside the package`);
  }
  return x;
}

function names(x: unknown, path: string): string[] {
  return list(x, path).map((n, i) => {
    if (typeof n !== 'string' || n === '') throw new ManifestError(`${path}[${i}] must be a non-empty string`);
    return n;
  });
}

function number(x: unknown, path: string, fallback: number): number {
  if (x === undefined) return fallback;
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new ManifestError(`${path} must be a number`);
  return x;
}

function parseRaise(raw: unknown): RaiseGesture {
  const g = obj(raw, 'capabilities.gestures.raise');
  const angleDeg = number(g.angleDeg, 'capabilities.gestures.raise.angleDeg', RAISE_DEFAULTS.angleDeg);
  const hysteresisDeg = number(g.hysteresisDeg, 'capabilities.gestures.raise.hysteresisDeg', RAISE_DEFAULTS.hysteresisDeg);
  if (!(angleDeg > 0 && angleDeg < 180)) throw new ManifestError('capabilities.gestures.raise.angleDeg must be between 0 and 180');
  if (!(hysteresisDeg >= 0 && hysteresisDeg < angleDeg)) throw new ManifestError('capabilities.gestures.raise.hysteresisDeg must be >= 0 and less than angleDeg');
  return { angleDeg, hysteresisDeg };
}

function parseCapabilities(raw: unknown): ManifestCapabilities {
  const c = obj(raw, 'capabilities');
  const out: ManifestCapabilities = { sensors: [], gestures: { builtin: [] } };
  if (c.tier !== undefined) {
    if (typeof c.tier !== 'number' || !Number.isInteger(c.tier) || c.tier < 1 || c.tier > 3) throw new ManifestError('capabilities.tier must be 1, 2 or 3');
    out.tier = c.tier;
  }
  if (c.sensors !== undefined) {
    const sensors = list(c.sensors, 'capabilities.sensors').map((s, i) => {
      if (!(SENSORS as readonly unknown[]).includes(s)) throw new ManifestError(`capabilities.sensors[${i}]: unknown sensor '${String(s)}'`);
      return s as Sensor;
    });
    out.sensors = [...new Set(sensors)];
  }
  if (c.gestures !== undefined) {
    const g = obj(c.gestures, 'capabilities.gestures');
    if (g.builtin !== undefined) {
      const builtin = list(g.builtin, 'capabilities.gestures.builtin').map((t, i) => {
        if (!(GESTURE_TYPES as readonly unknown[]).includes(t)) throw new ManifestError(`capabilities.gestures.builtin[${i}]: unknown gesture '${String(t)}'`);
        return t as GestureType;
      });
      out.gestures.builtin = [...new Set(builtin)];
    }
    if (g.raise !== undefined) out.gestures.raise = parseRaise(g.raise);
  }
  return out;
}

/** Validates parsed `pear-game.json`. Throws `ManifestError` naming the field; fields it does not know are kept as written. */
export function parseManifest(raw: unknown): GameManifest {
  const m = obj(raw, 'manifest');
  if (m.format !== MANIFEST_FORMAT) throw new ManifestError(`format must be "${MANIFEST_FORMAT}"`);
  if (typeof m.name !== 'string' || m.name.trim() === '' || m.name.length > MAX_NAME_LENGTH) {
    throw new ManifestError(`name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`);
  }
  const out: GameManifest = { ...m, format: MANIFEST_FORMAT, name: m.name, scene: m.scene === undefined ? 'scene.json' : packagePath(m.scene, 'scene') };
  if (m.scripts !== undefined) {
    const s = obj(m.scripts, 'scripts');
    out.scripts = { client: names(s.client ?? [], 'scripts.client'), server: names(s.server ?? [], 'scripts.server') };
  }
  if (m.players !== undefined) {
    const p = obj(m.players, 'players');
    const { min, max } = p;
    if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) < 1 || (max as number) > 32 || (min as number) > (max as number)) {
      throw new ManifestError('players must be {min, max} whole numbers with 1 <= min <= max <= 32');
    }
    out.players = { min: min as number, max: max as number };
  }
  if (m.capabilities !== undefined) out.capabilities = parseCapabilities(m.capabilities);
  for (const key of ['controller', 'cues', 'instructions'] as const) {
    if (m[key] !== undefined) out[key] = obj(m[key], key);
  }
  if (m.checks !== undefined) out.checks = packagePath(m.checks, 'checks');
  return out;
}

export type ManifestWarningCode = 'players-mismatch' | 'tier-mismatch' | 'raise-mismatch' | 'scripts-missing';

export interface ManifestWarning {
  code: ManifestWarningCode;
  message: string;
}

/**
 * Compares a manifest with the scene it ships with. Both say things (players, tier, raise thresholds) until one home remains,
 * so a difference is reported instead of one silently winning.
 */
export function lintManifest(manifest: GameManifest, scene: SceneDescription): ManifestWarning[] {
  const out: ManifestWarning[] = [];
  const warn = (code: ManifestWarningCode, message: string) => out.push({ code, message });
  const players = scene.inputs?.players;
  if (manifest.players && players && (manifest.players.min !== players[0] || manifest.players.max !== players[1])) {
    warn('players-mismatch', `The manifest allows ${manifest.players.min} to ${manifest.players.max} players but the scene says ${players[0]} to ${players[1]}.`);
  }
  const tier = manifest.capabilities?.tier;
  if (tier !== undefined && tier !== scene.requiredTier) {
    warn('tier-mismatch', `The manifest needs tier ${tier} but the scene says tier ${scene.requiredTier}.`);
  }
  const raise = manifest.capabilities?.gestures.raise;
  if (raise && scene.raise && (raise.angleDeg !== scene.raise.angleDeg || raise.hysteresisDeg !== scene.raise.hysteresisDeg)) {
    warn('raise-mismatch', `The manifest raises at ${raise.angleDeg} degrees (hysteresis ${raise.hysteresisDeg}) but the scene says ${scene.raise.angleDeg} (${scene.raise.hysteresisDeg}).`);
  }
  if (manifest.scripts) {
    for (const n of manifest.scripts.client) if (!scene.clientScripts.includes(n)) warn('scripts-missing', `Client script "${n}" is in the manifest but not in the scene.`);
    for (const n of manifest.scripts.server) if (!scene.serverScripts.includes(n)) warn('scripts-missing', `Server script "${n}" is in the manifest but not in the scene.`);
  }
  return out;
}
