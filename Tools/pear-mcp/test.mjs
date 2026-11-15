// Smoke test: spawns the server over stdio and exercises the read-only tools against the hosted server (or PEAR_CLOUD_URL).
// Run: node test.mjs   (needs `npm install` here and in ../../Web)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const client = new Client({ name: 'pear-mcp-test', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [here('./src/index.js')], env: { ...process.env } }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  assert.ok(!r.isError, `${name}: ${r.content[0].text}`);
  return r.content[0].text;
};

const names = (await client.listTools()).tools.map((t) => t.name).sort();
console.log('tools:', names.join(', '));
assert.deepEqual(names, ['create_game', 'geo_measure', 'geo_path', 'get_game', 'get_template', 'kit_reference', 'list_games', 'list_templates', 'publish', 'read_logs', 'run_scenario', 'save_version', 'validate_game']);

const kit = await call('kit_reference');
assert.match(kit, /PEARUI v1/);
assert.match(kit, /SCENARIO/);
assert.match(kit, /Worked example/);
console.log('kit_reference:', kit.length, 'chars');

const games = JSON.parse(await call('list_games'));
console.log('list_games:', games.length, 'games');
assert.ok(Array.isArray(games));

const bad = await client.callTool({ name: 'save_version', arguments: { id: '8ae4ccaf-a6aa-4622-8146-73fc2cd33021', files: { 'x.png': 'no' } } });
assert.ok(bad.isError, 'unsupported file type must be a tool error');

const scenario = JSON.parse(readFileSync(here('../../Games/QuickDraw/scenario.json'), 'utf8'));
const report = JSON.parse(await call('run_scenario', { scenario }));
console.log('run_scenario: ok =', report.ok, JSON.stringify(report.expect.map((e) => ({ by: e.by, pass: e.pass }))));
assert.equal(report.ok, true, 'Quick Draw scenario must pass');

await client.close();
console.log('PASS');
