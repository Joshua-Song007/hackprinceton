// Pear cloud HTTP client: base URL, auth (token | developer login | passwordless dev), JSON helper.
const DEFAULT_URL = 'https://155-138-208-146.sslip.io';
const CT = { json: 'application/json', html: 'text/html', css: 'text/css', js: 'application/javascript' };

export const cloudUrl = () => (process.env.PEAR_CLOUD_URL || DEFAULT_URL).replace(/\/+$/, '');

// The hosted box uses a self-signed cert; opt in for sslip.io hosts or PEAR_INSECURE=1.
if (/sslip\.io/.test(cloudUrl()) || process.env.PEAR_INSECURE === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let token = process.env.PEAR_TOKEN || null;

export async function authToken() {
  if (token) return token;
  const { PEAR_DEV_USER: user, PEAR_DEV_PASSWORD: password } = process.env;
  const body = user && password
    ? { provider: 'developer', subject: user, password }
    : { provider: 'dev', subject: `pear-mcp-${process.pid}`, display_name: 'Pear MCP' };
  const r = await fetch(`${cloudUrl()}/api/accounts/signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`sign-in failed: HTTP ${r.status}`);
  return (token = (await r.json()).token);
}

/** Authenticated request; returns parsed JSON (or text), throws "HTTP n ..." on failure. */
export async function api(method, path, body, headers = {}) {
  const raw = typeof body === 'string' || body instanceof Uint8Array;
  const r = await fetch(`${cloudUrl()}${path}`, {
    method,
    headers: { authorization: `Bearer ${await authToken()}`, ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${method} ${path}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

export const contentType = (name) => CT[name.split('.').pop().toLowerCase()] || null;

/** Splits a files map into a NewGameVersion body, uploading non-script files as assets. */
export async function buildVersion(id, files, runMode = 'screen') {
  const v = { scene: null, client_scripts: {}, server_scripts: {}, assets: {}, metadata: {}, run_mode: runMode };
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string') throw new Error(`${path}: content must be a string`);
    let m;
    if (path === 'scene.json') v.scene = JSON.parse(content);
    else if (path === 'metadata.json') v.metadata = JSON.parse(content);
    else if ((m = /^scripts\/(client|server)\/([A-Za-z0-9_-]+)\.js$/.exec(path))) v[`${m[1]}_scripts`][m[2]] = content;
    else {
      const ct = contentType(path);
      if (!ct) throw new Error(`${path}: unsupported file type (allowed: .json .html .css .js)`);
      const name = path.replace(/\//g, '_'); // asset names allow only [A-Za-z0-9._-]
      const { sha256, size, content_type } = await api('PUT', `/api/games/${id}/assets/${name}`, new TextEncoder().encode(content), { 'content-type': ct });
      v.assets[name] = { sha256, size, content_type };
    }
  }
  if (!v.scene || typeof v.scene !== 'object') throw new Error('files must include scene.json (a JSON object)');
  return v;
}

/** A version back into a files map; assets are fetched by hash (public GET). */
export async function versionFiles(v) {
  const files = { 'scene.json': JSON.stringify(v.scene, null, 2), 'metadata.json': JSON.stringify(v.metadata, null, 2) };
  for (const [n, s] of Object.entries(v.client_scripts)) files[`scripts/client/${n}.js`] = s;
  for (const [n, s] of Object.entries(v.server_scripts)) files[`scripts/server/${n}.js`] = s;
  for (const [n, a] of Object.entries(v.assets)) {
    const r = await fetch(`${cloudUrl()}/api/assets/${a.sha256}`);
    files[n] = r.ok ? await r.text() : `<asset fetch failed: HTTP ${r.status}>`;
  }
  return files;
}
