import type { Game, GameVersion } from '@pear/cloud';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountController, readLastPublished, type PublishStepId, type PublishStepState } from '../src/account';
import { checkGame } from '../src/gamePanel';
import { PreferenceStore } from '../src/preferences';
import { Project, templateSnapshot } from '../src/project';
import { publishLinks, qrDataUrl } from '../src/publishView';

const SERVER = 'https://155-138-208-146.sslip.io';
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const game: Game = { id: 'g1', owner_id: 'a1', title: 'Quick Draw', created_at: '', updated_at: '' };
const reorder = (o: unknown): unknown => (Array.isArray(o) ? o.map(reorder) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, reorder(v)])) : o);

/** A signed-in controller on a fake server; `routes` maps "METHOD /path" to a response, anything else is a 404. */
function setup(routes: Record<string, (body: unknown) => Response | Promise<Response>>) {
  const storage = memory();
  const prefs = new PreferenceStore(storage);
  prefs.set({ serverUrl: SERVER });
  storage.setItem('pear.studio.session', JSON.stringify({ token: 't', account: { id: 'a1', provider: 'dev', subject: 'me', display_name: 'me', created_at: '' } }));
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname;
    calls.push(`${init.method} ${path}`);
    const route = routes[`${init.method} ${path}`];
    return route ? route(init.body ? JSON.parse(init.body as string) : undefined) : json(404);
  });
  const account = new AccountController(prefs, true, storage);
  account.select('g1');
  const project = new Project(templateSnapshot('blank'));
  const steps: [PublishStepId, PublishStepState][] = [];
  return { account, project, storage, calls, steps, onStep: (id: PublishStepId, s: PublishStepState) => steps.push([id, s]) };
}

const healthy = (mutate: (v: GameVersion) => GameVersion = (v) => v): Record<string, (body: unknown) => Response> => {
  let stored: GameVersion | null = null;
  return {
    'GET /api/accounts/me': () => json(200, { id: 'a1' }),
    'GET /api/games': () => json(200, [game]),
    'POST /api/games/g1/versions': (body) => {
      stored = { ...(body as object), id: 'v1', game_id: 'g1', version: 7, published_at: '' } as GameVersion;
      return json(201, stored);
    },
    'GET /api/games/g1/versions/7': () => json(200, mutate(stored!)),
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('publish to Vultr: progress and verify', () => {
  it('walks the four steps, verifies the stored version and persists the publish time', async () => {
    const s = setup(healthy((v) => ({ ...v, scene: reorder(v.scene) as GameVersion['scene'], run_mode: 'device' })));
    const out = await s.account.publishVerified(s.project, s.onStep);
    expect(out).toMatchObject({ ok: true, confirmation: { gameId: 'g1', version: 7, runMode: 'device', serverUrl: SERVER } });
    expect(s.steps).toEqual([
      ['signIn', 'running'], ['signIn', 'done'], ['server', 'running'], ['server', 'done'],
      ['upload', 'running'], ['upload', 'done'], ['verify', 'running'], ['verify', 'done'],
    ]);
    expect(s.calls).toContain('GET /api/games/g1/versions/7');
    expect(s.project.version).toBe(7);
    const at = readLastPublished('g1', s.storage);
    expect(at).toBeGreaterThan(0);
    expect(checkGame(s.project, 'idle', at).checks.some((c) => c.label.startsWith('Last published: '))).toBe(true);
    expect(checkGame(s.project, 'idle', null).checks.some((c) => c.label.startsWith('Last published'))).toBe(false);
  });

  it('fails at the check-server step when the server is unreachable, and Retry can succeed', async () => {
    let up = false;
    const routes = healthy();
    const guarded = Object.fromEntries(Object.entries(routes).map(([k, f]) => [k, (b: unknown) => { if (!up) throw new TypeError('fetch failed'); return f(b); }]));
    const s = setup(guarded);
    const out = await s.account.publishVerified(s.project, s.onStep);
    expect(out).toMatchObject({ ok: false, step: 'server' });
    expect(out.ok === false && out.reason).toContain(`Cannot reach ${SERVER}`);
    expect(s.steps.at(-1)).toEqual(['server', 'error']);
    expect(readLastPublished('g1', s.storage)).toBeNull();
    up = true;
    expect((await s.account.publishVerified(s.project)).ok).toBe(true);
  });

  it('reports a 503 from the upload step in plain language', async () => {
    const s = setup({ ...healthy(), 'POST /api/games/g1/versions': () => json(503) });
    const out = await s.account.publishVerified(s.project, s.onStep);
    expect(out).toMatchObject({ ok: false, step: 'upload' });
    expect(out.ok === false && out.reason).toContain('no database');
    expect(s.project.version).toBeNull();
  });

  it('fails verify when the server stored a different scene, and records nothing', async () => {
    const s = setup(healthy((v) => ({ ...v, scene: { ...v.scene, tampered: true } })));
    const out = await s.account.publishVerified(s.project, s.onStep);
    expect(out).toMatchObject({ ok: false, step: 'verify' });
    expect(out.ok === false && out.reason).toContain('different scene');
    expect(readLastPublished('g1', s.storage)).toBeNull();
  });

  it('fails verify when the server reports another version number', async () => {
    const s = setup(healthy((v) => ({ ...v, version: 8 })));
    const out = await s.account.publishVerified(s.project);
    expect(out).toMatchObject({ ok: false, step: 'verify' });
    expect(out.ok === false && out.reason).toContain('version 8');
  });

  it('blames sign-in when the session is rejected, and when nobody is signed in', async () => {
    const s = setup({ ...healthy(), 'GET /api/accounts/me': () => json(401) });
    expect(await s.account.publishVerified(s.project)).toMatchObject({ ok: false, step: 'signIn' });
    expect(s.calls).not.toContain('POST /api/games/g1/versions');
    expect(await s.account.publishVerified(s.project)).toMatchObject({ ok: false, step: 'signIn' }); // now signed out locally
  });

  it('renders a local QR image for a phone link', () => {
    expect(qrDataUrl('https://x.test/qd-phone.html?game=g1&name=Player1')).toMatch(/^data:image\/gif;base64,/);
  });

  it('builds the two phone links for the game', () => {
    expect(publishLinks(`${SERVER}/`, 'g1').map((l) => l.url)).toEqual([
      `${SERVER}/qd-phone.html?game=g1&name=Player1`,
      `${SERVER}/qd-phone.html?game=g1&name=Player2`,
    ]);
  });
});
