import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelSpec, PanelView } from '../src/layout';
import { DEEP_AGENTS_ID, MarketplaceController, agentRuntimeUrls, type MarketplaceDeps } from '../src/marketplace/controller';
import { createMarketplacePanel } from '../src/marketplace/panel';
import type { PluginBundle, PluginSummary } from '../src/marketplace/registry';
import { createChatLink, deepAgentPanel } from '../src/panels/deep-agent';
import { Project, templateSnapshot } from '../src/project';

// Node-only UI harness: these tests do not execute the packaged macOS webview.
class NodeElement {
  children: (NodeElement | string)[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, (() => void)[]> = {};
  classList = { add: () => {} };
  value = '';
  hidden = false;
  disabled = false;
  private text: string | null = null;
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  append(...c: (NodeElement | string)[]) { this.children.push(...c); }
  replaceChildren(...c: (NodeElement | string)[]) { this.children = c; this.text = null; }
  addEventListener(t: string, fn: () => void) { (this.listeners[t] ??= []).push(fn); }
  contains() { return false; }
  focus() {}
  set textContent(v: string) { this.text = v; this.children = []; }
  get textContent(): string { return this.text ?? this.children.map((c) => typeof c === 'string' ? c : c.textContent).join(''); }
  fire(t: string) { for (const fn of this.listeners[t] ?? []) fn(); }
  find(pred: (n: NodeElement) => boolean): NodeElement[] {
    return this.children.flatMap((c) => typeof c === 'string' ? [] : [...(pred(c) ? [c] : []), ...c.find(pred)]);
  }
  button(label: string) { return this.find((n) => n.tag === 'button' && n.textContent === label)[0]!; }
}

class Socket {
  static instances: Socket[] = [];
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: { id: string }[] = [];
  constructor(readonly url: string) { Socket.instances.push(this); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.closed = true; this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
}

const summary: PluginSummary = { id: DEEP_AGENTS_ID, name: 'LangChain Deep Agents', version: '0.1.0', author: 'Pear', category: 'AI agents', description: 'Writes scripts.', installs: 1 };
const manifest = { id: DEEP_AGENTS_ID, version: summary.version };
const bundle: PluginBundle = { tarball: new Uint8Array([1]), release: { ...manifest, manifest, sha256: 'aa', signature: 'bb', publicKey: 'cc', size: 1 } };
const PANEL = 'panel.deepagents';
const node = (view: PanelView) => view.element as unknown as NodeElement;
const cleanups: (() => void)[] = [];

function setup(storage = new Map<string, string>()) {
  const log: string[] = [];
  const specs = new Map<string, PanelSpec>();
  const views = new Map<string, PanelView>();
  const project = new Project(templateSnapshot('blank'));
  const chat = createChatLink();
  const identity = { token: 'account-a-token' as string | null, server: 'https://backend-a' };
  const health = { ok: true, offline: false };
  const close = (id: string) => { views.get(id)?.dispose?.(); views.delete(id); };
  const deps: MarketplaceDeps = {
    registry: {
      get signedIn() { return !!identity.token; },
      list: async () => [summary], bundle: async () => { log.push('bundle'); return bundle; },
      mine: async () => [], recordInstall: async () => { log.push('record'); return { installs: 1 }; },
      recordUninstall: async () => ({ installs: 0 }), modelKey: async () => ({ provider: null, set: false }),
      setModelKey: async () => {}, deleteModelKey: async () => {},
    },
    installer: {
      install: async () => { log.push('verify/unpack'); }, uninstall: async () => { log.push('uninstall'); },
      start: async () => { log.push('start'); }, stop: async () => { log.push('stop'); },
    },
    host: {
      register: (spec) => { log.push('register'); specs.set(spec.id, spec); },
      unregister: (id) => { log.push('unregister'); close(id); specs.delete(id); },
      openRight: (id) => { log.push('open'); if (!views.has(id)) views.set(id, specs.get(id)!.create()); },
    },
    panels: { [DEEP_AGENTS_ID]: (m) => deepAgentPanel({ url: deps.runtimeUrls!(m).ws, project, chat, openScript: () => {}, WebSocketImpl: Socket as unknown as typeof WebSocket }) },
    runtimeUrls: (m) => agentRuntimeUrls(m, identity.server, identity.token, 'p1'),
    projectId: () => 'p1', storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); } },
    fetchFn: vi.fn(async () => { log.push('health'); if (health.offline) throw new TypeError('offline'); return new Response('', { status: health.ok ? 200 : 503 }); }) as unknown as typeof fetch,
    healthTimeoutMs: 1000, sleep: async () => {}, announce: () => {},
  };
  cleanups.push(() => { for (const id of views.keys()) close(id); });
  return { controller: new MarketplaceController(deps), deps, log, specs, views, project, chat, identity, health, close, storage };
}

