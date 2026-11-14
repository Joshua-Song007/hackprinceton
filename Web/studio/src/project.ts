// Project model: scene JSON + client/server script sources + cloud link, dirty tracking and IndexedDB autosave.
// The Flagship template is imported from Games/Flagship through Vite (never copied into the Studio).
import type { GameVersion, NewGameVersion } from '@omni/cloud';
import { parseScene, type SceneDescription } from '@omni/runtime';
import flagshipScene from '../../../Games/Flagship/scene.json';
import { blankClientScripts, blankScene, blankServerScripts } from './templates/blank';

const flagshipFiles = import.meta.glob('../../../Games/Flagship/scripts/*.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const flagshipScripts = Object.fromEntries(Object.entries(flagshipFiles).map(([path, src]) => [/([^/]+)\.js$/.exec(path)![1]!, src]));

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
  { id: 'flagship', label: 'Flagship (Hollow Choir)' },
  { id: 'blank', label: 'Blank' },
] as const;
export type TemplateId = (typeof TEMPLATES)[number]['id'];

export function templateSnapshot(id: TemplateId): ProjectSnapshot {
  if (id === 'blank') {
    return structuredClone({ scene: blankScene, clientScripts: blankClientScripts, serverScripts: blankServerScripts, gameId: null, version: null });
  }
  const scene = structuredClone(flagshipScene) as SceneJson;
  const pick = (names: unknown) => Object.fromEntries(((names as string[] | undefined) ?? []).map((n) => [n, flagshipScripts[n] ?? '']));
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

  private touch(change: ProjectChange): void {
    this.dirty = true;
    this.emit(change);
  }

  /** Replaces the whole project (open template, open from cloud, restore draft); clean afterwards. */
  load(s: ProjectSnapshot): void {
    this.scene = s.scene;
    this.clientScripts = s.clientScripts;
    this.serverScripts = s.serverScripts;
    this.gameId = s.gameId;
    this.version = s.version;
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

  /** The body of a `POST /api/games/{id}/versions` request. */
  toVersion(): NewGameVersion {
    this.syncNames();
    return {
      scene: this.scene,
      client_scripts: this.clientScripts,
      server_scripts: this.serverScripts,
      assets: {},
      metadata: { name: this.name, source: 'omni-studio' },
      run_mode: this.description().runMode,
    };
  }

  static snapshotOfVersion(v: GameVersion): ProjectSnapshot {
    return { scene: v.scene, clientScripts: v.client_scripts, serverScripts: v.server_scripts, gameId: v.game_id, version: v.version };
  }
}

// IndexedDB autosave: one recovery copy of the current project, restored on the next start.
const DB_NAME = 'omni-studio';
const STORE = 'drafts';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

export const saveDraft = (s: ProjectSnapshot): Promise<unknown> => withStore('readwrite', (st) => st.put(s, 'current'));
export const loadDraft = (): Promise<ProjectSnapshot | undefined> => withStore('readonly', (st) => st.get('current') as IDBRequest<ProjectSnapshot | undefined>);

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
