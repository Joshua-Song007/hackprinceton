// Registry client for the plugin routes of the Pear backend: list, release metadata, signed tarball
// bundles, per-account install records and the account's model API key (never read back).
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  author: string;
  category: string;
  description: string;
  installs: number;
}

/** The pear-plugin.json object. Only `id` and `version` are read here; the installer passes the rest to the runtime launcher. */
export type PluginManifest = { id: string; version?: string } & Record<string, unknown>;

/** GET /api/plugins/{id}: the listed version and what its tarball must hash and be signed to. */
export interface PluginRelease {
  id: string;
  version: string;
  manifest: PluginManifest;
  sha256: string;
  signature: string;
  size: number;
}

/** A downloaded bundle: tarball bytes plus the release and the registry key the installer verifies them with. */
export interface PluginBundle {
  tarball: Uint8Array;
  release: PluginRelease & { publicKey: string };
}

export interface InstallRecord {
  id: string;
  version: string;
  installed: boolean;
}

export type ModelProvider = 'anthropic' | 'openai' | 'google';

export class RegistryClient {
  /** `baseUrl` and `token` are read per call so a changed server URL or sign-in applies at once ('' = same origin). */
  constructor(private baseUrl: () => string, private fetchFn: typeof fetch = (...a) => fetch(...a), private token: () => string | null = () => null) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const t = this.token();
    const headers = { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) };
    const base = this.baseUrl();
    let res: Response;
    try {
      res = await this.fetchFn(`${base}/api${path}`, { ...init, headers });
    } catch (e) {
      throw new Error(`Cannot reach the registry at ${base || 'this page'}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) {
      // A proxy's own 502-504 has no JSON body: say that the server answered but its backend did not.
      const gateway = res.status >= 502 && res.status <= 504 ? 'the server answered but its backend is not responding' : undefined;
      const detail = await res.json().then((b: { error?: string }) => b.error ?? gateway, () => gateway);
      throw new Error(`Registry request failed (${res.status})${detail ? `: ${detail}` : ''}`);
    }
    return res;
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await this.request(path, init)).json()) as T;
  }

  get signedIn(): boolean {
    return !!this.token();
  }

  list(): Promise<PluginSummary[]> {
    return this.call('/plugins');
  }

  release(id: string): Promise<PluginRelease> {
    return this.call(`/plugins/${encodeURIComponent(id)}`);
  }

  /** Release metadata, the registry key and the tarball of the listed version. */
  async bundle(id: string): Promise<PluginBundle> {
    const [release, key] = await Promise.all([this.release(id), this.call<{ publicKey: string }>('/plugin-signing-key')]);
    const res = await this.request(`/plugins/${encodeURIComponent(id)}/bundle?version=${encodeURIComponent(release.version)}`);
    return { tarball: new Uint8Array(await res.arrayBuffer()), release: { ...release, publicKey: key.publicKey } };
  }

  recordInstall(id: string, version: string): Promise<{ installs: number }> {
    return this.call(`/plugins/${encodeURIComponent(id)}/installs`, { method: 'POST', body: JSON.stringify({ version }) });
  }

  recordUninstall(id: string): Promise<{ installs: number }> {
    return this.call(`/plugins/${encodeURIComponent(id)}/installs`, { method: 'DELETE' });
  }

  /** This account's install records (every device), for the cross-device sync. */
  mine(): Promise<InstallRecord[]> {
    return this.call('/me/plugins');
  }

  modelKey(): Promise<{ provider: ModelProvider | null; set: boolean }> {
    return this.call('/me/model-key');
  }

  async setModelKey(provider: ModelProvider, key: string): Promise<void> {
    await this.request('/me/model-key', { method: 'PUT', body: JSON.stringify({ provider, key }) });
  }

  async deleteModelKey(): Promise<void> {
    await this.request('/me/model-key', { method: 'DELETE' });
  }
}
