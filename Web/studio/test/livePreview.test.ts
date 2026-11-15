import type { WebSocketLike } from '@pear/cloud';
import { describe, expect, it } from 'vitest';
import {
  appendRow, debugRow, extractLatLng, filterLog, findUiAsset, frameRow, normalizeLobby, randomLobby, reduceAction, roleFrame, sensorHz, MAX_LOG_ROWS, type LogRow,
} from '../src/livePreview/helpers';
import { DeviceSession } from '../src/livePreview/session';
import { emptyState, reduceFrame, validate, type PearUI } from '@pear/ui';
import fixture from './fixtures/livepreview-ui.json';

const SHA = 'a'.repeat(64);
const row = (over: Partial<LogRow> = {}): LogRow => ({ id: 1, t: 0, source: 'Preview iPad', dir: 'in', name: 'state', text: '{"phase":"wait"}', level: 'log', ...over });

describe('state reduction', () => {
  it('folds _welcome into me and other frames into ev', () => {
    let s = emptyState('phone');
    s = reduceFrame(s, { name: '_welcome', data: { id: 'p1', name: 'A', lobby: 'ABCDE' } });
    s = reduceFrame(s, { name: 'state', data: { phase: 'fire' } });
    expect(s.me?.lobby).toBe('ABCDE');
    expect(s.ev.state).toEqual({ phase: 'fire' });
  });

  it('set actions update local without sending; send actions are returned and leave state alone', () => {
    const s = emptyState('ipad');
    const set = reduceAction(s, { set: 'tab', value: 2 });
    expect(set.state.local.tab).toBe(2);
    expect(set.send).toBeUndefined();
    expect(s.local.tab).toBeUndefined(); // input not mutated
    const send = reduceAction(s, { name: 'ready', data: { x: 1 } });
    expect(send.send).toEqual({ name: 'ready', data: { x: 1 } });
    expect(send.state).toBe(s);
  });

  it('role hello: iPad is the referee, phone is a phone', () => {
    expect(roleFrame('ipad')).toEqual({ name: 'role', data: { role: 'referee', kind: 'ipad' } });
    expect(roleFrame('phone').data.role).toBe('phone');
  });
});

describe('lobby, assets, sensors, coordinates', () => {
  it('random lobby is 5 unambiguous chars and normalize cleans user input', () => {
    expect(randomLobby(() => 0)).toBe('AAAAA');
    expect(randomLobby()).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(normalizeLobby(' ab-c1 d!')).toBe('ABC1D');
    expect(normalizeLobby('x'.repeat(40))).toHaveLength(12);
    expect(normalizeLobby('--')).toBe('');
  });

  it('finds ui.json by name or path suffix, with object or bare-hash values', () => {
    expect(findUiAsset({ 'ui.json': { sha256: SHA, size: 1 } })).toBe(SHA);
    expect(findUiAsset({ 'screens/ui.json': SHA })).toBe(SHA);
    expect(findUiAsset({ 'scenario.json': { sha256: SHA } })).toBeNull();
    expect(findUiAsset({ 'ui.json': { sha256: 'nope' } })).toBeNull();
    expect(findUiAsset(undefined)).toBeNull();
  });

  it('caps sensor hz at 30 and falls back when missing or invalid', () => {
    expect(sensorHz({ hz: 100 })).toBe(30);
    expect(sensorHz({ hz: 20 })).toBe(20);
    expect(sensorHz({})).toBe(10);
    expect(sensorHz({ hz: -3 })).toBe(10);
    expect(sensorHz({}, 1)).toBe(1);
  });

  it('extracts finite in-range lat/lng only', () => {
    expect(extractLatLng({ lat: 40.3, lng: -74.6, acc: 5 })).toEqual({ lat: 40.3, lng: -74.6 });
    expect(extractLatLng({ lat: '40', lng: 1 })).toBeNull();
    expect(extractLatLng({ lat: 91, lng: 0 })).toBeNull();
    expect(extractLatLng({ lat: NaN, lng: 0 })).toBeNull();
    expect(extractLatLng(null)).toBeNull();
  });
});