describe('mac-deepagents panel access regression (platform-independent)', () => {
  beforeEach(() => {
    Socket.instances = [];
    vi.stubGlobal('document', { createElement: (tag: string) => new NodeElement(tag), getElementById: () => null });
  });
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('verified hosted install registers the Window-menu panel and opens its tab before health polling', async () => {
    const s = setup();
    await s.controller.refresh();
    await s.controller.install(DEEP_AGENTS_ID);
    expect(s.log).toEqual(['bundle', 'verify/unpack', 'record', 'register', 'open', 'health']);
    expect(s.specs.get(PANEL)?.title).toBe('Deep Agent');
    expect(s.views.has(PANEL)).toBe(true);
    expect(s.controller.cards()[0]).toMatchObject({ state: 'installed', error: '', progress: 'Healthy' });
  });

  it.each([false, true])('failed hosted health (offline=%s) keeps the panel with actionable Retry now', async (offline) => {
    const s = setup();
    s.health.ok = false;
    s.health.offline = offline;
    await s.controller.refresh();
    await s.controller.install(DEEP_AGENTS_ID);
    expect(s.controller.cards()[0]).toMatchObject({ state: 'installed', error: expect.stringMatching(/hosted.*Retry now.*Open/) });
    expect(s.specs.has(PANEL)).toBe(true);
    const root = node(s.views.get(PANEL)!);
    const first = Socket.instances.at(-1)!;
    first.onerror?.();
    expect(root.textContent).toContain('saved model API key in Marketplace');
    expect(root.button('Retry now').hidden).toBe(false);
    root.button('Retry now').fire('click');
    expect(first.closed).toBe(true);
    expect(Socket.instances).toHaveLength(2);
    Socket.instances.at(-1)!.open();
    expect(root.button('Send').disabled).toBe(false);
    expect(root.button('Retry now').hidden).toBe(true);
    s.health.ok = true;
    s.health.offline = false;
    await s.controller.open(DEEP_AGENTS_ID);
    expect(s.controller.cards()[0]?.error).toBe('');
    expect(s.log.filter((e) => e === 'bundle' || e === 'verify/unpack')).toEqual(['bundle', 'verify/unpack']);
  });

  it('the installed card Open action reopens a closed panel without reinstalling', async () => {
    const s = setup();
    await s.controller.refresh();
    await s.controller.install(DEEP_AGENTS_ID);
    s.close(PANEL);
    s.log.length = 0;
    const marketplace = createMarketplacePanel(s.controller);
    cleanups.push(() => marketplace.dispose?.());
    await vi.waitFor(() => expect(node(marketplace).button('Open')?.disabled).toBe(false));
    const open = node(marketplace).button('Open');
    expect(open.attrs['aria-label']).toBe('Open LangChain Deep Agents');
    open.fire('click');
    await vi.waitFor(() => expect(s.controller.cards()[0]?.busy).toBe(false));
    expect(s.views.has(PANEL)).toBe(true);
    expect(s.log).toEqual(['register', 'open', 'health']);
  });

  it('restores installed registration before layout start and reopens on boot despite failed health', async () => {
    const first = setup();
    await first.controller.install(DEEP_AGENTS_ID);
    first.close(PANEL);
    const next = setup(first.storage);
    next.health.ok = false;
    next.controller.registerInstalled();
    expect(next.log).toEqual(['register']);
    expect(next.specs.has(PANEL)).toBe(true);
    await next.controller.boot();
    expect(next.log).toEqual(['register', 'register', 'open', 'health']);
    expect(next.views.has(PANEL)).toBe(true);
    expect(next.controller.runtimeUrlOf(DEEP_AGENTS_ID)?.hosted).toBe(true);
  });

  it('still refuses a failed bundle verification/unpack before any hosted panel is registered', async () => {
    const s = setup();
    s.deps.installer.install = async () => { throw new Error('Bundle signature does not verify'); };
    await s.controller.refresh();
    await s.controller.install(DEEP_AGENTS_ID);
    expect(s.controller.cards()[0]).toMatchObject({ state: 'available', error: 'Bundle signature does not verify' });
    expect(s.specs.size).toBe(0);
    expect(Socket.instances).toHaveLength(0);
    expect(s.log).toEqual(['bundle']);
  });

  it('preserves local timeout safety: starts locally but never registers a panel or stops the process', async () => {
    const s = setup();
    s.identity.token = null;
    s.health.ok = false;
    await s.controller.refresh();
    await s.controller.install(DEEP_AGENTS_ID);
    expect(s.log).toEqual(['bundle', 'verify/unpack', 'start', 'health']);
    expect(s.controller.cards()[0]?.error).toMatch(/^Runtime still starting/);
    expect(s.specs.size).toBe(0);
  });

  it('remounts on token/account/backend changes and logout without stale writes, preserving only the unsent draft', async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.controller.install(DEEP_AGENTS_ID);
    const old = Socket.instances.at(-1)!;
    old.open();
    const root = node(s.views.get(PANEL)!);
    const input = root.find((n) => n.tag === 'textarea')[0]!;
    input.value = 'sent prompt';
    root.button('Send').fire('click');
    const id = old.sent[0]!.id;
    s.chat.send('unsent instructions');
    s.identity.token = 'account-b-token';
    s.identity.server = 'https://backend-b';
    s.controller.remountPanels();
    expect(old.closed).toBe(true);
    expect(Socket.instances.at(-1)!.url).toBe('wss://backend-b/agent/ws?token=account-b-token&project=p1');
    old.onmessage?.({ data: JSON.stringify({ type: 'file_written', id, path: 'scripts/stale.client.js', content: 'stale account output' }) });
    old.onopen?.();
    old.onerror?.();
    old.onclose?.();
    expect(s.project.scripts('client').stale).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    const remounted = node(s.views.get(PANEL)!);
    expect(remounted.find((n) => n.tag === 'textarea')[0]?.value).toBe('unsent instructions');
    expect(remounted.find((n) => n.tag === 'select')[0]?.value).toBe('instructions');
    expect(Socket.instances.at(-1)!.sent).toEqual([]);
    const beforeRotation = Socket.instances.at(-1)!;
    s.identity.token = 'account-b-refreshed-token';
    s.controller.remountPanels();
    expect(beforeRotation.closed).toBe(true);
    expect(Socket.instances.at(-1)!.url).toBe('wss://backend-b/agent/ws?token=account-b-refreshed-token&project=p1');
    const previous = Socket.instances.at(-1)!;
    s.identity.token = null;
    s.controller.remountPanels();
    expect(previous.closed).toBe(true);
    expect(Socket.instances.at(-1)!.url).toBe('ws://localhost:9410/ws');
    expect(s.log.slice(-3)).toEqual(['unregister', 'register', 'open']);
  });
});
