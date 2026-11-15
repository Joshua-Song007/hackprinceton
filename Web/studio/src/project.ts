// Project model: scene JSON + client/server script sources + cloud link, dirty tracking and IndexedDB autosave.
// The Flagship template is imported from Games/Flagship through Vite (never copied into the Studio).
import type { GameVersion, NewGameVersion } from '@pear/cloud';
import { parseGestures, parseInputs, parsePeripherals, parseRaise, parseScene, type CustomGesture, type PeripheralKind, type SceneDescription, type SceneInputs } from '@pear/runtime';
import flagshipScene from '../../../Games/Flagship/scene.json';
import hotPotatoScene from '../../../Games/HotPotato/scene.json';
import { blankClientScripts, blankScene, blankServerScripts } from './templates/blank';

const flagshipFiles = import.meta.glob('../../../Games/Flagship/scripts/*.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const flagshipScripts = Object.fromEntries(Object.entries(flagshipFiles).map(([path, src]) => [/([^/]+)\.js$/.exec(path)![1]!, src]));
const hotPotatoFiles = import.meta.glob('../../../Games/HotPotato/scripts/*.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const hotPotatoScripts = Object.fromEntries(Object.entries(hotPotatoFiles).map(([path, src]) => [/([^/]+)\.js$/.exec(path)![1]!, src]));

export type ScriptKind = 'client' | 'server';
export type SceneJson = Record<string, unknown>;
export type RawEntity = Record<string, unknown> & { name?: string; children?: RawEntity[]; components?: Record<string, unknown>[] };

export interface ProjectSnapshot {
  scene: SceneJson;
  clientScripts: Record<string, string>;
  serverScripts: Record<string, string>;
  gameId: string | null;
  version: number | null;
}

export type ProjectChange = 'open' | 'scene' | 'script' | 'scripts' | 'saved' | 'cloud';

export const TEMPLATES = [
  { id: 'blank', label: 'Blank', blurb: 'A floor, one cube, a client script and a server script that counts taps. The smallest working loop.' },
  { id: 'hotpotato', label: 'Hot potato', blurb: 'Multiplayer tag: the holder is eliminated when a timer runs out. Teaches server timers, positions and remote events.' },
  { id: 'flagship', label: 'Flagship (Hollow Choir)', blurb: 'Audio and heart-rate horror game using head tracking, gestures and a server-run round.' },
] as const;
export type TemplateId = (typeof TEMPLATES)[number]['id'];

export function templateSnapshot(id: TemplateId): ProjectSnapshot {
  if (id === 'blank') {
    return structuredClone({ scene: blankScene, clientScripts: blankClientScripts, serverScripts: blankServerScripts, gameId: null, version: null });
  }
  const potato = id === 'hotpotato';
  const scene = structuredClone(potato ? hotPotatoScene : flagshipScene) as SceneJson;
  const scripts = potato ? hotPotatoScripts : flagshipScripts;
  const pick = (names: unknown) => Object.fromEntries(((names as string[] | undefined) ?? []).map((n) => [n, scripts[n] ?? '']));
  return { scene, clientScripts: pick(scene.clientScripts), serverScripts: pick(scene.serverScripts), gameId: null, version: null };
}

export const SCRIPT_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const SCRIPT_STUBS: Record<ScriptKind, string> = {
  client: 'export default script({\n  onLookAt(self, ctx) {\n  },\n});\n',
  server: 'export default serverScript({\n  onRemote(ctx, player, name, data) {\n  },\n});\n',
};

/** Visits every raw entity with the same id `flattenScene` gives it (slash-joined names, `#n` for duplicates). */
export function walkEntities(scene: SceneJson, visit: (entity: RawEntity, id: string, siblings: RawEntity[]) => void): void {
  const level = (list: RawEntity[], parentId: string | null) => {
    const taken = new Set<string>();
    for (const e of list) {
      const name = typeof e.name === 'string' ? e.name : '';
      const prefix = parentId === null ? '' : `${parentId}/`;
      let id = prefix + name;
      for (let n = 2; taken.has(id); n++) id = `${prefix}${name}#${n}`;
      taken.add(id);
      visit(e, id, list);
      level(e.children ?? [], id);
    }
  };
  level((scene.entities as RawEntity[] | undefined) ?? [], null);
}

function defaultComponent(type: 'script' | 'trigger' | 'audioEmitter', p: { clientScripts: Record<string, string> }): Record<string, unknown> {
  if (type === 'trigger') return { type, shape: 'sphere', radius: 1, probeSlots: ['head'] };
  if (type === 'audioEmitter') return { type, soundName: '', gain: 1, loops: false };
  return { type, name: Object.keys(p.clientScripts)[0] ?? '' };
}

type V3 = [number, number, number];
type Q4 = [number, number, number, number];
const DEG = Math.PI / 180;

/** Euler degrees (yaw Y, pitch X, roll Z; applied Y then X then Z) to a unit quaternion [x, y, z, w]. */
export function eulerToQuat([x, y, z]: V3): Q4 {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x * DEG / 2), Math.sin(x * DEG / 2), Math.cos(y * DEG / 2), Math.sin(y * DEG / 2), Math.cos(z * DEG / 2), Math.sin(z * DEG / 2)];
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
}

