// Write-path test against a local mock of the Pear API (create_game, save_version, get_game, publish); never touches hosted.
// Run: node test-write.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const GID = '11111111-2222-3333-4444-555555555555';
const versions = [], seen = [];
const srv = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  seen.push(`${req.method} ${req.url} auth=${req.headers.authorization}`);
  const json = (code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  let m;
  if (req.method === 'POST' && req.url === '/api/games') return json(201, { id: GID, title: JSON.parse(body).title });
  if (req.method === 'POST' && req.url === `/api/games/${GID}/versions`) {
    const v = { ...JSON.parse(body), version: versions.length + 1 };
    // Mirrors the backend publish gate (13.7): listing needs metadata.manifest and a passing metadata.check.
    if (v.listed && !(v.metadata?.manifest && v.metadata?.check?.ok)) return json(422, {});
    versions.push(v);
    return json(201, { ...v, receipt: { version: v.version, check: v.metadata?.check ? 'passed' : 'missing', join: { ws: `/play/${GID}`, default_lobby: 'OPEN' } } });
  }
  if ((m = /^\/api\/games\/[^/]+\/versions\/(\w+)$/.exec(req.url))) return json(200, versions[m[1] === 'latest' ? versions.length - 1 : m[1] - 1]);
  json(404, {});
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));

const client = new Client({ name: 'pear-mcp-write-test', version: '0' });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [new URL('./src/index.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  env: { ...process.env, PEAR_CLOUD_URL: `http://127.0.0.1:${srv.address().port}`, PEAR_TOKEN: 'tok' },
}));
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };

const { id } = await call('create_game', { title: 'Tap Race' });
const ui = '{"pearui":1,"route":[{"screen":"a"}],"screens":{"a":{"type":"text","value":"hi"}}}';
const saved = await call('save_version', { id, files: { 'scene.json': '{"entities":[]}', 'scripts/server/game.js': 'export default (function(){return {};})();', 'ui.json': ui } });
assert.equal(saved.version, 1);
assert.deepEqual(saved.assets, ['ui.json']);
assert.deepEqual(versions[0].assets['ui.json'], { contentType: 'application/json', data: Buffer.from(ui).toString('base64') });
assert.equal(seen.some((l) => l.includes('/assets/')), false);
assert.equal(versions[0].server_scripts.game.startsWith('export default'), true);

const got = await call('get_game', { id });
assert.equal(got.files['ui.json'], ui);
assert.ok(got.files['scripts/server/game.js']);

await call('save_version', { id, files: { 'scene.json': '{"entities":[1]}' } });
const pub = await call('publish', { id, version: 1, description: 'Tap fast', tags: ['party'], releaseNotes: 'v1' });
assert.deepEqual(pub, { published: 1, version: 3, receipt: { version: 3, check: 'passed', join: { ws: `/play/${GID}`, default_lobby: 'OPEN' } } });
assert.equal(versions[2].metadata.check.ok, true);
assert.equal(versions[2].metadata.manifest.format, 'pear-game/1');
assert.deepEqual(versions[2].scene, { entities: [] });
assert.equal(versions[2].listed, true);
assert.deepEqual([versions[2].description, versions[2].tags, versions[2].release_notes], ['Tap fast', ['party'], 'v1']);
assert.equal(versions[1].listed, undefined);

const noScene = await client.callTool({ name: 'save_version', arguments: { id, files: { 'ui.json': ui } } });
assert.ok(noScene.isError && /scene\.json/.test(noScene.content[0].text));
console.log('PASS write-path (mock API,', seen.length, 'requests, bearer auth =', seen[0].split('auth=')[1] + ')');
await client.close();
srv.close();
