// Tests for pear-check: the two shipped specs pass, and broken games fail with file-specific errors. Run: node Tools/pear-check/test.mjs
// (needs Web/ and Tools/pear-mcp installed). Each check spawns vite-node, so this takes about a minute.
import assert from 'node:assert/strict';
import { checkDir, checkFiles } from './check.mjs';
import { filesFromDir } from '../pear-mcp/src/devtools.js';

const G = (n) => new URL(`../../Games/${n}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

for (const n of ['QuickDraw', 'HotPotato', 'Flagship']) {
  const r = checkDir(G(n));
  assert.equal(r.ok, true, `${n}: ${JSON.stringify(r.errors)}`);
  assert.ok(r.tested.some((t) => t.startsWith('scenario ')) && r.untested.length > 0, `${n} lists tested and untested`);
}

const hp = filesFromDir(G('HotPotato'));
const run = (files) => checkFiles(files);

// 1. syntax error: schema error names the file, scenarios are reported as skipped
let r = run({ ...hp, 'scripts/server/game.js': 'export default (function(){ return {' });
assert.equal(r.ok, false);
assert.ok(r.errors.some((e) => e.startsWith('schema: scripts/server/game.js')), r.errors.join('\n'));
assert.ok(r.untested.some((u) => u.includes('skipped')));

// 2. handler that throws on a junk event: self-check catches it and names the script
r = run({ ...hp, 'scripts/server/game.js': hp['scripts/server/game.js'].replace('data = data || {};', 'data = data || {}; if (name === "tag" && !data.x) throw new Error("boom");') });
assert.equal(r.ok, false);
assert.ok(r.errors.some((e) => e.includes('scripts/server/game.js') && e.includes('boom')), r.errors.join('\n'));

// 3. failing expectation: error says device, expression and last value
const spec = JSON.parse(hp['check.json']);
spec.scenarios = [{ ...spec.scenarios[1], expect: [{ by: 5000, device: 'Ann', expr: 'ev.winner.id' }] }];
r = run({ ...hp, 'check.json': JSON.stringify(spec) });
assert.equal(r.ok, false);
assert.ok(r.errors.some((e) => e.includes('Ann expected ev.winner.id by 5000 ms')), r.errors.join('\n'));

// 4. no check.json: generic self-check only, stated as untested
r = run(Object.fromEntries(Object.entries(hp).filter(([k]) => k !== 'check.json')));
assert.equal(r.ok, true);
assert.ok(r.untested.some((u) => u.startsWith('check.json missing')));

console.log('PASS pear-check');