/** Inverse of `eulerToQuat`; pitch is clamped to +-90 degrees, so gimbal-lock poses return roll 0. */
export function quatToEuler(q: readonly number[]): V3 {
  const [x, y, z, w] = q as Q4;
  const m23 = 2 * (y * z - x * w);
  const pitch = Math.asin(-Math.max(-1, Math.min(1, m23)));
  const [yaw, roll] = Math.abs(m23) < 0.9999999 ? [Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y)), Math.atan2(2 * (x * y + z * w), 1 - 2 * (x * x + z * z))] : [Math.atan2(-2 * (x * z - y * w), 1 - 2 * (y * y + z * z)), 0];
  return [pitch / DEG, yaw / DEG, roll / DEG];
}

export class Project {
  scene: SceneJson = {};
  clientScripts: Record<string, string> = {};
  serverScripts: Record<string, string> = {};
  gameId: string | null = null;
  version: number | null = null;
  dirty = false;
  private listeners = new Set<(change: ProjectChange) => void>();

  constructor(snapshot: ProjectSnapshot = templateSnapshot('flagship')) {
    this.load(snapshot);
  }

  get name(): string {
    return typeof this.scene.name === 'string' && this.scene.name ? this.scene.name : 'Untitled';
  }

  onChange(listener: (change: ProjectChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: ProjectChange): void {
    for (const l of this.listeners) l(change);
  }

  // shortcut: whole-project snapshots, script typing merged into one step per 500 ms; fine for small games, switch to patches if projects grow large.
  private baseline: ProjectSnapshot | null = null;
  private undoStack: ProjectSnapshot[] = [];
  private redoStack: ProjectSnapshot[] = [];
  private lastTouchMs = 0;

  private touch(change: ProjectChange): void {
    const now = Date.now();
    if (this.baseline && (change !== 'script' || now - this.lastTouchMs > 500)) {
      this.undoStack.push(this.baseline);
      if (this.undoStack.length > 50) this.undoStack.shift();
    }
    this.lastTouchMs = now;
    this.redoStack = [];
    this.baseline = this.snapshot();
    this.dirty = true;
    this.emit(change);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev || !this.baseline) return;
    this.redoStack.push(this.baseline);
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next || !this.baseline) return;
    this.undoStack.push(this.baseline);
    this.restore(next);
  }

  private restore(s: ProjectSnapshot): void {
    this.apply(structuredClone(s));
    this.baseline = s;
    this.dirty = true;
    this.emit('open');
  }

  private apply(s: ProjectSnapshot): void {
    this.scene = s.scene;
    this.clientScripts = s.clientScripts;
    this.serverScripts = s.serverScripts;
    this.gameId = s.gameId;
    this.version = s.version;
  }

  /** Replaces the whole project (open template, open from cloud, restore draft); clean afterwards. */
  load(s: ProjectSnapshot): void {
    this.apply(s);
    this.undoStack = [];
    this.redoStack = [];
    this.baseline = this.snapshot();
    this.dirty = false;
    this.emit('open');
  }

  snapshot(): ProjectSnapshot {
    return structuredClone({ scene: this.scene, clientScripts: this.clientScripts, serverScripts: this.serverScripts, gameId: this.gameId, version: this.version });
  }

  /** Link to a cloud game (not an edit, so not dirty). */
  setCloud(gameId: string | null, version: number | null): void {
    this.gameId = gameId;
    this.version = version;
    this.emit('cloud');
  }

  markSaved(): void {
    this.dirty = false;
    this.emit('saved');
  }

  /** Throws `SceneError` when the scene JSON is invalid. */
  description(): SceneDescription {
    return parseScene(this.scene);
  }

  scripts(kind: ScriptKind): Record<string, string> {
    return kind === 'client' ? this.clientScripts : this.serverScripts;
  }

  setScript(kind: ScriptKind, name: string, source: string): void {
    if (this.scripts(kind)[name] === source) return;
    this.scripts(kind)[name] = source;
    this.touch('script');
  }

  /**
   * Replaces the scene (the Deep Agent's scene.json) as one undoable step. The script lists follow the
   * project's scripts, not the given JSON. Returns an error sentence when the scene is invalid; nothing changes then.
   */
  setScene(scene: SceneJson): string | undefined {
    const next = structuredClone(scene);
    next.clientScripts = Object.keys(this.clientScripts);
    next.serverScripts = Object.keys(this.serverScripts);
    try {
      parseScene(next);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    this.scene = next;
    this.touch('scene');
  }

  private syncNames(): void {
    this.scene.clientScripts = Object.keys(this.clientScripts);
    this.scene.serverScripts = Object.keys(this.serverScripts);
  }

  /** Returns an error sentence, or undefined on success. */
  addScript(kind: ScriptKind, name: string): string | undefined {
    const bad = this.checkName(kind, name);
    if (bad) return bad;
    this.scripts(kind)[name] = SCRIPT_STUBS[kind];
    this.syncNames();
    this.touch('scripts');
  }

  renameScript(kind: ScriptKind, from: string, to: string): string | undefined {
    if (from === to) return undefined;
    const bad = this.checkName(kind, to);
    if (bad) return bad;
    const scripts = this.scripts(kind);
    const renamed: Record<string, string> = {};
    for (const [k, v] of Object.entries(scripts)) renamed[k === from ? to : k] = v;
    if (kind === 'client') this.clientScripts = renamed;
    else this.serverScripts = renamed;
    walkEntities(this.scene, (e) => {
      for (const c of e.components ?? []) if (kind === 'client' && c.type === 'script' && c.name === from) c.name = to;
    });
    this.syncNames();
    this.touch('scripts');
  }

  deleteScript(kind: ScriptKind, name: string): void {
    delete this.scripts(kind)[name];
    this.syncNames();
    this.touch('scripts');
  }

  private checkName(kind: ScriptKind, name: string): string | undefined {
    if (!SCRIPT_NAME.test(name)) return 'Script names start with a letter and use letters, digits, - and _.';
    if (name in this.scripts(kind)) return `A ${kind} script named ${name} already exists. Pick another name.`;
    return undefined;
  }

  entity(id: string): RawEntity | undefined {
    let found: RawEntity | undefined;
    walkEntities(this.scene, (e, eid) => {
      if (eid === id) found = e;
    });
    return found;
  }

  /** Edits one entity in place and emits `scene`. Returns false when the id no longer exists. */
  updateEntity(id: string, edit: (entity: RawEntity) => void): boolean {
    const e = this.entity(id);
    if (!e) return false;
    edit(e);
    this.touch('scene');
    return true;
  }

  /** Removes an entity and its children. Returns false when the id no longer exists. */
  deleteEntity(id: string): boolean {
    let removed = false;
    walkEntities(this.scene, (e, eid, siblings) => {
      if (removed || eid !== id) return;
      siblings.splice(siblings.indexOf(e), 1);
      removed = true;
    });
    if (removed) this.touch('scene');
    return removed;
  }

  private siblingsOf(parentId: string | null): RawEntity[] | undefined {
    if (parentId === null) return ((this.scene.entities ??= []) as RawEntity[]);
    const p = this.entity(parentId);
    return p ? (p.children ??= []) : undefined;
  }

  private uniqueName(siblings: RawEntity[], base: string): string {
    const taken = new Set(siblings.map((s) => s.name));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
    return name;
  }

  /** Adds an entity under `parentId` (null = scene root); returns its id, or null when the parent no longer exists. */
  addEntity(parentId: string | null, kind: 'box' | 'sphere' | 'trigger' | 'empty', at: [number, number, number] = [0, 0, 0]): string | null {
    const id = this.pushEntity(parentId, kind, at);
    if (id !== null) this.touch('scene');
    return id;
  }

  /** `addEntity` without the change notice, so a caller can finish its own edit first. `label` replaces the kind's default name. */
  private pushEntity(parentId: string | null, kind: 'box' | 'sphere' | 'trigger' | 'empty', at: [number, number, number], label?: string): string | null {
    const siblings = this.siblingsOf(parentId);
    if (!siblings) return null;
    const name = this.uniqueName(siblings, label ?? { box: 'Box', sphere: 'Sphere', trigger: 'Trigger', empty: 'Empty' }[kind]);
    // shortcut: an empty is a small box (scene format has no mesh-less entity), upgrade when the format gains one.
    const e: RawEntity = { name, shape: kind === 'sphere' || kind === 'trigger' ? 'sphere' : 'box', position: [...at], scale: kind === 'empty' ? [0.2, 0.2, 0.2] : [1, 1, 1], components: kind === 'trigger' ? [defaultComponent('trigger', this)] : [] };
    siblings.push(e);
    return (parentId === null ? '' : `${parentId}/`) + name;
  }

  /** Deep-clones an entity (children included) next to the original; returns the new id. */
  duplicateEntity(id: string): string | null {
    let result: string | null = null;
    walkEntities(this.scene, (e, eid, siblings) => {
      if (result !== null || eid !== id) return;
      const copy = structuredClone(e);
      copy.name = this.uniqueName(siblings, String(e.name ?? ''));
      siblings.splice(siblings.indexOf(e) + 1, 0, copy);
      result = eid.slice(0, eid.lastIndexOf('/') + 1) + copy.name;
    });
    if (result !== null) this.touch('scene');
    return result;
  }

  /** Returns the new id (descendant ids change too) or an error sentence. */
  renameEntity(id: string, name: string): { id: string } | { error: string } {
    const clean = name.trim();
    if (!clean || /[/#]/.test(clean)) return { error: 'Entity names cannot be empty or contain / or #.' };
    let out: { id: string } | { error: string } = { error: 'That entity no longer exists.' };
    walkEntities(this.scene, (e, eid, siblings) => {
      if (eid !== id || 'id' in out) return;
      if (e.name === clean) return void (out = { id });
      if (siblings.some((s) => s.name === clean)) return void (out = { error: `A sibling named ${clean} already exists. Pick another name.` });
      e.name = clean;
      out = { id: id.slice(0, id.lastIndexOf('/') + 1) + clean };
      this.touch('scene');
    });
    return out;
  }

  addComponent(id: string, type: 'script' | 'trigger' | 'audioEmitter'): boolean {
    return this.updateEntity(id, (e) => (e.components ??= []).push(defaultComponent(type, this)));
  }

  removeComponent(id: string, index: number): boolean {
    const e = this.entity(id);
    if (!e?.components?.[index]) return false;
    return this.updateEntity(id, (x) => void x.components!.splice(index, 1));
  }

  /** Keys: name, requiredTier, runMode, permissions.location, playerOrigin, inputs, peripherals, gestures. Returns an error sentence, or undefined on success. */
  setSceneSetting(key: string, value: unknown): string | undefined {
    switch (key) {
      case 'name':
        if (typeof value !== 'string') return 'Scene name must be text.';
        break;
      case 'requiredTier':
        if (value !== 1 && value !== 2 && value !== 3) return 'Tier must be 1, 2 or 3.';
        break;
      case 'runMode':
        if (value !== 'screen' && value !== 'device') return 'Run mode must be screen or device.';
        break;
      case 'permissions.location':
        if (typeof value !== 'boolean') return 'Location permission must be on or off.';
        this.scene.permissions = { ...(this.scene.permissions as object | undefined), location: value };
        this.touch('scene');
        return undefined;
      case 'playerOrigin':
        if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) return 'Player origin needs three numbers.';
        break;
      case 'inputs':
        try {
          if (value !== null) parseInputs(value);
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
        if (value === null) delete this.scene.inputs;
        else this.scene.inputs = structuredClone(value);
        this.touch('scene');
        return undefined;
      case 'peripherals':
        try {
          parsePeripherals(value);
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
        if (Array.isArray(value) && value.length) this.scene.peripherals = structuredClone(value);
        else delete this.scene.peripherals;
        this.touch('scene');
        return undefined;
      case 'gestures':
        try {
          parseGestures(value);
          parseRaise((value as { raise?: unknown } | undefined)?.raise);
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
        if (value && Object.keys(value as object).length) this.scene.gestures = structuredClone(value);
        else delete this.scene.gestures;
        this.touch('scene');
        return undefined;
      default:
        return `Unknown scene setting ${key}.`;
    }
    this.scene[key] = value;
    this.touch('scene');
    return undefined;
  }

  /**
   * Changes the device fields together as one undo step: the listed `peripherals`, the declared `inputs`
   * (null removes them), the custom `gestures`, and `location` (only ever turns the permission on).
   * Returns an error sentence and changes nothing when any field is invalid.
   */
  applyPeripheralChange(change: { peripherals?: PeripheralKind[]; inputs?: SceneInputs | null; gestures?: Record<string, CustomGesture>; location?: boolean }): string | undefined {
    try {
      if (change.peripherals !== undefined) parsePeripherals(change.peripherals);
      if (change.inputs) parseInputs(change.inputs);
      if (change.gestures !== undefined) parseGestures(change.gestures);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    if (change.peripherals !== undefined) {
      if (change.peripherals.length) this.scene.peripherals = structuredClone(change.peripherals);
      else delete this.scene.peripherals;
    }
    if (change.inputs !== undefined) {
      if (change.inputs === null) delete this.scene.inputs;
      else this.scene.inputs = structuredClone(change.inputs);
    }
    if (change.gestures !== undefined) {
      // `gestures.raise` is not a motion gesture, so the Devices panel does not carry it: keep the scene's own.
      const raise = (this.scene.gestures as { raise?: unknown } | undefined)?.raise;
      const next = { ...structuredClone(change.gestures), ...(raise ? { raise } : {}) };
      if (Object.keys(next).length) this.scene.gestures = next;
      else delete this.scene.gestures;
    }
    if (change.location) this.scene.permissions = { ...(this.scene.permissions as object | undefined), location: true };
    this.touch('scene');
    return undefined;
  }

  /**
   * Adds a client script with `source` and attaches it to `entityId`, or to a new empty entity named `entityName`
   * when that is null, as one undo step. Changes nothing on an error.
   */
  addHandlerScript(entityId: string | null, entityName: string, name: string, source: string): { error: string } | { entityId: string } {
    const bad = this.checkName('client', name);
    if (bad) return { error: bad };
    if (entityId !== null && !this.entity(entityId)) return { error: 'That entity no longer exists.' };
    const id = entityId ?? this.pushEntity(null, 'empty', [0, 0, 0], entityName);
    const e = id === null ? undefined : this.entity(id);
    if (id === null || !e) return { error: 'That entity no longer exists.' };
    this.clientScripts[name] = source;
    (e.components ??= []).push({ type: 'script', name });
    this.syncNames();
    this.touch(entityId === null ? 'scene' : 'scripts');
    return { entityId: id };
  }

  /** Adds a client script stub and attaches it to the entity as one undo step. Returns an error sentence, or undefined. */
  createAndAttachScript(entityId: string, name: string): string | undefined {
    const e = this.entity(entityId);
    if (!e) return 'That entity no longer exists.';
    const bad = this.checkName('client', name);
    if (bad) return bad;
    this.clientScripts[name] = SCRIPT_STUBS.client;
    (e.components ??= []).push({ type: 'script', name });
    this.syncNames();
    this.touch('scripts');
  }

  /** The body of a `POST /api/games/{id}/versions` request. */
  toVersion(): NewGameVersion {
    this.syncNames();
    return {
      scene: this.scene,
      client_scripts: this.clientScripts,
      server_scripts: this.serverScripts,
      assets: {},
      metadata: { name: this.name, source: 'pear-studio' },
      run_mode: this.description().runMode,
    };
  }

  static snapshotOfVersion(v: GameVersion): ProjectSnapshot {
    return { scene: v.scene, clientScripts: v.client_scripts, serverScripts: v.server_scripts, gameId: v.game_id, version: v.version };
  }
}

// IndexedDB autosave: one recovery copy of the current project, restored on the next start.
const DB_NAME = 'pear-studio';
const STORE = 'drafts';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

// The time is written after the snapshot and its failure is swallowed, so it can never raise the autosave-failed report.
export const saveDraft = (s: ProjectSnapshot): Promise<unknown> => withStore('readwrite', (st) => st.put(s, 'current')).then(() => withStore('readwrite', (st) => st.put(Date.now(), 'current-at')).catch(() => undefined));
export const loadDraft = (): Promise<ProjectSnapshot | undefined> => withStore('readonly', (st) => st.get('current') as IDBRequest<ProjectSnapshot | undefined>);
/** Removes the stored draft. The time is removed second and its failure swallowed, like `saveDraft`. */
export const deleteDraft = (): Promise<unknown> => withStore('readwrite', (st) => st.delete('current')).then(() => withStore('readwrite', (st) => st.delete('current-at')).catch(() => undefined));
/** ms since epoch of the last draft save; undefined for a draft saved before this was recorded. */
export const loadDraftAt = (): Promise<number | undefined> => withStore('readonly', (st) => st.get('current-at') as IDBRequest<number | undefined>);

/** Saves the draft 800 ms after the last edit. Failures (private mode, no IndexedDB) are reported once through `onError`. */
export function attachAutosave(project: Project, onError: (message: string) => void, delayMs = 800): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reported = false;
  const flush = () => saveDraft(project.snapshot()).catch(() => {
    if (!reported) onError('Autosave is unavailable in this browser. Use Publish to keep your work.');
    reported = true;
  });
  const off = project.onChange((c) => {
    if (c === 'saved') return void flush();
    if (c === 'cloud') return;
    clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  });
  return () => {
    off();
    clearTimeout(timer);
  };
}
