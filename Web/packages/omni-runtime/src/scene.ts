// scene.json loader. Same shape, defaults and error messages as SceneDescription.swift + SceneLoader.swift.
import { SLOTS, quat, vec3, type Quat, type Slot, type Vec3 } from '@omni/core';

export class SceneError extends Error {
  override name = 'SceneError';
}

export type RunMode = 'screen' | 'device';
export type ComponentDescription =
  | { type: 'trigger'; shape: 'sphere'; radius: number; probeSlots: Slot[] }
  | { type: 'trigger'; shape: 'box'; size: Vec3; probeSlots: Slot[] }
  | { type: 'audioEmitter'; soundName: string; gain: number; loops: boolean }
  | { type: 'script'; name: string };

export interface EntityDescription {
  name: string;
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
  clientScripts: string[];
  serverScripts: string[];
  entities: EntityDescription[];
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
  return {
    name,
    position: vec(e.position, `${path}.position`, vec3.zero),
    rotation: tuple(e.rotation, 4, `${path}.rotation`, quat.identity) as Quat,
    scale: vec(e.scale, `${path}.scale`, [1, 1, 1]),
    components: list(e.components, `${path}.components`).map((c, i) => parseComponent(c, `${path}.components[${i}]`)),
    children: list(e.children, `${path}.children`).map((c, i) => parseEntity(c, `${path}.children[${i}]`)),
  };
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
        }
      : { id, name: e.name, parentId: null, components: e.components, position: e.position, rotation: e.rotation, scale: e.scale };
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
