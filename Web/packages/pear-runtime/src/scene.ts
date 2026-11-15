// scene.json loader. Same shape, defaults and error messages as SceneDescription.swift + SceneLoader.swift.
import { GESTURE_TYPES, SLOTS, quat, vec3, type GestureType, type Quat, type Slot, type Vec3 } from '@pear/core';

export class SceneError extends Error {
  override name = 'SceneError';
}

export type RunMode = 'screen' | 'device';
export type ComponentDescription =
  | { type: 'trigger'; shape: 'sphere'; radius: number; probeSlots: Slot[] }
  | { type: 'trigger'; shape: 'box'; size: Vec3; probeSlots: Slot[] }
  | { type: 'audioEmitter'; soundName: string; gain: number; loops: boolean }
  | { type: 'script'; name: string };

export type EntityShape = 'box' | 'sphere';

export interface EntityDescription {
  name: string;
  /** Viewport look only; the Swift loader ignores it (Web-first field). */
  shape: EntityShape;
  /** CSS color, or undefined for the theme default. */
  color?: string;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  components: ComponentDescription[];
  children: EntityDescription[];
}

export interface SceneDescription {
  name: string;
  /** Capability tier the game needs, 1...3. */
  requiredTier: number;
  /** Head position used when the head sample carries no `position`. */
  playerOrigin: Vec3;
  runMode: RunMode;
  /** `location`: client scripts may read `ctx.position` (this player's own position) to send as a game event. */
  permissions: { location: boolean };
  /** What each player must provide, declared by the creator; null when the scene does not say (Studio then infers it from the scripts). */
  inputs: SceneInputs | null;
  /** Creator-defined motion gestures, recognized by the runtime from `accel` and delivered as `onGesture({ type: name })`. */
  gestures: Record<string, CustomGesture>;
  clientScripts: string[];
  serverScripts: string[];
  entities: EntityDescription[];
}

/** A game's input needs: Studio builds every simulated player's devices from it and starts Play with `players[0]` players. */
export interface SceneInputs {
  /** Head orientation (look-at, head-probe triggers). */
  head: boolean;
  position: boolean;
  heartRate: boolean;
  gestures: GestureType[];
  /** Minimum and maximum players, 1...32. */
  players: readonly [number, number];
}

/**
 * A motion gesture: fires when the device in `slot` sees `accel` (m/s², device frame) along unit `axis` rise past
 * `threshold`, then waits `cooldownMs`. Same code path for sim and live input, so the hardware-blind rule holds.
 */
export interface CustomGesture {
  slot: Slot;
  axis: Vec3;
  threshold: number;
  cooldownMs: number;
}

type Obj = Record<string, unknown>;

function obj(x: unknown, path: string): Obj {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new SceneError(`${path}: expected object`);
  return x as Obj;
}
function list(x: unknown, path: string): unknown[] {
  if (x === undefined) return [];
  if (!Array.isArray(x)) throw new SceneError(`${path}: expected array`);
  return x;
}
function str(x: unknown, path: string, fallback?: string): string {
  if (x === undefined && fallback !== undefined) return fallback;
  if (typeof x !== 'string') throw new SceneError(`${path}: expected string`);
  return x;
}
function num(x: unknown, path: string, fallback?: number): number {
  if (x === undefined && fallback !== undefined) return fallback;
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new SceneError(`${path}: expected number`);
  return x;
}
function tuple<N extends 3 | 4>(x: unknown, n: N, path: string, fallback: readonly number[]): readonly number[] {
  if (x === undefined) return fallback;
  if (!Array.isArray(x) || x.length !== n || !x.every((v) => typeof v === 'number' && Number.isFinite(v)))
    throw new SceneError(`${path}: expected ${n} numbers`);
  return x as number[];
}
function bool(x: unknown, path: string, fallback: boolean): boolean {
  if (x === undefined) return fallback;
  if (typeof x !== 'boolean') throw new SceneError(`${path}: expected boolean`);
  return x;
}
const vec = (x: unknown, path: string, fallback: Vec3) => tuple(x, 3, path, fallback) as Vec3;

