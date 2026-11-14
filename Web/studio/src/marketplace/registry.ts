// Registry client for the plugin routes of the Omni backend (GET /api/plugins, .../{id}/bundle, POST .../{id}/installs).
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  author: string;
  category: string;
  description: string;
  installs: number;
}

/** The omni-plugin.json object. Only `id` is read here; the installer passes the rest to the runtime launcher. */
export type PluginManifest = { id: string } & Record<string, unknown>;

export interface PluginBundle {
  manifest: PluginManifest;
  files: Record<string, string>;
}

export class RegistryClient {
  /** `baseUrl` is read per call so a changed server URL preference applies at once ('' = same origin). */
  constructor(private baseUrl: () => string, private fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl()}/api/plugins${path}`, init);
    if (!res.ok) {
      const detail = await res.json().then((b: { error?: string }) => b.error, () => undefined);
      throw new Error(`Registry request failed (${res.status})${detail ? `: ${detail}` : ''}`);
    }
    return (await res.json()) as T;
  }

  list(): Promise<PluginSummary[]> {
    return this.call('');
  }

  bundle(id: string): Promise<PluginBundle> {
    return this.call(`/${encodeURIComponent(id)}/bundle`);
  }

  recordInstall(id: string): Promise<{ installs: number }> {
    return this.call(`/${encodeURIComponent(id)}/installs`, { method: 'POST' });
  }
}