describe('terminal log', () => {
  it('filters case-insensitively with every term required, across source/dir/name/text', () => {
    const rows = [row(), row({ id: 2, source: 'Preview iPhone', dir: 'out', name: 'aim', text: '{"pitch":40}' }), row({ id: 3, source: 'server', dir: 'debug', name: 'error', text: 'boom', level: 'error' })];
    expect(filterLog(rows, '')).toHaveLength(3);
    expect(filterLog(rows, '  ')).toHaveLength(3);
    expect(filterLog(rows, 'IPHONE aim').map((r) => r.id)).toEqual([2]);
    expect(filterLog(rows, 'ipad aim')).toEqual([]);
    expect(filterLog(rows, 'pitch').map((r) => r.id)).toEqual([2]);
    expect(filterLog(rows, 'debug boom').map((r) => r.id)).toEqual([3]);
  });

  it('append assigns increasing ids, never mutates, and drops the oldest past the cap', () => {
    const a = appendRow([], { t: 1, source: 's', dir: 'sys', name: '', text: 'x', level: 'log' });
    const b = appendRow(a, { t: 2, source: 's', dir: 'sys', name: '', text: 'y', level: 'log' });
    expect(a).toHaveLength(1);
    expect(b.map((r) => r.id)).toEqual([1, 2]);
    let many: LogRow[] = [];
    for (let i = 0; i < MAX_LOG_ROWS + 5; i++) many = appendRow(many, { t: i, source: 's', dir: 'sys', name: '', text: String(i), level: 'log' });
    expect(many).toHaveLength(MAX_LOG_ROWS);
    expect(many[0].text).toBe('5');
  });

  it('turns /debug messages into rows (protocol of debug-panel.ts)', () => {
    expect(debugRow({ kind: 'join', player: 'ann' })).toMatchObject([{ source: 'server:ann', name: 'join', dir: 'debug' }]);
    expect(debugRow({ kind: 'in', player: 'ann', name: 'aim', data: { pitch: 1 } })[0]).toMatchObject({ name: 'aim', text: '{"pitch":1}' });
    expect(debugRow({ kind: 'error', msg: 'bad' })[0]).toMatchObject({ level: 'error', text: 'bad' });
    expect(debugRow({ kind: 'log', msg: 'hm', level: 'warn' })[0].level).toBe('warn');
    const snap = debugRow({ kind: 'snapshot', players: ['a', 'b'], version: 3, logs: [{ kind: 'log', msg: 'old' }] });
    expect(snap.map((r) => r.name)).toEqual(['log', 'snapshot']);
    expect(snap[1].text).toBe('version 3, 2 players');
    expect(debugRow({ kind: 'state', state: {} })).toEqual([]);
    expect(debugRow({ kind: 'unknown' })).toEqual([]);
  });

  it('frame rows carry source, direction and JSON text', () => {
    expect(frameRow('Preview iPad', 'out', { name: 'ready', data: { a: 1 } }, 5)).toEqual({ t: 5, source: 'Preview iPad', dir: 'out', name: 'ready', text: '{"a":1}', level: 'log' });
  });
});

