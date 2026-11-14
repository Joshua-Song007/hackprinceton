// In-page server-script host for "Play": runs a game's server scripts with the same `serverScript` API and limits as
// Backend/src/game_server/script_host.rs (ctx.state, remote.fire / fireAll, now, after / cancel, onTimer), so a game
// can be tested with no account and no backend. Plain TypeScript, no DOM, so Node tests drive it directly.
// shortcut: runs on the calling thread, so there is no 1 s CPU cap like the Rust host has; a script's own infinite loop
// hangs the Studio tab. Upgrade to a Worker like ScriptSandbox if that bites.
import { SHADOWED, rewriteExportDefault, type LogLevel } from './evaluate';

export const MIN_TIMER_MS = 50;
export const MAX_TIMER_MS = 3_600_000;
export const MAX_TIMERS = 64;

export interface LocalServerOptions {
  /** prelude.js source (shared with Swift and Rust). */
  prelude: string;
  /** Player id (null = everyone), event name, JSON-safe data. */
  onFire(player: string | null, name: string, data: unknown): void;
  onLog?(level: LogLevel, text: string): void;
  onError?(message: string): void;
  /** `ctx.state` as JSON text, after a handler changed it. */
  onState?(json: string): void;
  now?(): number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

const text = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};
const clone = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

export class LocalServer {
  private scripts: Record<string, unknown>[] = [];
  private names = new Map<string, string>();
  private timers = new Map<number, { handle: unknown }>();
  private nextTimer = 1;
  private lastState = '{}';
  private state: Record<string, unknown> = {};
  private ctx: Readonly<Record<string, unknown>>;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (handle: unknown) => void;

  constructor(private options: LocalServerOptions) {
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.ctx = Object.freeze({
      state: this.state,
      remote: Object.freeze({
        fire: (player: unknown, name: unknown, data?: unknown) => this.options.onFire(String(player), String(name), clone(data)),
        fireAll: (name: unknown, data?: unknown) => this.options.onFire(null, String(name), clone(data)),
      }),
      now: () => (this.options.now ?? Date.now)(),
      after: (ms: unknown, tag: unknown, data?: unknown) => this.after(Number(ms), String(tag), clone(data)),
      cancel: (id: unknown) => this.cancel(Number(id)),
    });
  }

  /** Compiles every source into one shared ctx.state, in order. Throws Error(message) for a script that does not load. */
  load(sources: string[]): void {
    for (const source of sources) {
      const scope: Record<string, unknown> = Object.create(null);
      for (const n of SHADOWED) scope[n] = undefined;
      const log = (level: LogLevel) => (...a: unknown[]) => this.options.onLog?.(level, a.map(text).join(' '));
      scope.console = { log: log('log'), info: log('log'), debug: log('log'), warn: log('warn'), error: log('error') };
      let taken: unknown;
      try {
        const run = new Function(`with (this) {\n${this.options.prelude}\n${rewriteExportDefault(source)}\n}\nreturn this.__omniTakeDefault();`);
        taken = run.call(scope);
      } catch (e) {
        throw new Error(String(e));
      }
      if (typeof taken !== 'object' || taken === null) throw new Error('script does not export default serverScript({...})');
      this.scripts.push(taken as Record<string, unknown>);
    }
  }

  join(id: string, name = ''): void {
    this.names.set(id, name);
    this.dispatch('onPlayerJoin', this.player(id));
  }

  leave(id: string): void {
    this.dispatch('onPlayerLeave', this.player(id));
    this.names.delete(id);
  }

  remote(id: string, name: string, data: unknown): void {
    this.dispatch('onRemote', this.player(id), name, data === undefined ? null : data);
  }

  stateJSON(): string {
    return JSON.stringify(this.state);
  }

  get pendingTimers(): number {
    return this.timers.size;
  }

  dispose(): void {
    for (const t of this.timers.values()) this.clearTimer(t.handle);
    this.timers.clear();
  }

  private player(id: string) {
    return Object.freeze({ id, name: this.names.get(id) ?? '' });
  }

  private after(ms: number, tag: string, data: unknown): number {
    const id = this.nextTimer++;
    if (this.timers.size >= MAX_TIMERS) {
      this.options.onError?.(`ctx.after: at most ${MAX_TIMERS} timers pending, this one was dropped`);
      return id;
    }
    const delay = Math.min(MAX_TIMER_MS, Math.max(MIN_TIMER_MS, Number.isFinite(ms) ? ms : 0));
    const handle = this.setTimer(() => {
      this.timers.delete(id);
      this.dispatch('onTimer', tag, data);
    }, delay);
    this.timers.set(id, { handle });
    return id;
  }

  private cancel(id: number): void {
    const t = this.timers.get(id);
    if (!t) return;
    this.clearTimer(t.handle);
    this.timers.delete(id);
  }

  /** Runs `handler(ctx, ...args)` on every script that has it; a throw is reported and the next script still runs. */
  private dispatch(handler: string, ...args: unknown[]): void {
    for (const script of this.scripts) {
      const fn = script[handler];
      if (typeof fn !== 'function') continue;
      try {
        fn.call(script, this.ctx, ...args);
      } catch (e) {
        this.options.onError?.(`${handler}: ${String(e)}`);
      }
    }
    const json = this.stateJSON();
    if (json !== this.lastState) {
      this.lastState = json;
      this.options.onState?.(json);
    }
  }
}
