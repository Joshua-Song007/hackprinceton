import { CloudClient, type Game, type GameVersion } from '@pear/cloud';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountController } from '../src/account';
import { PreferenceStore } from '../src/preferences';
import { Project, templateSnapshot } from '../src/project';
import { carriedOver, publishBlockers, uiJsonAsset } from '../src/publishView';

const SERVER = 'https://155-138-208-146.sslip.io';
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const game: Game = { id: 'g1', owner_id: 'a1', title: 'Quick Draw', created_at: '', updated_at: '' };
const manifest = { format: 'pear-game/1' as const, name: 'Quick Draw' };
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const uiText = JSON.stringify({ format: 'pear-ui/1', screens: {} });

afterEach(() => vi.unstubAllGlobals());

describe('publish view: check gate, ui.json asset, carried metadata', () => {
  it('blocks an empty project on its failing checks and passes the template', () => {
    expect(publishBlockers(new Project(templateSnapshot('blank')))).not.toEqual([]);
  });

  it('rejects ui.json text that is not JSON', () => {
    expect(() => uiJsonAsset('{nope')).toThrow('not valid JSON');
  });

  it('encodes ui.json as an inline {contentType, data} asset that round-trips', () => {
    let asset: Record<string, unknown>;
    try {
      asset = uiJsonAsset(uiText);
    } catch (e) {
      // a PearUI shape the validator rejects is reported, never encoded
      expect((e as Error).message).toContain('ui.json is invalid');
      return;
    }
    const entry = asset['ui.json'] as { contentType: string; data: string };
    expect(entry.contentType).toBe('application/json');
    expect(atob(entry.data)).toBe(uiText);
  });

  it('carries metadata.manifest and the ui.json asset from the latest version, and nothing for a new game', async () => {
    const latest = { assets: { 'ui.json': { contentType: 'application/json', data: 'e30=' } }, metadata: { manifest }, version: 3 } as unknown as GameVersion;
    vi.stubGlobal('fetch', async (input: string) => (new URL(input).pathname.endsWith('/versions/latest') ? json(200, latest) : json(404)));
    const client = new CloudClient({ baseUrl: SERVER, token: 't' });
    expect(await carriedOver(client, 'g1')).toEqual({ assets: { 'ui.json': latest.assets['ui.json'] }, metadata: { manifest } });
    vi.stubGlobal('fetch', async () => json(404));
    expect(await carriedOver(client, 'g2')).toEqual({});
  });

  it('publishes the extra assets and manifest in the version body', async () => {
    const storage = memory();
    const prefs = new PreferenceStore(storage);
    prefs.set({ serverUrl: SERVER });
    let sent: { assets?: unknown; metadata?: { manifest?: unknown; name?: unknown } } = {};
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      const path = new URL(input).pathname;
      if (init.method === 'POST' && path === '/api/games/g1/versions') {
        sent = JSON.parse(init.body as string);
        return json(201, { ...sent, id: 'v', game_id: 'g1', version: 2, published_at: '' });
      }
      return path === '/api/games' ? json(200, [game]) : json(404);
    });
    const account = new AccountController(prefs, false, storage);
    account.select('g1');
    const ui = { 'ui.json': { contentType: 'application/json', data: 'e30=' } };
    await account.publish(new Project(templateSnapshot('blank')), { assets: ui, metadata: { manifest } });
    expect(sent.assets).toEqual(ui);
    expect(sent.metadata).toMatchObject({ manifest, source: 'pear-studio' });
  });
});
