// Main-thread side of the client script sandbox: one Web Worker per run, a per-call watchdog, and routing of
// console output and errors to the Studio Output tab (`onLog`).
// Prelude comes from the shared repo file, never a copy.
import preludeSource from '../../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js?raw';
import type { HandlerCall, LogLevel, ScriptOutput, WorkerReply, WorkerRequest } from './evaluate';

export const DEFAULT_WATCHDOG_MS = 250;
const START_TIMEOUT_MS = 10_000;

/** The slice of `Worker` the sandbox uses. Tests pass a Node `worker_threads` adapter. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export interface LogEntry {
  level: LogLevel;
  text: string;
  /** Script name, when known. */
  script?: string;
}

export interface SandboxOptions {
  /** Defaults to a module Worker on ./worker.ts. */
  createWorker?: () => WorkerLike;
  prelude?: string;
  watchdogMs?: number;
  /** Console output and script errors (level `error`). */
  onLog?: (entry: LogEntry) => void;
}

export interface SandboxResult {
  /** Effects of the handler, `log` entries excluded (those go to `onLog`). */
  outputs: Exclude<ScriptOutput, { kind: 'log' }>[];
  error?: string;
}

const defaultWorker = (): WorkerLike =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export class ScriptSandbox {
  private options: SandboxOptions;
  private worker: WorkerLike | null = null;
  private waiting: ((reply: WorkerReply) => void) | null = null;
  private nextId = 1;
  private sources = new Map<string, string>();
  private chain: Promise<unknown> = Promise.resolve();
  /** Every error reported since creation, oldest first. */
  readonly errors: string[] = [];

  constructor(options: SandboxOptions = {}) {
    this.options = options;
  }

  /** Compiles and registers a script. Rejects with the engine's message (e.g. prelude's "unknown handler"). */
  loadScript(name: string, source: string): Promise<void> {
    return this.enqueue(async () => {
      const reply = await this.request({ type: 'load', name, source }, `load ${name}`);
      if (reply.error) throw new Error(reply.error);
      this.sources.set(name, source);
    });
  }

  unloadScript(name: string): Promise<void> {
    return this.enqueue(async () => {
      this.sources.delete(name);
      await this.request({ type: 'unload', name }, `unload ${name}`);
    });
  }

  /**
   * Runs one handler. Never rejects: a throwing handler or a watchdog kill comes back as `error`, is pushed to
   * `errors` and reported through `onLog`. After a kill the next call starts a fresh worker with the same scripts
   * (per-entity `self` state is lost).
   */
  call(call: HandlerCall): Promise<SandboxResult> {
    return this.enqueue(async () => {
      const reply = await this.request({ type: 'call', ...call }, `${call.script}.${call.handler}`);
      const outputs: SandboxResult['outputs'] = [];
      for (const o of reply.outputs ?? []) {
        if (o.kind === 'log') this.options.onLog?.({ level: o.level, text: o.text, script: call.script });
        else outputs.push(o);
      }
      if (reply.error) this.report(reply.error, call.script);
      return { outputs, ...(reply.error ? { error: reply.error } : {}) };
    });
  }

  dispose(): void {
    this.killWorker();
    this.sources.clear();
  }

  private report(message: string, script?: string): void {
    this.errors.push(message);
    this.options.onLog?.({ level: 'error', text: message, script });
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private killWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.waiting?.({ id: 0, error: 'sandbox stopped' });
    this.waiting = null;
  }

  /** Starts a worker and waits for it to initialise (not timed by the 250 ms watchdog). Returns an error text on failure. */
  private async start(): Promise<string | undefined> {
    const worker = (this.options.createWorker ?? defaultWorker)();
    this.worker = worker;
    worker.onmessage = (event) => {
      const reply = event.data as WorkerReply;
      if (reply.id !== 0 && this.worker === worker) this.waiting?.(reply);
    };
    worker.onerror = (event) => {
      if (this.worker !== worker) return;
      this.waiting?.({ id: 0, error: event.message ?? 'worker error' });
      this.killWorker(); // a crashed worker is replaced on the next request
    };
    const ready = await new Promise<WorkerReply>((resolve) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        this.killWorker();
        resolve({ id: 0, error: `no response within ${START_TIMEOUT_MS} ms` });
      }, START_TIMEOUT_MS);
      this.waiting = (reply) => {
        clearTimeout(timer);
        this.waiting = null;
        resolve(reply);
      };
      worker.postMessage({ type: 'init', id: this.nextId++, prelude: this.options.prelude ?? preludeSource } satisfies WorkerRequest);
    });
    if (ready.error) {
      this.killWorker();
      return `worker failed to start: ${ready.error}`;
    }
    // Replays already-accepted scripts after a kill; replies are not awaited (id 0).
    for (const [name, source] of this.sources) worker.postMessage({ type: 'load', id: 0, name, source } satisfies WorkerRequest);
    return undefined;
  }

  /** One request at a time (see `enqueue`), so the watchdog times exactly this request. */
  private async request(
    message: { type: 'load'; name: string; source: string } | { type: 'unload'; name: string } | ({ type: 'call' } & HandlerCall),
    what: string,
  ): Promise<WorkerReply> {
    const limit = this.options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
    if (!this.worker) {
      const failure = await this.start();
      if (failure) return { id: 0, error: `${what}: ${failure}` };
    }
    const worker = this.worker;
    if (!worker) return { id: 0, error: `${what}: sandbox stopped` };
    return new Promise((resolve) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.waiting = null;
        this.killWorker();
        resolve({ id, error: `${what}: exceeded ${limit} ms, worker terminated` });
      }, limit);
      this.waiting = (reply) => {
        clearTimeout(timer);
        this.waiting = null;
        resolve(reply);
      };
      worker.postMessage({ ...message, id } as WorkerRequest);
    });
  }
}

