import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@pear/cloud';
import { AccountController } from '../src/account';
import { PreferenceStore } from '../src/preferences';
import { signupError, validateSignup } from '../src/signupScreen';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('validateSignup', () => {
  it('accepts valid details', () => expect(validateSignup('tien_vu-1', 'correct-horse', 'correct-horse')).toEqual([]));
  it('rejects bad usernames', () => {
    for (const u of ['ab', 'Tien', 'a b', 'x'.repeat(33), '']) expect(validateSignup(u, 'correct-horse', 'correct-horse'), u).toHaveLength(1);
  });
  it('rejects short and mismatched passwords', () => {
    expect(validateSignup('tien', 'short', 'short')).toEqual(['Password must be at least 10 characters.']);
    expect(validateSignup('tien', 'correct-horse', 'correct-hors')).toEqual(['Passwords do not match.']);
  });
});

describe('AccountController.signUp', () => {
  const setup = (respond: (body: unknown) => Response) => {
    const storage = memory();
    const prefs = new PreferenceStore(storage);
    prefs.set({ serverUrl: 'https://pear.test' });
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      const path = new URL(input).pathname;
      calls.push(`${init.method} ${path}`);
      if (path === '/api/accounts/signup') return respond(JSON.parse(init.body as string));
      return json(200, []);
    });
    return { account: new AccountController(prefs, true, storage), storage, calls };
  };

  it('posts the contract body, signs in and persists the session', async () => {
    let sent: unknown;
    const { account, storage, calls } = setup((b) => { sent = b; return json(200, { token: 'tok', account: { id: 'a', provider: 'password', subject: 'tien', display_name: 'Tien', created_at: '', role: 'player' } }); });
    await account.signUp('tien', 'Tien', 'correct-horse');
    expect(sent).toEqual({ username: 'tien', password: 'correct-horse', display_name: 'Tien' });
    expect(account.account?.subject).toBe('tien');
    expect(JSON.parse(storage.getItem('pear.studio.session')!).token).toBe('tok');
    expect(calls[0]).toBe('POST /api/accounts/signup');
  });

  it('defaults the display name to the username and surfaces 409 as a taken username', async () => {
    let sent: { display_name?: string } = {};
    const { account } = setup((b) => { sent = b as never; return json(409, { error: 'taken' }); });
    const err = await account.signUp('tien', '', 'correct-horse').catch((e) => e);
    expect(sent.display_name).toBe('tien');
    expect(account.account).toBeNull();
    expect(signupError(err, '')).toBe('That username is taken. Pick another.');
    expect(err).toBeInstanceOf(ApiError);
  });
});

describe('AccountController.signInDeveloper', () => {
  const okBody = (provider: string) => ({ token: 'tok', account: { id: 'a', provider, subject: 'tien', display_name: 'Tien', created_at: '', role: provider === 'developer' ? 'developer' : 'player' } });
  const setup = (respond: (body: { provider: string }) => Response | 'network') => {
    const storage = memory();
    const prefs = new PreferenceStore(storage);
    prefs.set({ serverUrl: 'https://pear.test' });
    const providers: string[] = [];
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      if (new URL(input).pathname !== '/api/accounts/signin') return json(200, []);
      const body = JSON.parse(init.body as string) as { provider: string };
      providers.push(body.provider);
      const r = respond(body);
      if (r === 'network') throw new TypeError('offline');
      return r;
    });
    return { account: new AccountController(prefs, true, storage), storage, providers };
  };

  it('signs in a Create account (password) account with one request', async () => {
    const { account, storage, providers } = setup((b) => json(200, okBody(b.provider)));
    await account.signInDeveloper('tien', 'correct-horse');
    expect(providers).toEqual(['password']);
    expect(account.account?.provider).toBe('password');
    expect(JSON.parse(storage.getItem('pear.studio.session')!).token).toBe('tok');
  });

  it('falls back to the developer provider when the password one is rejected', async () => {
    const { account, providers } = setup((b) => (b.provider === 'password' ? json(401) : json(200, okBody(b.provider))));
    await account.signInDeveloper('root', 'correct-horse');
    expect(providers).toEqual(['password', 'developer']);
    expect(account.isDeveloper).toBe(true);
  });

  it('throws unauthorized, and stays signed out, when both providers reject', async () => {
    const { account, providers } = setup(() => json(401));
    const err = await account.signInDeveloper('tien', 'wrong-password').catch((e) => e);
    expect(providers).toEqual(['password', 'developer']);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('unauthorized');
    expect(account.account).toBeNull();
  });

  it('does not retry on other errors', async () => {
    const down = setup(() => 'network');
    expect((await down.account.signInDeveloper('tien', 'correct-horse').catch((e) => e)).kind).toBe('network');
    expect(down.providers).toEqual(['password']);
    const busy = setup(() => json(503));
    expect((await busy.account.signInDeveloper('tien', 'correct-horse').catch((e) => e)).kind).toBe('unavailable');
    expect(busy.providers).toEqual(['password']);
  });

  it('asks for both fields before any request', async () => {
    const { account, providers } = setup((b) => json(200, okBody(b.provider)));
    await expect(account.signInDeveloper('tien', '')).rejects.toThrow('Enter a username and password.');
    expect(providers).toEqual([]);
  });
});
