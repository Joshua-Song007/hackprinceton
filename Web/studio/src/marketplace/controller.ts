// Marketplace logic without DOM: install state per project (localStorage), the install/uninstall flows and the card view-model.
import type { LayoutManager, PanelSpec } from '../layout';
import { announce } from '../ui';
import { waitHealthy } from './health';
import type { PluginInstaller } from './installer';
import type { PluginManifest, PluginSummary, RegistryClient } from './registry';

export const DEEP_AGENTS_ID = 'langchain-deepagents';
const DEFAULT_RUNTIME_PORT = 9410;

/** The port the plugin's runtime listens on (manifest.runtime.port), 9410 when the manifest names none. */
export function runtimePort(manifest: PluginManifest): number {
  const port = (manifest.runtime as { port?: unknown } | undefined)?.port;
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_RUNTIME_PORT;
}

type StoredPlugin = { state: 'installed'; manifest: PluginManifest } | { state: 'uninstalled' };

export interface PluginCard extends PluginSummary {
  state: 'available' | 'installed' | 'uninstalled';
  busy: boolean;
  /** Install progress: Downloaded, Unpacked, Runtime starting, Healthy. Empty when nothing happened this session. */
  progress: string;
  error: string;
}

export interface MarketplaceDeps {
  registry: Pick<RegistryClient, 'list' | 'bundle' | 'recordInstall'>;
  installer: PluginInstaller;
  host: Pick<LayoutManager, 'register' | 'unregister' | 'openRight'>;
  /** Plugin id -> its dockable panel, for plugins that have one. */
  panels: Record<string, (manifest: PluginManifest) => PanelSpec>;
  projectId: () => string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
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

  constructor(private deps: MarketplaceDeps) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private get storageKey(): string {
    return `omni.studio.plugins.${this.deps.projectId()}`;
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
    return this.plugins.map((p) => ({
      ...p,
      state: stored[p.id]?.state ?? 'available',
      busy: this.busy.has(p.id),
      progress: this.progress.get(p.id) ?? '',
      error: this.errors.get(p.id) ?? '',
    }));
  }

  async refresh(): Promise<void> {
    try {
      this.plugins = await this.deps.registry.list();
      this.errors.delete('');
    } catch (e) {
      this.fail('', e);
    }
    this.emit();
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
    this.errors.set(id, message);
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

  reinstall(id: string): Promise<void> {
    return this.run(id, async () => {
      await this.doUninstall(id);
      await this.doInstall(id);
    });
  }

  private async doInstall(id: string): Promise<void> {
    const projectId = this.deps.projectId();
    const bundle = await this.deps.registry.bundle(id);
    this.step(id, 'Downloaded');
    await this.deps.installer.install(projectId, bundle.files);
    this.step(id, 'Unpacked');
    const { installs } = await this.deps.registry.recordInstall(id);
    const listed = this.plugins.find((p) => p.id === id);
    if (listed) listed.installs = installs;
    // Recorded before the runtime is up: a runtime that fails to start is retried by Reinstall, not by another auto-install.
    this.write(id, { state: 'installed', manifest: bundle.manifest });
    await this.launch(id, bundle.manifest);
  }

  private async doUninstall(id: string): Promise<void> {
    const projectId = this.deps.projectId();
    await this.deps.installer.stop(projectId);
    await this.deps.installer.uninstall(projectId, id);
    const stored = this.read()[id];
    const panel = stored?.state === 'installed' ? this.deps.panels[id]?.(stored.manifest) : undefined;
    if (panel) this.deps.host.unregister(panel.id);
    this.write(id, { state: 'uninstalled' });
    this.progress.delete(id);
  }

  /** Starts the runtime, waits for /health, then docks the plugin's panel to the right of the viewport. */
  private async launch(id: string, manifest: PluginManifest): Promise<void> {
    const projectId = this.deps.projectId();
    const hint = this.deps.installer.startHint ? ` Start it with: ${this.deps.installer.startHint}` : '';
    this.step(id, `Runtime starting.${hint}`);
    await this.deps.installer.start(projectId, manifest);
    try {
      await waitHealthy(`http://localhost:${runtimePort(manifest)}/health`, { fetchFn: this.deps.fetchFn, sleep: this.deps.sleep, timeoutMs: this.deps.healthTimeoutMs });
    } catch (e) {
      await this.deps.installer.stop(projectId).catch(() => {});
      throw new Error(`${e instanceof Error ? e.message : String(e)}.${hint}`);
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

  /** Studio start: install the Deep Agents plugin if this project never had it, restart the runtimes of installed plugins. */
  async boot(): Promise<void> {
    const stored = this.read();
    if (!stored[DEEP_AGENTS_ID]) await this.install(DEEP_AGENTS_ID);
    for (const [id, p] of Object.entries(stored)) {
      if (p.state === 'installed') await this.run(id, () => this.launch(id, p.manifest));
    }
  }
}
