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
