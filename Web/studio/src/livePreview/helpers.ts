// Live Preview: pure helpers (state reduction, asset lookup, lat/lng extraction, log building and filtering).
// No DOM here so vitest (node) covers them; session.ts, map.ts, terminal.ts and panel.ts wire them to the page.
import type { DebugEvent } from '@pear/cloud';
import type { Node, OutAction, ViewState } from '@pear/ui';

export type PreviewKind = 'phone' | 'ipad';
export type LogLevel = 'log' | 'warn' | 'error';
export type LogDir = 'in' | 'out' | 'sys' | 'debug';
export interface LogRow { id: number; t: number; source: string; dir: LogDir; name: string; text: string; level: LogLevel }

export const MAX_LOG_ROWS = 2000;
/** No 0/O/1/I so a lobby code read aloud or typed on a phone is not misread. */
const LOBBY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const randomLobby = (rand: () => number = Math.random): string =>
  Array.from({ length: 5 }, () => LOBBY_ALPHABET[Math.floor(rand() * LOBBY_ALPHABET.length)]).join('');

/** What the server accepts as a lobby: upper-case letters and digits, 1-12 long; '' when nothing usable is left. */
export const normalizeLobby = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

/** The join hello (C1 amendments): iPad is the referee, everything else a phone. */
export const roleFrame = (kind: PreviewKind): { name: string; data: { role: 'referee' | 'phone'; kind: PreviewKind } } =>
  ({ name: 'role', data: { role: kind === 'ipad' ? 'referee' : 'phone', kind } });

/** Folds a UI action into the view state: `set` updates `local`; `send` leaves the state alone and returns the frame to send. */
export function reduceAction(state: ViewState, action: OutAction): { state: ViewState; send?: { name: string; data: unknown } } {
  if ('set' in action) return { state: { ...state, local: { ...state.local, [action.set]: action.value } } };
  return { state, send: { name: action.name, data: action.data } };
}

/** Sha256 of the version's `ui.json` asset (named `ui.json` or ending in `/ui.json`); the asset value is `{sha256,…}` or a bare hash. */
export function findUiAsset(assets: Record<string, unknown> | undefined | null): string | null {
  for (const [name, v] of Object.entries(assets ?? {})) {
    if (name !== 'ui.json' && !name.endsWith('/ui.json')) continue;
    const sha = typeof v === 'string' ? v : (v as { sha256?: unknown } | null)?.sha256;
    if (typeof sha === 'string' && /^[0-9a-f]{64}$/i.test(sha)) return sha;
  }
  return null;
}

/** Stream rate of a sensor node: its `hz` capped at 30, else `fallback`. */
export const sensorHz = (node: Pick<Node, 'hz'>, fallback = 10): number => {
  const hz = Number(node.hz);
  return Number.isFinite(hz) && hz > 0 ? Math.min(30, hz) : fallback;
};

/** `{lat,lng}` when a frame's data carries finite coordinates in range, else null. */
export function extractLatLng(data: unknown): { lat: number; lng: number } | null {
  if (!data || typeof data !== 'object') return null;
  const { lat, lng } = data as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const json = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return String(v);
  }
};

/** A log row for one `/play` frame on one device. */
export const frameRow = (source: string, dir: 'in' | 'out', frame: { name: string; data?: unknown }, t = Date.now()): Omit<LogRow, 'id'> =>
  ({ t, source, dir, name: frame.name, text: json(frame.data), level: 'log' });

export const sysRow = (source: string, text: string, level: LogLevel = 'log', t = Date.now()): Omit<LogRow, 'id'> =>
  ({ t, source, dir: 'sys', name: '', text, level });

/** A log row for one `/debug` message (protocol in debug-panel.ts); null for kinds the terminal does not show. */
export function debugRow(ev: DebugEvent): Omit<LogRow, 'id'>[] {
  const t = typeof ev.t === 'number' ? ev.t : Date.now();
  const player = typeof ev.player === 'string' ? ev.player : '';
  const row = (name: string, text: string, level: LogLevel = 'log'): Omit<LogRow, 'id'> => ({ t, source: player ? `server:${player}` : 'server', dir: 'debug', name, text, level });
  switch (ev.kind) {
    case 'snapshot': {
      const nested = Array.isArray(ev.logs) ? (ev.logs as DebugEvent[]).flatMap(debugRow) : [];
      const players = Array.isArray(ev.players) ? ev.players.length : 0;
      return [...nested, row('snapshot', `version ${typeof ev.version === 'number' ? ev.version : 'none'}, ${players} players`)];
    }
    case 'join': return [row('join', 'joined')];
    case 'leave': return [row('leave', 'left')];
    case 'in': return [row(String(ev.name), json(ev.data))];
    case 'out': return [row(String(ev.name), json(ev.data))];
    case 'log': return [row('log', String(ev.msg), ev.level === 'warn' ? 'warn' : ev.level === 'error' ? 'error' : 'log')];
    case 'error': return [row('error', String(ev.msg), 'error')];
    case 'reload': return [row('reload', `server scripts restarted on version ${String(ev.version)}`)];
    default: return []; // `state` snapshots are the State panel's job, not log lines
  }
}

/** Appends `row` with the next id, dropping the oldest rows beyond `max`. Returns a new array. */
export function appendRow(rows: readonly LogRow[], row: Omit<LogRow, 'id'>, max = MAX_LOG_ROWS): LogRow[] {
  const id = (rows.length ? rows[rows.length - 1].id : 0) + 1;
  const next = [...rows, { ...row, id }];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Every space-separated term must appear (case-insensitive) in source, direction, name or text; an empty query keeps all. */
export function filterLog(rows: readonly LogRow[], query: string): LogRow[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...rows];
  return rows.filter((r) => {
    const hay = `${r.source} ${r.dir} ${r.name} ${r.text}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
