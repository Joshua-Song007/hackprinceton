// End-to-end MCP check: drives the exact tool sequence an agent uses to build a location game (Manhunt), over stdio
// against the hosted server, with no model: list_templates → get_template → validate_game → create_game →
// save_version → geo_path → run_scenario. Run: PEAR_DEV_USER=… PEAR_DEV_PASSWORD=… node e2e-manhunt.mjs
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'e2e', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/index.js'], env: process.env }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  assert.ok(!r.isError, `${name}: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { return text; }
};
const step = (s) => console.log(`✓ ${s}`);

const templates = await call('list_templates');
assert.ok(templates.some((t) => t.name === 'Manhunt')); step(`list_templates (${templates.map((t) => t.name).join(', ')})`);
const files = await call('get_template', { name: 'Manhunt' }); step(`get_template Manhunt (${Object.keys(files).length} files)`);
const check = await call('validate_game', { files }); assert.ok(check.ok, JSON.stringify(check.errors)); step('validate_game ok');
const game = await call('create_game', { title: `Manhunt (MCP e2e ${new Date().toISOString().slice(11, 16)})` }); step(`create_game ${game.id}`);
const saved = await call('save_version', { id: game.id, files, run_mode: 'device' }); step(`save_version v${saved.version} assets=${saved.assets}`);
const start = { lat: 40.3431, lng: -74.6551 };
const walk = await call('geo_path', { start, legs: [{ bearingDeg: 90, meters: 60 }], speedMps: 3, everyMs: 1000 });
const near = await call('geo_measure', { a: walk.end, b: { lat: walk.end.lat, lng: walk.end.lng } }); assert.equal(near.meters, 0); step(`geo_path ${walk.steps.length} fixes, ends ${walk.endsAt} ms`);
const scenario = JSON.parse(files['scenario.json']);
scenario.game = game.id;
const report = await call('run_scenario', { scenario });
for (const e of report.expect) console.log(`  ${e.pass ? 'PASS' : 'FAIL'} ${e.device}: ${e.expr}`);
assert.ok(report.ok, report.error || 'expectations failed'); step(`run_scenario ok (lobby ${report.lobby}, ${report.frames.length} frames)`);
await client.close();
console.log(`PASS e2e-manhunt game=${game.id}`);
