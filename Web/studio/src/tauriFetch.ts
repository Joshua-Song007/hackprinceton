// Native HTTP is limited to the shipped backend, never arbitrary configured servers.
import { inDesktopApp } from './preferences';

let httpModule: Promise<typeof import('@tauri-apps/plugin-http')> | null = null;

/** Keep in sync with src-tauri/capabilities/default.json. Custom servers use browser CORS. */
export function nativeBackendRequest(input: RequestInfo | URL): boolean {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.origin === 'https://155-138-208-146.sslip.io' && !url.username && !url.password
      && (url.pathname.startsWith('/api/') || url.pathname === '/agent/health');
  } catch {
    return false;
  }
}

export async function tauriFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!inDesktopApp() || import.meta.env.DEV) return fetch(input, init);
  if (!nativeBackendRequest(input)) {
    try {
      return await fetch(input, init);
    } catch {
      throw new Error('Cannot reach the configured server. Custom desktop servers must allow browser CORS; use the default hosted server or configure CORS on your server.');
    }
  }
  // Do not retry with browser fetch: permission/network errors must remain visible, and writes must not repeat.
  if (!httpModule) httpModule = import('@tauri-apps/plugin-http');
  const { fetch: pluginFetch } = await httpModule;
  return pluginFetch(input, { ...init, maxRedirections: 0 });
}