// ---- DeviceSession against a fake server ----
class FakeSocket implements WebSocketLike {
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  sent: { name: string; data: unknown }[] = [];
  constructor(readonly url: string) {}
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() {}
  open() { this.onopen?.({}); }
  push(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

const UI = { pearui: 1, route: [{ screen: 'main' }], screens: { main: { type: 'text', value: 'hi' } } };
function server(version: Record<string, unknown>, assetStatus = 200) {
  const sockets: FakeSocket[] = [];
  const calls: string[] = [];
  const fetchFn = (async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (path === '/api/accounts/signin') return json({ token: 'tok-' + JSON.parse(String(init?.body)).subject, account: {} });
    if (path === '/api/games/g1/versions/latest') return json(version);
    if (path === `/api/assets/${SHA}`) return assetStatus === 200 ? json(UI) : new Response('', { status: assetStatus });
    return json({}, 404);
  }) as typeof fetch;
  const webSocket = (url: string) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s;
  };
  return { fetchFn, webSocket, sockets, calls };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const make = (kind: 'phone' | 'ipad', s: ReturnType<typeof server>) =>
  new DeviceSession({ name: `Preview ${kind}`, kind, baseUrl: 'https://srv.test', gameId: 'g1', lobby: 'ABCDE', fetch: s.fetchFn, webSocket: s.webSocket, run: 'r1' });

describe('DeviceSession', () => {
  it('signs in as its own dev device, joins the lobby with its token, and says its role on open', async () => {
    const s = server({ version: 2, assets: { 'ui.json': { sha256: SHA } } });
    const d = make('ipad', s);
    await d.start();
    await settle();
    expect(s.calls[0]).toBe('POST /api/accounts/signin');
    const sock = s.sockets[0];
    expect(sock.url).toBe('wss://srv.test/play/g1?lobby=ABCDE&token=tok-preview-ipad-r1');
    sock.open();
    expect(sock.sent).toEqual([{ name: 'role', data: { role: 'referee', kind: 'ipad' } }]);
    sock.close();
    d.dispose();
  });

  it('loads the latest version ui.json, reduces frames and logs both directions', async () => {
    const s = server({ version: 2, assets: { 'ui.json': { sha256: SHA } } });
    const d = make('phone', s);
    const log: string[] = [];
    d.onLog = (r) => log.push(`${r.dir}:${r.name}`);
    await d.start();
    await settle();
    expect(d.uiState).toMatchObject({ kind: 'ready', version: 2 });
    s.sockets[0].open();
    s.sockets[0].push({ name: '_welcome', data: { id: 'p', name: 'x', lobby: 'ABCDE' } });
    s.sockets[0].push({ name: 'state', data: { phase: 'fire', lat: 40.1, lng: -74.2 } });
    expect(d.state.ev.state).toMatchObject({ phase: 'fire' });
    expect(d.position).toEqual({ lat: 40.1, lng: -74.2 });
    d.act({ name: 'tap', data: { n: 1 } });
    d.act({ set: 'seen', value: true });
    expect(d.state.local.seen).toBe(true);
    expect(s.sockets[0].sent.map((f) => f.name)).toEqual(['role', 'tap']);
    expect(log).toContain('in:state');
    expect(log).toContain('out:tap');
    d.dispose();
  });

  it('shows the empty state (not an error) when the version has no ui.json', async () => {
    const s = server({ version: 4, assets: {} });
    const d = make('phone', s);
    await d.start();
    await settle();
    expect(d.uiState).toMatchObject({ kind: 'none', reason: 'Version 4 has no ui.json asset yet.' });
    d.dispose();
  });

  it('reports an unreadable or invalid ui.json instead of throwing', async () => {
    const missing = server({ version: 1, assets: { 'ui.json': { sha256: SHA } } }, 404);
    const a = make('phone', missing);
    await a.start();
    await settle();
    expect(a.uiState).toMatchObject({ kind: 'none' });
    expect((a.uiState as { reason: string }).reason).toContain('HTTP 404');
    a.dispose();
  });

  it('does not send while the socket is closed and reloads ui.json on _reload to a new version', async () => {
    const s = server({ version: 1, assets: { 'ui.json': { sha256: SHA } } });
    const d = make('phone', s);
    await d.start();
    await settle();
    expect(d.send('aim', { pitch: 3 })).toBe(false);
    s.sockets[0].open();
    expect(d.send('aim', { pitch: 3 })).toBe(true);
    const before = s.calls.filter((c) => c.includes('versions/latest')).length;
    s.sockets[0].push({ name: '_reload', data: { version: 2 } });
    await settle();
    expect(s.calls.filter((c) => c.includes('versions/latest')).length).toBe(before + 1);
    d.dispose();
  });

  it('a local ui.json overrides the hosted version and the fixture is a valid PearUI', async () => {
    expect(validate(fixture)).toEqual([]);
    const s = server({ version: 4, assets: {} });
    const d = make('phone', s);
    d.localUi = fixture as unknown as PearUI;
    await d.start();
    await settle();
    expect(d.uiState).toMatchObject({ kind: 'ready', version: 0 });
    d.dispose();
  });

  it('marks the device failed when dev sign-in is refused', async () => {
    const fetchFn = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    const d = new DeviceSession({ name: 'n', kind: 'phone', baseUrl: 'https://srv.test', gameId: 'g1', lobby: 'ABCDE', fetch: fetchFn, run: 'r' });
    const lines: string[] = [];
    d.onLog = (r) => lines.push(r.text);
    await d.start();
    expect(d.status).toBe('failed');
    expect(lines[0]).toContain('Sign-in failed');
  });
});