function parseComponent(raw: unknown, path: string): ComponentDescription {
  const c = obj(raw, path);
  const type = str(c.type, `${path}.type`);
  switch (type) {
    case 'trigger': {
      const shape = str(c.shape, `${path}.shape`);
      const probeSlots = list(c.probeSlots ?? ['head'], `${path}.probeSlots`).map((s) => {
        if (!(SLOTS as readonly unknown[]).includes(s)) throw new SceneError(`${path}.probeSlots: unknown slot '${String(s)}'`);
        return s as Slot;
      });
      if (shape === 'sphere') {
        const radius = num(c.radius, `${path}.radius`);
        if (!(radius > 0)) throw new SceneError('sphere radius must be > 0');
        return { type, shape, radius, probeSlots };
      }
      if (shape === 'box') {
        const size = vec(c.size, `${path}.size`, [NaN, NaN, NaN]);
        if (!size.every((v) => v > 0)) throw new SceneError('box size must be > 0');
        return { type, shape, size, probeSlots };
      }
      throw new SceneError(`unknown trigger shape '${shape}'`);
    }
    case 'audioEmitter':
      return {
        type,
        soundName: str(c.soundName, `${path}.soundName`),
        gain: num(c.gain, `${path}.gain`, 0),
        loops: bool(c.loops, `${path}.loops`, false),
      };
    case 'script':
      return { type, name: str(c.name, `${path}.name`) };
    default:
      throw new SceneError(`unknown component type '${type}'`);
  }
}

function parseEntity(raw: unknown, path: string): EntityDescription {
  const e = obj(raw, path);
  const name = str(e.name, `${path}.name`, '');
  const shape = str(e.shape, `${path}.shape`, 'box');
  if (shape !== 'box' && shape !== 'sphere') throw new SceneError(`${path}.shape must be box or sphere, got '${shape}'`);
  const color = e.color === undefined ? undefined : str(e.color, `${path}.color`);
  return {
    name,
    shape,
    ...(color !== undefined ? { color } : {}),
    position: vec(e.position, `${path}.position`, vec3.zero),
    rotation: tuple(e.rotation, 4, `${path}.rotation`, quat.identity) as Quat,
    scale: vec(e.scale, `${path}.scale`, [1, 1, 1]),
    components: list(e.components, `${path}.components`).map((c, i) => parseComponent(c, `${path}.components[${i}]`)),
    children: list(e.children, `${path}.children`).map((c, i) => parseEntity(c, `${path}.children[${i}]`)),
  };
}

/** Validates a scene's `inputs` block. Defaults: no head, no position, no heart rate, no gestures, 1 to 32 players. */
export function parseInputs(raw: unknown): SceneInputs {
  const o = obj(raw, 'inputs');
  const gestures = list(o.gestures ?? [], 'inputs.gestures').map((g, i) => {
    if (!(GESTURE_TYPES as readonly unknown[]).includes(g)) throw new SceneError(`inputs.gestures[${i}]: unknown gesture '${String(g)}'`);
    return g as GestureType;
  });
  const p = list(o.players ?? [1, 32], 'inputs.players');
  const [min, max] = p;
  if (p.length !== 2 || !Number.isInteger(min) || !Number.isInteger(max) || (min as number) < 1 || (max as number) > 32 || (min as number) > (max as number)) {
    throw new SceneError(`inputs.players must be [min, max] whole numbers with 1 <= min <= max <= 32`);
  }
  return {
    head: bool(o.head, 'inputs.head', false),
    position: bool(o.position, 'inputs.position', false),
    heartRate: bool(o.heartRate, 'inputs.heartRate', false),
    gestures: [...new Set(gestures)],
    players: [min as number, max as number],
  };
}

