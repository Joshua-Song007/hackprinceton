import type { GameVersion } from '@pear/cloud';
import { describe, expect, it, vi } from 'vitest';
import { AccountController, createHostedGameOpener } from '../src/account';
import { PreferenceStore } from '../src/preferences';
import { Project, templateSnapshot } from '../src/project';

function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  storage.setItem('pear.studio.session', JSON.stringify({ token: 'test', account: { id: 'owner' } }));
  const prefs = new PreferenceStore(storage);
  const account = new AccountController(prefs, true, storage);
  const project = new Project(templateSnapshot('blank'));
  const confirm = vi.fn(async () => true);
  const opened = vi.fn(() => expect(account.gameId).toBe(project.gameId));
  const load = vi.fn((snapshot) => project.load(snapshot));
  const opener = createHostedGameOpener(account, { confirm, load, opened });
  const version = (id: string): GameVersion => ({ ...project.toVersion(), id: `version-${id}`, game_id: id, version: 3, published_at: '' });
  account.select('previous');
  return { account, prefs, project, confirm, opened, load, opener, version, storage };
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('hosted opening project/account transaction', () => {
  it('clears previous preview selection before fetching, then loads the matching latest project before activating preview', async () => {
    const s = setup();
    const selections: (string | null)[] = [];
    s.account.onChange(() => selections.push(s.account.gameId));
    const fetch = vi.spyOn(s.account.client, 'fetchVersion').mockImplementation(async () => {
      expect(s.account.gameId).toBeNull();
      return s.version('chosen');
    });
    expect(await s.opener.open('chosen')).toBe(true);
    expect(fetch).toHaveBeenCalledWith('chosen', 'latest');
    expect(s.project.gameId).toBe('chosen');
    expect(s.project.version).toBe(3);
    expect(s.account.gameId).toBe('chosen');
    expect(s.storage.getItem('pear.studio.game')).toBe('chosen');
    expect(selections).toEqual([null, 'chosen']);
    expect(s.opened).toHaveBeenCalledOnce();
  });

  it('leaves both project and selection intact when discard is declined', async () => {
    const s = setup();
    s.confirm.mockResolvedValue(false);
    const fetch = vi.spyOn(s.account.client, 'fetchVersion');
    expect(await s.opener.open('chosen')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(s.account.gameId).toBe('previous');
    expect(s.load).not.toHaveBeenCalled();
  });

  it('keeps the existing project but no stale cloud session on failure, and supports retry', async () => {
    const s = setup();
    const fetch = vi.spyOn(s.account.client, 'fetchVersion').mockRejectedValueOnce(new Error('offline'));
    await expect(s.opener.open('chosen')).rejects.toThrow('offline');
    expect(s.account.gameId).toBeNull();
    expect(s.load).not.toHaveBeenCalled();
    expect(s.opened).not.toHaveBeenCalled();
    fetch.mockResolvedValue(s.version('chosen'));
    expect(await s.opener.open('chosen')).toBe(true);
  });

  it('ignores a late success or failure after another game wins the race', async () => {
    for (const fail of [false, true]) {
      const s = setup();
      const first = deferred<GameVersion>();
      vi.spyOn(s.account.client, 'fetchVersion').mockReturnValueOnce(first.promise).mockResolvedValueOnce(s.version('second'));
      const pending = s.opener.open('first');
      await Promise.resolve();
      expect(await s.opener.open('second')).toBe(true);
      if (fail) first.reject(new Error('late error')); else first.resolve(s.version('first'));
      expect(await pending).toBe(false);
      expect(s.account.gameId).toBe('second');
      expect(s.project.gameId).toBe('second');
      expect(s.load).toHaveBeenCalledOnce();
    }
  });

  it('a local open cancels an in-flight hosted fetch', async () => {
    const s = setup();
    const fetch = deferred<GameVersion>();
    vi.spyOn(s.account.client, 'fetchVersion').mockReturnValue(fetch.promise);
    const pending = s.opener.open('chosen');
    await Promise.resolve();
    s.opener.cancel();
    fetch.resolve(s.version('chosen'));
    expect(await pending).toBe(false);
    expect(s.load).not.toHaveBeenCalled();
  });

  it.each(['server', 'account', 'token'])('ignores a result after %s identity changes', async (change) => {
    const s = setup();
    const fetch = deferred<GameVersion>();
    vi.spyOn(s.account.client, 'fetchVersion').mockReturnValue(fetch.promise);
    const pending = s.opener.open('chosen');
    await Promise.resolve();
    if (change === 'server') s.prefs.set({ serverUrl: 'https://different.test' });
    else if (change === 'account') s.account.account = null;
    else s.account.client.token = 'different';
    fetch.resolve(s.version('chosen'));
    expect(await pending).toBe(false);
    expect(s.load).not.toHaveBeenCalled();
  });

  it('does not fetch when identity changes during discard confirmation', async () => {
    const s = setup();
    const confirm = deferred<boolean>();
    s.confirm.mockReturnValue(confirm.promise);
    const fetch = vi.spyOn(s.account.client, 'fetchVersion');
    const pending = s.opener.open('chosen');
    s.account.account = null;
    confirm.resolve(true);
    expect(await pending).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a mismatched server response rather than selecting another game', async () => {
    const s = setup();
    vi.spyOn(s.account.client, 'fetchVersion').mockResolvedValue(s.version('wrong'));
    await expect(s.opener.open('chosen')).rejects.toThrow('different game');
    expect(s.account.gameId).toBeNull();
    expect(s.load).not.toHaveBeenCalled();
  });

  it('server change clears game and publish metadata as well as credentials', () => {
    const s = setup();
    s.account.lastPublished = { gameId: 'previous', version: 2 };
    s.prefs.set({ serverUrl: 'https://different.test' });
    expect(s.account.account).toBeNull();
    expect(s.account.gameId).toBeNull();
    expect(s.account.lastPublished).toBeNull();
    expect(s.storage.getItem('pear.studio.game')).toBeNull();
  });
});
