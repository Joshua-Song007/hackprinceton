// Write-path test against a local mock of the Pear API (create_game, save_version, get_game, publish); never touches hosted.
// Run: node test-write.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const GID = '11111111-2222-3333-4444-555555555555';
const blobs = {}, versions = [], seen = [];
const srv = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  seen.push(`${req.method} ${req.url} auth=${req.headers.authorization}`);
  const json = (code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  let m;
  if (req.method === 'POST' && req.url === '/api/games') return json(201, { id: GID, title: JSON.parse(body).title });
  if ((m = /^\/api\/games\/[^/]+\/assets\/([\w.-]+)$/.exec(req.url)) && req.method === 'PUT') {
    const sha256 = createHash('sha256').update(body).digest('hex');
    blobs[sha256] = body;
    return json(200, { name: m[1], sha256, size: body.length, content_type: req.headers['content-type'] });
  }
  if (req.method === 'POST' && req.url === `/api/games/${GID}/versions`) {
    const v = { ...JSON.parse(body), version: versions.length + 1 };
    versions.push(v);
    return json(201, v);
  }
  if ((m = /^\/api\/games\/[^/]+\/versions\/(\w+)$/.exec(req.url))) return json(200, versions[m[1] === 'latest' ? versions.length - 1 : m[1] - 1]);
  if ((m = /^\/api\/assets\/(\w+)$/.exec(req.url))) { res.writeHead(200); return res.end(blobs[m[1]]); }
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
assert.equal(versions[0].assets['ui.json'].content_type, 'application/json');
assert.equal(versions[0].server_scripts.game.startsWith('export default'), true);

const got = await call('get_game', { id });
assert.equal(got.files['ui.json'], ui);
assert.ok(got.files['scripts/server/game.js']);

await call('save_version', { id, files: { 'scene.json': '{"entities":[1]}' } });
const pub = await call('publish', { id, version: 1 });
assert.deepEqual(pub, { published: 1, version: 3 });
assert.deepEqual(versions[2].scene, { entities: [] });

const noScene = await client.callTool({ name: 'save_version', arguments: { id, files: { 'ui.json': ui } } });
assert.ok(noScene.isError && /scene\.json/.test(noScene.content[0].text));
console.log('PASS write-path (mock API,', seen.length, 'requests, bearer auth =', seen[0].split('auth=')[1] + ')');
await client.close();
srv.close();
