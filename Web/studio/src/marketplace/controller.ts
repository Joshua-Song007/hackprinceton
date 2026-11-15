// Marketplace logic without DOM: install state per project (localStorage), synced with the signed-in account's
// install records across devices, the install/uninstall/update flows and the card view-model.
import type { LayoutManager, PanelSpec } from '../layout';
import { announce } from '../ui';
import { waitHealthy } from './health';
import type { PluginInstaller } from './installer';
import type { InstallRecord, ModelProvider, PluginManifest, PluginSummary, RegistryClient } from './registry';

export const DEEP_AGENTS_ID = 'langchain-deepagents';
const DEFAULT_RUNTIME_PORT = 9410;

/** The port the plugin's runtime listens on (manifest.runtime.port), 9410 when the manifest names none. */
export function runtimePort(manifest: PluginManifest): number {
  const port = (manifest.runtime as { port?: unknown } | undefined)?.port;
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_RUNTIME_PORT;
}

/** Where a plugin's runtime answers. `hosted` = the backend's /agent proxy (no local process to start). */
export interface RuntimeUrls {
  health: string;
  ws: string;
  hosted: boolean;
}

export function localRuntimeUrls(manifest: PluginManifest): RuntimeUrls {
  const port = runtimePort(manifest);
  return { health: `http://localhost:${port}/health`, ws: `ws://localhost:${port}/ws`, hosted: false };
}

/** The backend's /agent proxy to its hosted runtime ('' base = this page's origin). */
export function hostedRuntimeUrls(serverUrl: string, token: string, projectId: string): RuntimeUrls {
  const base = (serverUrl || location.origin).replace(/\/$/, '');
  const q = new URLSearchParams({ token, project: projectId });
  return { health: `${base}/agent/health`, ws: `${base.replace(/^http/, 'ws')}/agent/ws?${q}`, hosted: true };
}

/** True when version `a` is higher than `b` ("0.10" > "0.9.9"); non-numeric parts count as 0. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

type StoredPlugin = { state: 'installed'; manifest: PluginManifest } | { state: 'uninstalled' };

export interface PluginCard extends PluginSummary {
  state: 'available' | 'installed' | 'uninstalled';
  busy: boolean;
  /** Install progress: Downloaded, Unpacked, Runtime starting, Healthy. Empty when nothing happened this session. */
  progress: string;
  error: string;
  /** Version on disk, '' when not installed. */
  installedVersion: string;
  /** The registry lists a higher version than the installed one. */
  updateAvailable: boolean;
}

export interface MarketplaceDeps {
  registry: Pick<RegistryClient, 'list' | 'bundle' | 'recordInstall' | 'recordUninstall' | 'mine' | 'signedIn' | 'modelKey' | 'setModelKey' | 'deleteModelKey'>;
  installer: PluginInstaller;
  host: Pick<LayoutManager, 'register' | 'unregister' | 'openRight'>;
  /** Plugin id -> its dockable panel, for plugins that have one. */
  panels: Record<string, (manifest: PluginManifest) => PanelSpec>;
  projectId: () => string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  /** Defaults to the local runtime on the manifest's port. */
  runtimeUrls?: (manifest: PluginManifest) => RuntimeUrls;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  healthTimeoutMs?: number;
  announce?: (text: string) => void;
}

export class MarketplaceController {
  private plugins: PluginSummary[] = [];
  private progress = new Map<string, string>();
  private errors = new Map<string, string>();
  private busy = new Set<string>();
  private listeners = new Set<() => void>();

  /** The account's stored model key (provider only; the key never comes back), null when signed out or unknown. */
  modelKey: { provider: ModelProvider | null; set: boolean } | null = null;
  modelKeyError = '';

  constructor(private deps: MarketplaceDeps) {}

  get signedIn(): boolean {
    return this.deps.registry.signedIn;
  }

  private async keyAction(work: () => Promise<void>): Promise<void> {
    this.modelKeyError = '';
    try {
      await work();
      this.modelKey = this.signedIn ? await this.deps.registry.modelKey() : null;
    } catch (e) {
      this.modelKeyError = e instanceof Error ? e.message : String(e);
    }
    this.emit();
  }

  loadModelKey(): Promise<void> {
    return this.keyAction(async () => {});
  }

  saveModelKey(provider: ModelProvider, key: string): Promise<void> {
    return this.keyAction(async () => {
      await this.deps.registry.setModelKey(provider, key);
      this.remountPanels();
    });
  }

  removeModelKey(): Promise<void> {
    return this.keyAction(async () => {
      await this.deps.registry.deleteModelKey();
      this.remountPanels();
    });
  }

