// Where a plugin lives and runs. Desktop: Tauri commands write the plugin dir and spawn the runtime.
// Browser: no disk and no spawn, so install only records state and the runtime is attached to by URL.
import type { PluginManifest } from './registry';

export interface PluginInstaller {
  /** Shown while waiting for a runtime that this installer cannot spawn itself. */
  readonly startHint?: string;
  install(projectId: string, files: Record<string, string>): Promise<void>;
  uninstall(projectId: string, pluginId: string): Promise<void>;
  start(projectId: string, manifest: PluginManifest): Promise<void>;
  stop(projectId: string): Promise<void>;
}

export type TauriInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/** Tauri v2 injects __TAURI_INTERNALS__ into the webview; going through it avoids a direct dependency on @tauri-apps/api. */
export const tauriInvoke: TauriInvoke = (command, args) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke: TauriInvoke } }).__TAURI_INTERNALS__.invoke(command, args);

export class TauriInstaller implements PluginInstaller {
  constructor(private invoke: TauriInvoke = tauriInvoke) {}

  async install(projectId: string, files: Record<string, string>): Promise<void> {
    await this.invoke('install_plugin', { projectId, files });
  }

  async uninstall(projectId: string, pluginId: string): Promise<void> {
    await this.invoke('uninstall_plugin', { projectId, id: pluginId });
  }

  async start(projectId: string, manifest: PluginManifest): Promise<void> {
    await this.invoke('start_runtime', { projectId, manifest });
  }

  async stop(projectId: string): Promise<void> {
    await this.invoke('stop_runtime', { projectId });
  }
}

export class BrowserInstaller implements PluginInstaller {
  readonly startHint = 'set ANTHROPIC_API_KEY | OPENAI_API_KEY | GOOGLE_API_KEY (or OMNI_AGENT_FAKE=1 for the rehearsal), then cd Plugins/langchain-deepagents && uv run python runtime/server.py';
  async install(): Promise<void> {}
  async uninstall(): Promise<void> {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
