import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEEP_AGENTS_ID, isNewer, MarketplaceController, openScriptAndReveal, runtimePort, type MarketplaceDeps } from '../src/marketplace/controller';
import { BrowserInstaller, TauriInstaller, verifyBundle, type PluginInstaller } from '../src/marketplace/installer';
import { RegistryClient, type InstallRecord, type PluginBundle, type PluginSummary } from '../src/marketplace/registry';

const summary: PluginSummary = {
  id: DEEP_AGENTS_ID, name: 'LangChain Deep Agents', version: '0.1.0', author: 'Omni', category: 'AI agents', description: 'Writes scripts.', installs: 7,
};
const manifest: { id: string } & Record<string, unknown> = { id: DEEP_AGENTS_ID, name: summary.name };

class MemoryStorage {
  private data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
}

/** Every collaborator writes into one ordered log, so tests assert the sequence of the flow. */
function setup(over: { healthOk?: boolean; postFails?: boolean; storage?: MemoryStorage; manifest?: typeof manifest; token?: string | null; records?: InstallRecord[]; listed?: string } = {}) {
  const log: string[] = [];
  const healthUrls: string[] = [];
  const panelUrls: string[] = [];
  const bundled = over.manifest ?? manifest;
  const announced: string[] = [];
  const listedVersion = over.listed ?? summary.version;
  const installer: PluginInstaller = {
    install: async (project, b) => void log.push(`install ${project} ${b.release.id}@${b.release.version} ${b.tarball.length}b`),
    uninstall: async (project, id) => void log.push(`uninstall ${project} ${id}`),
    start: async (project) => void log.push(`start ${project}`),
    stop: async (project, id) => void log.push(`stop ${project} ${id}`),
  };
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const path = url.replace('http://backend/api', '');
    const method = init?.method ?? 'GET';
    if (url.endsWith('/health')) {
      log.push('health');
      healthUrls.push(url);
      return new Response('{}', { status: over.healthOk === false ? 503 : 200 });
    }
    if (path.includes('/bundle')) {
      log.push(`GET bundle ${path.split('version=')[1]}`);
      return new Response(new Uint8Array([1, 2, 3]));
    }
    if (path === '/plugin-signing-key') return Response.json({ publicKey: 'ab' });
    if (path === '/me/plugins') {
      log.push('GET mine');
      return Response.json(over.records ?? []);
    }
    if (path.endsWith('/installs')) {
      log.push(`${method} installs ${(init?.headers as Record<string, string>)?.Authorization ?? 'anonymous'}`);
      if (over.postFails) return new Response('{}', { status: 500 });
      return Response.json({ installs: method === 'POST' ? 8 : 6 });
    }
    if (path === `/plugins/${DEEP_AGENTS_ID}`) return Response.json({ id: DEEP_AGENTS_ID, version: listedVersion, manifest: bundled, sha256: 'aa', signature: 'bb', size: 3 });
    return Response.json([{ ...summary, version: listedVersion }]);
  }) as unknown as typeof fetch;
  const token = over.token === undefined ? 'tok' : over.token;
  const deps: MarketplaceDeps = {
    registry: new RegistryClient(() => 'http://backend', fetchFn, () => token),
    installer,
    host: {
      register: (spec) => void log.push(`register ${spec.id}`),
      unregister: (id) => void log.push(`unregister ${id}`),
      openRight: (id) => void log.push(`openRight ${id}`),
    },
    panels: { [DEEP_AGENTS_ID]: (m) => (panelUrls.push(`ws://localhost:${runtimePort(m)}/ws`), { id: 'panel.deepagents', title: 'Deep Agent', create: () => ({ element: {} as HTMLElement }) }) },
    projectId: () => 'p1',
    storage: over.storage ?? new MemoryStorage(),
    fetchFn,
    sleep: async () => {},
    healthTimeoutMs: 3000,
    announce: (t) => void announced.push(t),
  };
  return { controller: new MarketplaceController(deps), log, announced, deps, healthUrls, panelUrls };
}

const card = { ...summary, state: 'available', busy: false, progress: '', error: '', installedVersion: '', updateAvailable: false };

describe('marketplace registry list', () => {
  it('renders author, category and install count from a mocked fetch', async () => {
    const { controller } = setup({ token: null });
    await controller.refresh();
    expect(controller.cards()).toEqual([card]);
  });

  it('reports a registry error instead of an empty list', async () => {
    const { controller, deps } = setup();
    deps.registry.list = async () => {
      throw new Error('Registry request failed (500)');
    };
    await controller.refresh();
    expect(controller.listError).toMatch(/500/);
  });
});

