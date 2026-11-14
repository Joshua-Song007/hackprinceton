// Script evaluation core. Plain TypeScript with no DOM and no Worker APIs, so Node tests run it directly and
// worker.ts stays a thin wrapper. Mirrors ScriptEngine.swift: one scope per script name (prelude evaluated into
// it first), a leading `export default` rewritten to `__omniExportDefault(`...`)`, handlers called as
// (self, ctx, ...args) with `self` per entity and one shared `ctx`.
// Kept erasable-syntax only (no parameter properties or enums) so Node can run it with type stripping.

export type LogLevel = 'log' | 'warn' | 'error';

/** What a handler asked the host to do. `log` entries are console output. */
export type ScriptOutput =
  | { kind: 'haptic'; pattern: string; intensity: number }
  | { kind: 'remote'; name: string; data: unknown }
  | { kind: 'audio'; entity: string; action: 'play' | 'stop'; sound?: string }
  | { kind: 'spawn'; name: string }
  | { kind: 'log'; level: LogLevel; text: string };

export interface EntityRef {
  /** Stable entity id (selves are kept per id). */
  id: string;
  name: string;
  position: readonly [number, number, number];
}

export interface HandlerCall {
  script: string;
  entity: EntityRef;
  handler: string;
  /** Arguments after (self, ctx). */
  args: unknown[];
  /** Sets `ctx.intensity` before the call (Swift sets it on heart-rate events). */
  intensity?: number;
}

export interface CallResult {
  outputs: ScriptOutput[];
  /** `script.handler: message`; the handler's effects before the throw are still in `outputs`. */
  error?: string;
}

/** Same rewrite as ScriptEngine.rewriteExportDefault: the first line-leading `export default X` becomes `__omniExportDefault(X);`. */
export function rewriteExportDefault(source: string): string {
  const match = /^\s*export\s+default\s+/m.exec(source);
  if (!match) return source;
  const body = source.slice(match.index + match[0].length).replace(/[\s;]+$/, '');
  return source.slice(0, match.index) + '__omniExportDefault(' + body + ');';
}

/**
 * The 1-based script line of the innermost frame in a V8 stack for code compiled by `load` (`<anonymous>:L:C`), else undefined.
 * new Function adds 2 header lines, then `with (this) {` and the prelude come before the script.
 */
export function scriptLine(e: unknown, prelude: string): number | undefined {
  const m = /<anonymous>:(\d+):\d+/.exec(e instanceof Error ? e.stack ?? '' : '');
  const line = m ? Number(m[1]) - 3 - prelude.split('\n').length : 0;
  return line > 0 ? line : undefined; // shortcut: V8 stack format only; WebKit (macOS desktop) reports no line
}

// shortcut: shadowing these names is not a security boundary (sloppy-mode `this` still reaches the worker global);
// the Worker itself is: no DOM, no page storage, no tokens. Upgrade to a realm/ShadowRealm when one is available.
const SHADOWED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'postMessage', 'Worker', 'SharedWorker',
  'indexedDB', 'caches', 'self', 'globalThis', 'window', 'document', 'navigator', 'location', 'close', 'onmessage',
];

const text = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

interface SelfObject {
  readonly name: string;
  speed: number;
  position: number[];
  audio: { play(sound: string): void; stop(): void };
}

interface Loaded {
  definition: Record<string, unknown>;
}

export class ScriptRuntime {
  private prelude: string;
  private scripts = new Map<string, Loaded>();
  private selves = new Map<string, SelfObject>();
  private outputs: ScriptOutput[] = [];
  private ctx: { intensity: number; remote: { fire(name: string, data?: unknown): void }; spawn(name: string): void; haptic(pattern: string, intensity: number): void };

  constructor(prelude: string) {
    this.prelude = prelude;
    this.ctx = {
      intensity: 0,
      remote: { fire: (name, data) => this.push({ kind: 'remote', name: String(name), data: data === undefined ? null : JSON.parse(JSON.stringify(data)) }) },
      spawn: (name) => this.push({ kind: 'spawn', name: String(name) }),
      haptic: (pattern, intensity) =>
        this.push({ kind: 'haptic', pattern: String(pattern), intensity: Number.isFinite(intensity) ? intensity : 0 }),
    };
  }