  /** The hosted runtime reads the account's key when a panel connects, so a key change reopens installed plugins' panels. */
  private remountPanels(): void {
    for (const [id, p] of Object.entries(this.read())) {
      const panel = p.state === 'installed' ? this.deps.panels[id]?.(p.manifest) : undefined;
      if (!panel) continue;
      this.deps.host.unregister(panel.id);
      this.deps.host.register(panel);
      this.deps.host.openRight(panel.id);
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private get storageKey(): string {
    return `pear.studio.plugins.${this.deps.projectId()}`;
  }

  private read(): Record<string, StoredPlugin> {
    try {
      return JSON.parse(this.deps.storage.getItem(this.storageKey) ?? '{}') as Record<string, StoredPlugin>;
    } catch {
      return {};
    }
  }

  private write(id: string, value: StoredPlugin): void {
    this.deps.storage.setItem(this.storageKey, JSON.stringify({ ...this.read(), [id]: value }));
  }

  cards(): PluginCard[] {
    const stored = this.read();
    return this.plugins.map((p) => {
      const s = stored[p.id];
      const installedVersion = s?.state === 'installed' ? String(s.manifest.version ?? '') : '';
      return {
        ...p,
        state: s?.state ?? 'available',
        busy: this.busy.has(p.id),
        progress: this.progress.get(p.id) ?? '',
        error: this.errors.get(p.id) ?? '',
        installedVersion,
        updateAvailable: !!installedVersion && isNewer(p.version, installedVersion),
      };
    });
  }

  /** Reloads the list, then applies this account's installs and uninstalls from other devices. */
  async refresh(): Promise<void> {
    this.errors.delete('');
    try {
      this.plugins = await this.deps.registry.list();
      // An empty list is the unseeded server: the install of the default plugin would 404 on it.
      if (!this.plugins.length) this.errors.set('', 'The registry has no plugins yet: this server has not published any (its seed job has not run). Ask the server admin to run it, then Retry.');
    } catch (e) {
      this.fail('', e);
    }
    this.emit();
    await this.sync();
  }

  /** The account's install records, or null when signed out or the request failed (local state stays as is). */
  private async accountRecords(): Promise<Map<string, InstallRecord> | null> {
    if (!this.deps.registry.signedIn) return null;
    try {
      return new Map((await this.deps.registry.mine()).map((r) => [r.id, r]));
    } catch {
      return null;
    }
  }

  /**
   * Cross-device sync: a plugin the account installed elsewhere is installed here, one it uninstalled
   * elsewhere is uninstalled here. Returns the records (null when signed out) so boot can reuse them.
   */
  async sync(records?: Map<string, InstallRecord> | null): Promise<Map<string, InstallRecord> | null> {
    records = records === undefined ? await this.accountRecords() : records;
    if (!records) return null;
    const stored = this.read();
    for (const [id, r] of records) {
      const local = stored[id]?.state;
      if (r.installed && local !== 'installed') await this.run(id, () => this.doInstall(id));
      else if (!r.installed && local === 'installed') await this.run(id, () => this.doUninstall(id, false));
    }
    return records;
  }

  /** Registry-level error under id '' (no plugin owns it). */
  get listError(): string {
    return this.errors.get('') ?? '';
  }

  private say(text: string): void {
    (this.deps.announce ?? announce)(text);
  }

  private fail(id: string, e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    // A plugin with no card (not in the registry list) would hide its error: show it as the list error, unless one is already shown.
    const owner = this.plugins.some((p) => p.id === id) ? id : '';
    if (owner || !this.errors.has('')) this.errors.set(owner, message);
    this.progress.delete(id);
    this.say(`${(this.plugins.find((p) => p.id === id)?.name ?? id) || 'Marketplace'}: ${message}`);
  }

  private step(id: string, text: string): void {
    this.progress.set(id, text);
    this.emit();
  }

  private async run(id: string, work: () => Promise<void>): Promise<void> {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    this.errors.delete(id);
    this.emit();
    try {
      await work();
    } catch (e) {
      this.fail(id, e);
    } finally {
      this.busy.delete(id);
      this.emit();
    }
  }

  install(id: string): Promise<void> {
    return this.run(id, () => this.doInstall(id));
  }

  uninstall(id: string): Promise<void> {
    return this.run(id, () => this.doUninstall(id));
  }

  /** Reinstall, and also Update: the install fetches the listed (newest approved) version. */
  reinstall(id: string): Promise<void> {
    return this.run(id, async () => {
      await this.doUninstall(id, false);
      await this.doInstall(id);
    });
  }

  private setInstalls(id: string, installs: number): void {
    const listed = this.plugins.find((p) => p.id === id);
    if (listed) listed.installs = installs;
  }

  private async doInstall(id: string): Promise<void> {
    const projectId = this.deps.projectId();
    const bundle = await this.deps.registry.bundle(id);
    this.step(id, 'Downloaded');
    await this.deps.installer.install(projectId, bundle);
    this.step(id, 'Unpacked');
    const manifest = { ...bundle.release.manifest, version: bundle.release.version };
    if (this.deps.registry.signedIn) {
      // Best-effort: the plugin is already unpacked, so a failing record keeps the previous count and the install goes on.
      // The server keeps one record per account, so a reinstall or a second device does not count twice.
      try {
        this.setInstalls(id, (await this.deps.registry.recordInstall(id, bundle.release.version)).installs);
      } catch {}
    }
    // Recorded before the runtime is up: a runtime that fails to start is retried by Reinstall, not by another auto-install.
    this.write(id, { state: 'installed', manifest });
    await this.launch(id, manifest);
  }

  /** `record` false: a reinstall, or an uninstall that came from the account (already recorded). */
  private async doUninstall(id: string, record = true): Promise<void> {
    const projectId = this.deps.projectId();
    await this.deps.installer.stop(projectId, id);
    await this.deps.installer.uninstall(projectId, id);
    const stored = this.read()[id];
    const panel = stored?.state === 'installed' ? this.deps.panels[id]?.(stored.manifest) : undefined;
    if (panel) this.deps.host.unregister(panel.id);
    this.write(id, { state: 'uninstalled' });
    this.progress.delete(id);
    if (record && this.deps.registry.signedIn) {
      try {
        this.setInstalls(id, (await this.deps.registry.recordUninstall(id)).installs);
      } catch {}
    }
  }

  /** Starts the runtime, waits for /health, then docks the plugin's panel to the right of the viewport. */
  private async launch(id: string, manifest: PluginManifest): Promise<void> {
    const projectId = this.deps.projectId();
    const urls = (this.deps.runtimeUrls ?? localRuntimeUrls)(manifest);
    const hint = this.deps.installer.startHint && !urls.hosted ? ` Start it with: ${this.deps.installer.startHint}` : '';
    this.step(id, urls.hosted ? 'Connecting to the hosted runtime.' : `Runtime starting.${hint}`);
    if (!urls.hosted) await this.deps.installer.start(projectId, manifest);
    try {
      await waitHealthy(urls.health, { fetchFn: this.deps.fetchFn, sleep: this.deps.sleep, timeoutMs: this.deps.healthTimeoutMs });
    } catch {
      // The runtime is left running: a first `uv sync` can outlast the poll, and stopping would kill it.
      throw new Error(`Runtime still starting - press Reinstall or wait.${hint}`);
    }
    this.step(id, 'Healthy');
    const panel = this.deps.panels[id]?.(manifest);
    if (panel) {
      this.deps.host.register(panel);
      this.deps.host.openRight(panel.id);
    }
  }

  /** Registers the panels of installed plugins. Call before layout.start() so a saved layout that names them is kept. */
  registerInstalled(): void {
    for (const [id, p] of Object.entries(this.read())) {
      const panel = p.state === 'installed' ? this.deps.panels[id]?.(p.manifest) : undefined;
      if (panel) this.deps.host.register(panel);
    }
  }

  /**
   * Studio start: apply the account's installs from other devices, install the Deep Agents plugin if neither
   * this project nor the account ever had it, then restart the runtimes of the plugins that were already installed.
   */
  async boot(): Promise<void> {
    const before = this.read();
    const records = await this.sync();
    if (!this.read()[DEEP_AGENTS_ID] && !records?.has(DEEP_AGENTS_ID)) await this.install(DEEP_AGENTS_ID);
    for (const [id, p] of Object.entries(this.read())) {
      // Plugins installed just now by sync or auto-install are already running.
      if (p.state === 'installed' && before[id]?.state === 'installed') await this.run(id, () => this.launch(id, p.manifest));
    }
  }
}

/** Link handler of the Deep Agent panel: opens the script tab and reveals the editor dock panel, which may be hidden behind the viewport. */
export function openScriptAndReveal<Ref>(editor: { open(ref: Ref): void }, reveal: (panelId: string) => void): (ref: Ref) => void {
  return (ref) => {
    editor.open(ref);
    reveal('editor');
  };
}