describe('marketplace install flow', () => {
  it('downloads the listed version, installs it, records it for the account, starts, polls health, then opens the panel', async () => {
    const { controller, log } = setup();
    await controller.refresh();
    log.length = 0;
    await controller.install(DEEP_AGENTS_ID);
    expect(log).toEqual(['GET bundle 0.1.0', `install p1 ${DEEP_AGENTS_ID}@0.1.0 3b`, 'POST installs Bearer tok', 'start p1', 'health', 'register panel.deepagents', 'openRight panel.deepagents']);
    expect(controller.cards()[0]).toMatchObject({ state: 'installed', progress: 'Healthy', installs: 8, error: '', installedVersion: '0.1.0', updateAvailable: false });
  });

  it('a refused bundle (bad hash or signature) is an error and nothing is recorded or started', async () => {
    const { controller, log, deps } = setup();
    deps.installer.install = async () => {
      throw new Error('Bundle hash mismatch');
    };
    await controller.refresh();
    await controller.install(DEEP_AGENTS_ID);
    expect(controller.cards()[0]).toMatchObject({ state: 'available', error: 'Bundle hash mismatch' });
    expect(log.filter((l) => /installs|start/.test(l))).toEqual([]);
  });

  it('on a /health timeout keeps the runtime running (no stop), shows "still starting" and keeps no panel', async () => {
    const { controller, log, announced } = setup({ healthOk: false });
    await controller.refresh();
    await controller.install(DEEP_AGENTS_ID);
    expect(log).not.toContain('register panel.deepagents');
    expect(log.some((l) => l.startsWith('stop'))).toBe(false);
    expect(controller.cards()[0]!.error).toMatch(/^Runtime still starting - press Reinstall or wait/);
    expect(announced.at(-1)).toMatch(/LangChain Deep Agents: Runtime still starting/);
  });

  it('uninstall stops that plugin\'s runtime, removes its dir, closes the panel and records the uninstall', async () => {
    const { controller, log } = setup();
    await controller.refresh();
    await controller.install(DEEP_AGENTS_ID);
    log.length = 0;
    await controller.uninstall(DEEP_AGENTS_ID);
    expect(log).toEqual([`stop p1 ${DEEP_AGENTS_ID}`, `uninstall p1 ${DEEP_AGENTS_ID}`, 'unregister panel.deepagents', 'DELETE installs Bearer tok']);
    expect(controller.cards()[0]).toMatchObject({ state: 'uninstalled', installs: 6 });
  });

  it('reinstall is uninstall then install, without an uninstall record', async () => {
    const { controller, log } = setup();
    await controller.refresh();
    await controller.install(DEEP_AGENTS_ID);
    log.length = 0;
    await controller.reinstall(DEEP_AGENTS_ID);
    expect(log.filter((l) => /^(stop|uninstall|GET|start|DELETE)/.test(l))).toEqual([`stop p1 ${DEEP_AGENTS_ID}`, `uninstall p1 ${DEEP_AGENTS_ID}`, 'GET bundle 0.1.0', 'start p1']);
    expect(controller.cards()[0]!.state).toBe('installed');
  });

  it('signed out: installs locally and sends no install record', async () => {
    const { controller, log } = setup({ token: null });
    await controller.refresh();
    await controller.install(DEEP_AGENTS_ID);
    await controller.uninstall(DEEP_AGENTS_ID);
    expect(log.filter((l) => /installs|mine/.test(l))).toEqual([]);
  });

  it('keeps going and keeps the previous count when POST installs fails', async () => {
    const { controller, log } = setup({ postFails: true });
    await controller.refresh();
    await controller.install(DEEP_AGENTS_ID);
    expect(log).toContain('register panel.deepagents');
    expect(controller.cards()[0]).toMatchObject({ state: 'installed', progress: 'Healthy', installs: 7, error: '' });
  });
});