/** Validates a scene's `gestures` block (custom motion gestures). Names must not shadow a built-in gesture. */
export function parseGestures(raw: unknown): Record<string, CustomGesture> {
  const out: Record<string, CustomGesture> = {};
  for (const [name, def] of Object.entries(obj(raw ?? {}, 'gestures'))) {
    const path = `gestures.${name}`;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name)) throw new SceneError(`${path}: name must be a letter then letters, digits or _ (32 max)`);
    if ((GESTURE_TYPES as readonly string[]).includes(name)) throw new SceneError(`${path}: '${name}' is a built-in gesture`);
    const g = obj(def, path);
    const slot = str(g.slot, `${path}.slot`, 'hand');
    if (!(SLOTS as readonly string[]).includes(slot)) throw new SceneError(`${path}.slot: unknown slot '${slot}'`);
    const axis = vec(g.axis, `${path}.axis`, [0, 0, -1]);
    const len = vec3.length(axis);
    if (!(len > 0)) throw new SceneError(`${path}.axis must not be zero`);
    const threshold = num(g.threshold, `${path}.threshold`, 20);
    if (!(threshold > 0)) throw new SceneError(`${path}.threshold must be > 0`);
    const cooldownMs = num(g.cooldownMs, `${path}.cooldownMs`, 400);
    if (cooldownMs < 0) throw new SceneError(`${path}.cooldownMs must be >= 0`);
    out[name] = { slot: slot as Slot, axis: axis.map((v) => v / len) as unknown as Vec3, threshold, cooldownMs };
  }
  return out;
}

/** Validates parsed scene JSON. Throws `SceneError` with the Swift loader's messages. */
export function parseScene(input: unknown): SceneDescription {
  const s = obj(input, 'scene');
  const requiredTier = num(s.requiredTier, 'requiredTier', 1);
  if (!Number.isInteger(requiredTier) || requiredTier < 1 || requiredTier > 3)
    throw new SceneError(`requiredTier must be 1...3, got ${requiredTier}`);
  const runMode = str(s.runMode, 'runMode', 'screen');
  if (runMode !== 'screen' && runMode !== 'device') throw new SceneError(`runMode must be screen or device, got '${runMode}'`);
  const names = (x: unknown, path: string) => list(x, path).map((n, i) => str(n, `${path}[${i}]`));
  return {
    name: str(s.name, 'name', ''),
    requiredTier,
    playerOrigin: vec(s.playerOrigin, 'playerOrigin', vec3.zero),
    runMode,
    permissions: { location: bool(obj(s.permissions ?? {}, 'permissions').location, 'permissions.location', false) },
    inputs: s.inputs === undefined || s.inputs === null ? null : parseInputs(s.inputs),
    gestures: parseGestures(s.gestures),
    clientScripts: names(s.clientScripts, 'clientScripts'),
    serverScripts: names(s.serverScripts, 'serverScripts'),
    entities: list(s.entities, 'entities').map((e, i) => parseEntity(e, `entities[${i}]`)),
  };
}

/** An entity with its transform resolved to world space. `id` is the slash-joined name path, unique per scene. */
export interface WorldEntity {
  id: string;
  name: string;
  parentId: string | null;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  shape: EntityShape;
  color?: string;
  components: ComponentDescription[];
}

/**
 * Depth-first, tree order. Shortcut: child scale is applied to child position without shear, so a non-uniform
 * parent scale combined with a rotated child is approximate; upgrade to full matrices if a game needs it.
 */
export function flattenScene(scene: SceneDescription): WorldEntity[] {
  const out: WorldEntity[] = [];
  const visit = (e: EntityDescription, parent: WorldEntity | null, taken: Set<string>) => {
    let id = parent ? `${parent.id}/${e.name}` : e.name;
    for (let n = 2; taken.has(id); n++) id = `${parent ? `${parent.id}/` : ''}${e.name}#${n}`;
    taken.add(id);
    const world: WorldEntity = parent
      ? {
          id, name: e.name, parentId: parent.id, components: e.components,
          position: vec3.add(parent.position, quat.rotate(parent.rotation, vec3.mul(parent.scale, e.position))),
          rotation: quat.mul(parent.rotation, e.rotation),
          scale: vec3.mul(parent.scale, e.scale),
          shape: e.shape, ...(e.color !== undefined ? { color: e.color } : {}),
        }
      : { id, name: e.name, parentId: null, components: e.components, position: e.position, rotation: e.rotation, scale: e.scale, shape: e.shape, ...(e.color !== undefined ? { color: e.color } : {}) };
    out.push(world);
    const siblings = new Set<string>();
    for (const child of e.children) visit(child, world, siblings);
  };
  const roots = new Set<string>();
  for (const e of scene.entities) visit(e, null, roots);
  return out;
}

/** The script name of an entity's `script` component, if any. */
export function scriptName(entity: Pick<WorldEntity, 'components'>): string | undefined {
  for (const c of entity.components) if (c.type === 'script') return c.name;
  return undefined;
}
