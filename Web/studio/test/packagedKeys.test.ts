import { describe, expect, it, vi } from 'vitest';
import { nativeBackendRequest, tauriFetch } from '../src/tauriFetch';
import * as preferences from '../src/preferences';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { agentRuntimeUrls } from '../src/marketplace/controller';
import { RegistryClient } from '../src/marketplace/registry';
import { AccountController } from '../src/account';
import { PreferenceStore } from '../src/preferences';

describe('packaged model key routing', () => {
  it('limits native transport to the shipped backend API and health paths', () => {
    expect(nativeBackendRequest('https://155-138-208-146.sslip.io/api/me/model-key')).toBe(true);
    expect(nativeBackendRequest('https://155-138-208-146.sslip.io/agent/health')).toBe(true);
    for (const url of ['https://evil.test/api/me/model-key', 'http://155-138-208-146.sslip.io/api/me/model-key', 'https://155-138-208-146.sslip.io/elsewhere', 'https://155-138-208-146.sslip.io.evil.test/api/me/model-key']) {
      expect(nativeBackendRequest(url)).toBe(false);
    }
  });

  it('uses native HTTP without redirects or fallback on packaged permission errors', async () => {
    vi.stubEnv('DEV', false);
    const desktop = vi.spyOn(preferences, 'inDesktopApp').mockReturnValue(true);
    const browser = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    vi.mocked(nativeFetch).mockRejectedValueOnce(new Error('permission denied'));
    try {
      await expect(tauriFetch('https://155-138-208-146.sslip.io/api/me/model-key', { method: 'PUT' })).rejects.toThrow('permission denied');
      expect(nativeFetch).toHaveBeenCalledWith('https://155-138-208-146.sslip.io/api/me/model-key', { method: 'PUT', maxRedirections: 0 });
      expect(browser).not.toHaveBeenCalled();
      await tauriFetch('https://custom.test/api/me/model-key');
      expect(browser).toHaveBeenCalledTimes(1);
    } finally {
      desktop.mockRestore();
      browser.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('selects the hosted agent for signed-in desktop sessions without changing local plugins', () => {
    const agent = { id: 'langchain-deepagents' };
    expect(agentRuntimeUrls(agent, 'https://backend.test', 'session', 'game').hosted).toBe(true);
    expect(agentRuntimeUrls(agent, 'https://backend.test', null, 'game').ws).toBe('ws://localhost:9410/ws');
    expect(agentRuntimeUrls({ id: 'local', runtime: { port: 9450 } }, 'https://backend.test', 'session', 'game').ws).toBe('ws://localhost:9450/ws');
  });

  it('does not forward a previous server session when the configured backend changes', () => {
    const prefs = new PreferenceStore(null);
    const account = new AccountController(prefs, false, null);
    account.client.token = 'old-session';
    prefs.set({ serverUrl: 'https://other.test' });
    expect(account.client.token).toBeFalsy();
    expect(account.account).toBeNull();
  });

  it('validates input and sends keys only through the authenticated backend save route', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new RegistryClient(() => 'https://backend.test', fetchFn, () => 'session');
    await expect(client.setModelKey('openai', '  ')).rejects.toThrow('API key');
    await expect(client.setModelKey('anthropic', 'key with spaces')).rejects.toThrow('whitespace');
    expect(fetchFn).not.toHaveBeenCalled();
    await client.setModelKey('openai', ' sk-test ');
    expect(fetchFn).toHaveBeenCalledWith('https://backend.test/api/me/model-key', expect.objectContaining({
      method: 'PUT', headers: expect.objectContaining({ Authorization: 'Bearer session' }), body: JSON.stringify({ provider: 'openai', key: 'sk-test' }),
    }));
    fetchFn.mockRejectedValueOnce(new Error('permission denied'));
    await expect(client.setModelKey('anthropic', 'sk-ant-test')).rejects.toThrow('Cannot reach the registry');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await expect(new RegistryClient(() => '', fetchFn).setModelKey('openai', 'sk-test')).rejects.toThrow('Sign in');
  });
});
