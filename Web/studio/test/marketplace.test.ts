import { describe, expect, it } from 'vitest';
import { DEEP_AGENTS_ID, MarketplaceController, type MarketplaceDeps } from '../src/marketplace/controller';
import { TauriInstaller, type PluginInstaller } from '../src/marketplace/installer';
import { RegistryClient, type PluginSummary } from '../src/marketplace/registry';

const summary: PluginSummary = {
  id: DEEP_AGENTS_ID, name: 'LangChain Deep Agents', version: '0.1.0', author: 'Omni', category: 'AI agents', description: 'Writes scripts.', installs: 7,
};
const manifest = { id: DEEP_AGENTS_ID, name: summary.name };

class MemoryStorage {
  private data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
}

/** Every collaborator writes into one ordered log, so tests assert the sequence of the flow. */
function setup(over: { healthOk?: boolean; storage?: MemoryStorage } = {}) {
  const log: string[] = [];
  const announced: string[] = [];
  const installer: PluginInstaller = {
    install: async (project, files) => void log.push(`install ${project} ${Object.keys(files).join(',')}`),
    uninstall: async (project, id) => void log.push(`uninstall ${project} ${id}`),
    start: async (project) => void log.push(`start ${project}`),
    stop: async (project) => void log.push(`stop ${project}`),
  };
  const fetchFn = (async (url: string, init?: RequestInit) => {
    if (url.endsWith('/health')) {
      log.push('health');
      return new Response('{}', { status: over.healthOk === false ? 503 : 200 });
    }
    if (url.endsWith('/bundle')) {
      log.push('GET bundle');
      return Response.json({ manifest, files: { 'omni-plugin.json': '{}' } });
    }
    if (init?.method === 'POST') {
      log.push('POST installs');
      return Response.json({ installs: 8 });
    }
    return Response.json([summary]);
  }) as unknown as typeof fetch;
  const deps: MarketplaceDeps = {
    registry: new RegistryClient(() => 'http://backend', fetchFn),
    installer,
    host: {
      register: (spec) => void log.push(`register ${spec.id}`),
      unregister: (id) => void log.push(`unregister ${id}`),
      openRight: (id) => void log.push(`openRight ${id}`),
    },
    panels: { [DEEP_AGENTS_ID]: () => ({ id: 'panel.deepagents', title: 'Deep Agent', create: () => ({ element: {} as HTMLElement }) }) },
    projectId: () => 'p1',
    storage: over.storage ?? new MemoryStorage(),
    fetchFn,
    sleep: async () => {},
    healthTimeoutMs: 3000,
    announce: (t) => void announced.push(t),
  };
  return { controller: new MarketplaceController(deps), log, announced, deps };
}

describe('marketplace registry list', () => {
  it('renders author, category and install count from a mocked fetch', async () => {
    const { controller } = setup();
    await controller.refresh();
    expect(controller.cards()).toEqual([{ ...summary, state: 'available', busy: false, progress: '', error: '' }]);
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
  it('installs, records the install, starts, polls health, then registers and opens the panel to the right', async () => {
    const { controller, log } = setup();
    await controller.refresh();
    log.length = 0;
    await controller.install(DEEP_AGENTS_ID);
    expect(log).toEqual(['GET bundle', 'install p1 omni-plugin.json', 'POST installs', 'start p1', 'health', 'register panel.deepagents', 'openRight panel.deepagents']);
    expect(controller.cards()[0]).toMatchObject({ state: 'installed', progress: 'Healthy', installs: 8, error: '' });
  });

  it('shows an error when /health never answers, stops the runtime and keeps no panel', async () => {
    const { controller, log, announced } = setup({ healthOk: false });
    await controller.refresh();
    await controller.install(DEEP_AGENTS_ID);
    expect(log).not.toContain('register panel.deepagents');
    expect(log.at(-1)).toBe('stop p1');
    expect(controller.cards()[0]!.error).toMatch(/did not answer .*\/health within 3 s/);
    expect(announced.at(-1)).toMatch(/LangChain Deep Agents: The runtime did not answer/);
  });

  it('uninstall stops the runtime, removes the plugin dir and closes the panel', async () => {
    const { controller, log } = setup();
    await controller.refresh();
    await controller.install(DEEP_AGENTS_ID);
    log.length = 0;
    await controller.uninstall(DEEP_AGENTS_ID);
    expect(log).toEqual(['stop p1', `uninstall p1 ${DEEP_AGENTS_ID}`, 'unregister panel.deepagents']);
    expect(controller.cards()[0]!.state).toBe('uninstalled');
  });

  it('reinstall is uninstall then install', async () => {
    const { controller, log } = setup();
    await controller.refresh();
    await controller.install(DEEP_AGENTS_ID);
    log.length = 0;
    await controller.reinstall(DEEP_AGENTS_ID);
    expect(log.filter((l) => /^(stop|uninstall|GET|start)/.test(l))).toEqual(['stop p1', `uninstall p1 ${DEEP_AGENTS_ID}`, 'GET bundle', 'start p1']);
    expect(controller.cards()[0]!.state).toBe('installed');
  });
});

describe('marketplace auto-install', () => {
  it('runs once per project, restarts the runtime next time, and never after an uninstall', async () => {
    const storage = new MemoryStorage();
    const first = setup({ storage });
    await first.controller.boot();
    expect(first.log.filter((l) => l === 'GET bundle')).toHaveLength(1);

    const second = setup({ storage });
    await second.controller.boot();
    expect(second.log).not.toContain('GET bundle');
    expect(second.log).toEqual(['start p1', 'health', 'register panel.deepagents', 'openRight panel.deepagents']);

    await second.controller.refresh();
    await second.controller.uninstall(DEEP_AGENTS_ID);
    const third = setup({ storage });
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

describe('TauriInstaller', () => {
  it('invokes the four commands with camelCase arguments', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const t = new TauriInstaller(async (c, a) => void calls.push([c, a]));
    await t.install('p1', { a: 'b' });
    await t.start('p1', manifest);
    await t.stop('p1');
    await t.uninstall('p1', 'x');
    expect(calls).toEqual([
      ['install_plugin', { projectId: 'p1', files: { a: 'b' } }],
      ['start_runtime', { projectId: 'p1', manifest }],
      ['stop_runtime', { projectId: 'p1' }],
      ['uninstall_plugin', { projectId: 'p1', id: 'x' }],
    ]);
  });
});