describe('marketplace updates', () => {
  it('shows update available when the registry lists a higher version, and Update installs it in place', async () => {
    const storage = new MemoryStorage();
    const old = setup({ storage });
    await old.controller.refresh();
    await old.controller.install(DEEP_AGENTS_ID);
    const next = setup({ storage, listed: '0.2.0' });
    await next.controller.refresh();
    expect(next.controller.cards()[0]).toMatchObject({ version: '0.2.0', installedVersion: '0.1.0', updateAvailable: true });
    await next.controller.reinstall(DEEP_AGENTS_ID);
    expect(next.log).toContain('GET bundle 0.2.0');
    expect(next.controller.cards()[0]).toMatchObject({ installedVersion: '0.2.0', updateAvailable: false });
  });

  it('isNewer compares dotted versions numerically', () => {
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('0.7.38', '0.7.37')).toBe(true);
    expect(isNewer('1.2', '1.2.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  });
});

describe('marketplace account sync', () => {
  it('device B installs what the account installed on device A, and removes what A uninstalled', async () => {
    const storage = new MemoryStorage();
    const b = setup({ storage, records: [{ id: DEEP_AGENTS_ID, version: '0.1.0', installed: true }] });
    await b.controller.refresh();
    expect(b.log).toContain(`install p1 ${DEEP_AGENTS_ID}@0.1.0 3b`);
    expect(b.controller.cards()[0]!.state).toBe('installed');

    const later = setup({ storage, records: [{ id: DEEP_AGENTS_ID, version: '0.1.0', installed: false }] });
    await later.controller.refresh();
    expect(later.log).toContain(`uninstall p1 ${DEEP_AGENTS_ID}`);
    expect(later.log.filter((l) => l.startsWith('DELETE'))).toEqual([]); // already recorded by device A
    expect(later.controller.cards()[0]!.state).toBe('uninstalled');
  });

  it('boot does not auto-install a plugin the account uninstalled on another device', async () => {
    const { controller, log } = setup({ records: [{ id: DEEP_AGENTS_ID, version: '0.1.0', installed: false }] });
    await controller.boot();
    expect(log).toEqual(['GET mine']);
  });
});

describe('marketplace model key', () => {
  it('saving a key reopens the installed plugin panel so it reconnects with the key', async () => {
    const { controller, log, deps } = setup();
    deps.registry.setModelKey = async () => void log.push('PUT key');
    deps.registry.modelKey = async () => ({ provider: 'anthropic', set: true });
    await controller.refresh();
    await controller.install(DEEP_AGENTS_ID);
    log.length = 0;
    await controller.saveModelKey('anthropic', 'sk-ant-test-key');
    expect(log).toEqual(['PUT key', 'unregister panel.deepagents', 'register panel.deepagents', 'openRight panel.deepagents']);
    expect(controller.modelKey).toEqual({ provider: 'anthropic', set: true });
  });
});

describe('marketplace runtime port', () => {
  it('runtimePort reads manifest.runtime.port and falls back to 9410', () => {
    expect(runtimePort({ id: 'x', runtime: { port: 9555 } })).toBe(9555);
    for (const runtime of [undefined, {}, { port: '9555' }, { port: 0 }, { port: 70000 }, { port: 1.5 }]) {
      expect(runtimePort({ id: 'x', runtime })).toBe(9410);
    }
  });

  it('polls /health and builds the panel ws url from the manifest port, not 9410', async () => {
    const { controller, healthUrls, panelUrls } = setup({ manifest: { ...manifest, runtime: { command: 'uv', port: 9555 } } });
    await controller.refresh();
    await controller.install(DEEP_AGENTS_ID);
    expect(healthUrls).toEqual(['http://localhost:9555/health']);
    expect(panelUrls).toEqual(['ws://localhost:9555/ws']);
  });

  it('a hosted runtime is not started locally and its health URL is the backend\'s', async () => {
    const { controller, log, healthUrls, deps } = setup();
    deps.runtimeUrls = () => ({ health: 'http://backend/agent/health', ws: 'ws://backend/agent/ws', hosted: true });
    await controller.refresh();
    await controller.install(DEEP_AGENTS_ID);
    expect(log.some((l) => l.startsWith('start'))).toBe(false);
    expect(healthUrls).toEqual(['http://backend/agent/health']);
  });

  it('browser start hint names the model key env vars and no fake mode', () => {
    expect(new BrowserInstaller().startHint).toContain('ANTHROPIC_API_KEY | OPENAI_API_KEY | GOOGLE_API_KEY');
    expect(new BrowserInstaller().startHint).not.toContain('OMNI_AGENT_FAKE');
  });
});

describe('marketplace auto-install', () => {
  it('runs once per project, restarts the runtime next time, and never after an uninstall', async () => {
    const storage = new MemoryStorage();
    const first = setup({ storage, token: null });
    await first.controller.boot();
    expect(first.log.filter((l) => l.startsWith('GET bundle'))).toHaveLength(1);

    const second = setup({ storage, token: null });
    await second.controller.boot();
    expect(second.log.some((l) => l.startsWith('GET bundle'))).toBe(false);
    expect(second.log).toEqual(['start p1', 'health', 'register panel.deepagents', 'openRight panel.deepagents']);

    await second.controller.refresh();
    await second.controller.uninstall(DEEP_AGENTS_ID);
    const third = setup({ storage, token: null });
    await third.controller.boot();
    expect(third.log).toEqual([]);
  });

  it('registers the panel of an installed plugin before the layout starts', async () => {
    const storage = new MemoryStorage();
    await setup({ storage }).controller.boot();
    const again = setup({ storage });
    again.controller.registerInstalled();
    expect(again.log).toEqual(['register panel.deepagents']);
  });
});

describe('openScriptAndReveal', () => {
  it('opens the ref in the editor and shows the editor dock panel', () => {
    const calls: string[] = [];
    openScriptAndReveal({ open: (ref: string) => void calls.push(`open ${ref}`) }, (id) => void calls.push(`show ${id}`))('scripts/cube.client.js');
    expect(calls).toEqual(['open scripts/cube.client.js', 'show editor']);
  });
});

describe('TauriInstaller', () => {
  it('invokes the four commands with camelCase arguments and the tarball as base64', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const t = new TauriInstaller(async (c, a) => void calls.push([c, a]));
    const release = { id: 'x', version: '1.0.0', manifest, sha256: 'aa', signature: 'bb', size: 3, publicKey: 'cc' };
    await t.install('p1', { tarball: new Uint8Array([104, 105]), release });
    await t.start('p1', manifest);
    await t.stop('p1', 'x');
    await t.uninstall('p1', 'x');
    expect(calls).toEqual([
      ['install_plugin', { projectId: 'p1', tarball: 'aGk=', release }],
      ['start_runtime', { projectId: 'p1', manifest }],
      ['stop_runtime', { projectId: 'p1', id: 'x' }],
      ['uninstall_plugin', { projectId: 'p1', id: 'x' }],
    ]);
  });
});

describe('verifyBundle (browser installer)', () => {
  const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  async function signedBundle(): Promise<PluginBundle> {
    const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const tarball = new TextEncoder().encode('pretend tarball bytes');
    const sha256 = hex(await crypto.subtle.digest('SHA-256', tarball));
    const msg = new TextEncoder().encode(`omni-plugin-v1\nx\n1.0.0\n${sha256}`);
    const signature = hex(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, msg));
    const publicKey = hex(await crypto.subtle.exportKey('raw', keys.publicKey));
    return { tarball, release: { id: 'x', version: '1.0.0', manifest: { id: 'x' }, sha256, signature, size: tarball.length, publicKey } };
  }

  it('accepts a signed bundle and refuses one flipped byte, a wrong version or a wrong signature', async () => {
    const good = await signedBundle();
    await expect(verifyBundle(good)).resolves.toBeUndefined();
    const flipped = good.tarball.slice();
    flipped[3] ^= 1;
    await expect(verifyBundle({ ...good, tarball: flipped })).rejects.toThrow(/hash mismatch/);
    await expect(verifyBundle({ ...good, release: { ...good.release, version: '2.0.0' } })).rejects.toThrow(/signature/);
    const sig = good.release.signature;
    await expect(verifyBundle({ ...good, release: { ...good.release, signature: (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1) } })).rejects.toThrow(/signature/);
    await expect(new BrowserInstaller().install('p1', { ...good, tarball: flipped })).rejects.toThrow(/hash mismatch/);
  });
});

describe('marketplace panel source encoding', () => {
  it('meta line uses U+00B7 and no replacement character', () => {
    const src = readFileSync(new URL('../src/marketplace/panel.ts', import.meta.url), 'utf8');
    const meta = src.split('\n').find((l) => l.includes('mk-meta'))!;
    expect(meta).toContain('\\u00b7'); // source keeps the escape, which renders as U+00B7
    expect(meta).not.toContain('\ufffd');
  });
});