  get loadedScriptNames(): string[] {
    return [...this.scripts.keys()].sort();
  }

  private push(o: ScriptOutput): void {
    this.outputs.push(o);
  }

  /** Compiles `source` in a fresh scope and (re)places script `name`. On failure the previous version stays. Throws Error(message). */
  load(name: string, source: string): void {
    const scope: Record<string, unknown> = Object.create(null);
    for (const n of SHADOWED) scope[n] = undefined;
    const log = (level: LogLevel) => (...a: unknown[]) => this.push({ kind: 'log', level, text: a.map(text).join(' ') });
    scope.console = { log: log('log'), info: log('log'), debug: log('log'), warn: log('warn'), error: log('error') };
    let taken: unknown;
    try {
      // `with` resolves script/serverScript/__omni* (set by the prelude on `this`) and console from `scope`.
      const run = new Function(`with (this) {\n${this.prelude}\n${rewriteExportDefault(source)}\n}\nreturn this.__omniTakeDefault();`);
      taken = run.call(scope);
    } catch (e) {
      throw new Error(String(e));
    }
    if (typeof taken !== 'object' || taken === null) throw new Error(`script '${name}': no default export`);
    this.scripts.set(name, { definition: taken as Record<string, unknown> });
  }

  unload(name: string): void {
    this.scripts.delete(name);
  }

  call(c: HandlerCall): CallResult {
    const loaded = this.scripts.get(c.script);
    if (!loaded) return { outputs: [], error: `${c.script}: not loaded` };
    const fn = loaded.definition[c.handler];
    if (typeof fn !== 'function') return { outputs: [] };
    const self = this.selfFor(c.entity);
    self.position = [...c.entity.position];
    if (c.intensity !== undefined) this.ctx.intensity = c.intensity;
    this.outputs = [];
    let error: string | undefined;
    try {
      fn(self, this.ctx, ...c.args);
    } catch (e) {
      const line = scriptLine(e, this.prelude);
      error = `${c.script}.${c.handler}: ${String(e)}${line ? ` (line ${line})` : ''}`;
    }
    return { outputs: this.outputs, error };
  }

  private selfFor(entity: EntityRef): SelfObject {
    let self = this.selves.get(entity.id);
    if (!self) {
      self = {
        name: entity.name,
        speed: 1,
        position: [...entity.position],
        audio: {
          play: (sound) => this.push({ kind: 'audio', entity: entity.id, action: 'play', sound: String(sound) }),
          stop: () => this.push({ kind: 'audio', entity: entity.id, action: 'stop' }),
        },
      };
      this.selves.set(entity.id, self);
    }
    return self;
  }
}

/** Messages the main thread sends. `id` 0 means no reply is awaited. */
export type WorkerRequest =
  | { type: 'init'; id: number; prelude: string }
  | { type: 'load'; id: number; name: string; source: string }
  | { type: 'unload'; id: number; name: string }
  | ({ type: 'call'; id: number } & HandlerCall);

export interface WorkerReply extends Partial<CallResult> {
  id: number;
}

/** The slice of a dedicated worker's global scope that `attachWorker` needs. */
export interface WorkerScope {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

/** Wires a ScriptRuntime to a worker scope. This is all worker.ts does. */
export function attachWorker(scope: WorkerScope): void {
  let runtime: ScriptRuntime | undefined;
  scope.onmessage = (event) => {
    const m = event.data as WorkerRequest;
    const reply = (r: Partial<CallResult>) => m.id !== 0 && scope.postMessage({ id: m.id, ...r });
    try {
      if (m.type === 'init') {
        runtime = new ScriptRuntime(m.prelude);
        return void reply({});
      }
      if (!runtime) return void reply({ error: 'sandbox not initialised' });
      if (m.type === 'load') {
        runtime.load(m.name, m.source);
        reply({});
      } else if (m.type === 'unload') {
        runtime.unload(m.name);
        reply({});
      } else {
        reply(runtime.call(m));
      }
    } catch (e) {
      reply({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}
