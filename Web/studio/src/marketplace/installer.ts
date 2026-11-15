// Where a plugin lives and runs. Desktop: Tauri commands write the plugin dir and spawn the runtime.
// Browser: no disk and no spawn, so install only records state and the runtime is attached to by URL.
import type { PluginBundle, PluginManifest } from './registry';

export interface PluginInstaller {
  /** Shown while waiting for a runtime that this installer cannot spawn itself. */
  readonly startHint?: string;
  /** Verifies the bundle (hash, signature) and unpacks it; refuses a tampered one. */
  install(projectId: string, bundle: PluginBundle): Promise<void>;
  uninstall(projectId: string, pluginId: string): Promise<void>;
  start(projectId: string, manifest: PluginManifest): Promise<void>;
  stop(projectId: string, pluginId: string): Promise<void>;
}

export type TauriInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/** Tauri v2 injects __TAURI_INTERNALS__ into the webview; going through it avoids a direct dependency on @tauri-apps/api. */
export const tauriInvoke: TauriInvoke = (command, args) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke: TauriInvoke } }).__TAURI_INTERNALS__.invoke(command, args);

export class TauriInstaller implements PluginInstaller {
  constructor(private invoke: TauriInvoke = tauriInvoke) {}

  async install(projectId: string, bundle: PluginBundle): Promise<void> {
    // The desktop shell checks the SHA-256 and signature in Rust before it writes anything.
    await this.invoke('install_plugin', { projectId, tarball: toBase64(bundle.tarball), release: bundle.release });
  }

  async uninstall(projectId: string, pluginId: string): Promise<void> {
    await this.invoke('uninstall_plugin', { projectId, id: pluginId });
  }

  async start(projectId: string, manifest: PluginManifest): Promise<void> {
    await this.invoke('start_runtime', { projectId, manifest });
  }

  async stop(projectId: string, pluginId: string): Promise<void> {
    await this.invoke('stop_runtime', { projectId, id: pluginId });
  }
}

export class BrowserInstaller implements PluginInstaller {
  readonly startHint = 'sign in to use the hosted runtime, or set ANTHROPIC_API_KEY | OPENAI_API_KEY | GOOGLE_API_KEY, then cd Plugins/langchain-deepagents && uv run python runtime/server.py';
  /** No disk here, but a tampered download is still refused, so both installers behave the same. */
  async install(_projectId: string, bundle: PluginBundle): Promise<void> {
    await verifyBundle(bundle);
  }
  async uninstall(): Promise<void> {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function unhex(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));
}

/** SHA-256 and Ed25519 signature check with WebCrypto (same message as Backend/src/crypto.rs signed_message). */
export async function verifyBundle({ tarball, release }: PluginBundle): Promise<void> {
  const sha = hex(await crypto.subtle.digest('SHA-256', tarball as Uint8Array<ArrayBuffer>));
  if (sha !== release.sha256) throw new Error(`Bundle hash mismatch: got ${sha}, registry says ${release.sha256}`);
  const key = await crypto.subtle.importKey('raw', unhex(release.publicKey), { name: 'Ed25519' }, false, ['verify']);
  const message = new TextEncoder().encode(`pear-plugin-v1\n${release.id}\n${release.version}\n${release.sha256}`);
  if (!(await crypto.subtle.verify({ name: 'Ed25519' }, key, unhex(release.signature), message))) throw new Error('Bundle signature does not verify');
}
