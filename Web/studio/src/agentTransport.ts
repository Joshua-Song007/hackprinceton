// The Studio side of the Deep Agent runtime's agent-player messages: `decide` -> `plan` and `report` -> `report_result` (see
// Plugins/langchain-deepagents/runtime/players.py and server.py). One lazily opened socket serves every agent player of a run.
import type { Observation } from '@pear/runtime';

export interface AgentNote {
  phase: string;
  line: string;
  why: string;
}

export interface DecideRequest {
  run: string;
  player: string;
  persona: string;
  role: { id: string; name: string; brief: string; kind: 'player' | 'ref' };
  instructions: unknown;
  observation: Observation;
  game_time: number;
}

/** `actions` are raw: the driver passes them through `parseActions`. */
export interface PlanReply {
  actions: unknown;
  unsure: AgentNote[];
}

export interface ReportReply {
  unsure: AgentNote[];
  summary: string;
}

export interface AgentTransport {
  decide(request: DecideRequest): Promise<PlanReply>;
  report(request: { run: string; player: string }): Promise<ReportReply>;
  close(): void;
}

export const DECIDE_TIMEOUT_MS = 20_000;
export const REPORT_TIMEOUT_MS = 30_000;
const OPEN = 1;
const NO_PLUGIN = 'Install the Deep Agent plugin first.';
const CLOSED = 'The Deep Agent runtime closed the connection.';

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const notes = (v: unknown): AgentNote[] =>
  (Array.isArray(v) ? v : []).filter((n): n is Record<string, unknown> => typeof n === 'object' && n !== null && typeof (n as { why?: unknown }).why === 'string')
    .map((n) => ({ phase: String(n.phase ?? ''), line: String(n.line ?? ''), why: String(n.why) }));

/** `getUrl` is read at every open, so a hosted token is fresh after a reconnect; null means the plugin is not installed. */
export function socketTransport(getUrl: () => string | null, WebSocketImpl?: typeof WebSocket, timeouts = { decide: DECIDE_TIMEOUT_MS, report: REPORT_TIMEOUT_MS }): AgentTransport {
  const Socket = WebSocketImpl ?? WebSocket;
  let ws: WebSocket | null = null;
  let opening: Promise<WebSocket> | null = null;
  let nextId = 1;
  const pending = new Map<string, Pending>();

  const settle = (id: string): Pending | undefined => {
    const p = pending.get(id);
    if (p) (pending.delete(id), clearTimeout(p.timer));
    return p;
  };
  const failAll = (message: string) => {
    for (const id of [...pending.keys()]) settle(id)?.reject(new Error(message));
  };

  const open = (): Promise<WebSocket> => {
    if (ws && ws.readyState === OPEN) return Promise.resolve(ws);
    if (opening) return opening;
    const url = getUrl();
    if (!url) return Promise.reject(new Error(NO_PLUGIN));
    opening = new Promise<WebSocket>((resolve, reject) => {
      let s: WebSocket;
      try {
        s = new Socket(url);
      } catch (e) {
        opening = null;
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      ws = s;
      s.onopen = () => {
        opening = null;
        resolve(s);
      };
      s.onmessage = (e) => {
        let m: { id?: unknown; type?: unknown; message?: unknown; actions?: unknown; unsure?: unknown; summary?: unknown };
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (typeof m.id !== 'string') return;
        const p = settle(m.id);
        if (!p) return; // a late answer to a request that already timed out
        if (m.type === 'error') p.reject(new Error(typeof m.message === 'string' ? m.message : 'The agent player failed.'));
        else if (m.type === 'plan') p.resolve({ actions: m.actions, unsure: notes(m.unsure) });
        else if (m.type === 'report_result') p.resolve({ unsure: notes(m.unsure), summary: typeof m.summary === 'string' ? m.summary : '' });
        else p.reject(new Error('The Deep Agent runtime sent an unexpected reply.'));
      };
      s.onclose = () => {
        if (ws !== s) return; // closed by `close()` (already failed) or replaced by a newer socket
        ws = null;
        opening = null;
        reject(new Error(CLOSED));
        failAll(CLOSED);
      };
      s.onerror = () => {};
    });
    return opening;
  };

  const request = <T>(type: 'decide' | 'report', body: object, ms: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = `a${nextId++}`;
      const timer = setTimeout(() => {
        settle(id);
        reject(new Error(`The agent player did not answer within ${Math.round(ms / 1000)} s.`));
      }, ms);
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      open().then((s) => s.send(JSON.stringify({ type, id, ...body })), (e: Error) => settle(id)?.reject(e));
    });

  return {
    decide: (r) => request<PlanReply>('decide', r, timeouts.decide),
    report: (r) => request<ReportReply>('report', r, timeouts.report),
    close() {
      const s = ws;
      ws = null;
      opening = null;
      failAll(CLOSED);
      s?.close();
    },
  };
}
