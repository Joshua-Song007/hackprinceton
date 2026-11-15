// Tests for gen-skill: committed skill is fresh, carries every handler and the manifest facts, and drifted sources fail loudly.
// Run: node Tools/pear-check/test-gen-skill.mjs
import assert from 'node:assert/strict';
import { generate, manifestFacts, stale, tableRows } from './gen-skill.mjs';

const gen = generate();
assert.deepEqual(stale(gen), [], 'committed skill is stale: run node Tools/pear-check/gen-skill.mjs');
const skill = gen['SKILL.md'];
for (const h of ['onLookAt', 'onGesture', 'onTick', 'onPlayerJoin', 'onTimer', 'ctx.after', 'ctx.remote.fireAll', 'ctx.agent.run', 'PEARUI v1', 'sensor(invisible']) assert.ok(skill.includes(h), `skill lacks ${h}`);
assert.ok(skill.startsWith('---\nname: pear-scripting\n'));
for (const g of ['QuickDraw', 'HotPotato', 'Manhunt']) assert.ok(gen[`scaffolds/${g}/scene.json`] && gen[`scaffolds/${g}/scripts/game.js`], `scaffold ${g}`);

const m = manifestFacts("export const MANIFEST_FORMAT = 'pear-game/1';\nexport const MANIFEST_KEYS = ['format', 'name'] as const;\nexport const SENSORS = ['head', 'motion'] as const;\nexport const RAISE_DEFAULTS: RaiseGesture = { angleDeg: 70, hysteresisDeg: 5 };");
assert.deepEqual([m.keys, m.sensors, m.angleDeg], [['format', 'name'], ['head', 'motion'], '70']);
assert.throws(() => manifestFacts('nothing'), /generator needs updating/);
assert.throws(() => tableRows('## Client scripts\n\n### Handlers\n\nno table', 'Client scripts', 'Handlers'), /no table rows/);
assert.throws(() => tableRows('# x', 'Server scripts', 'Members'), /generator needs updating/);
console.log('gen-skill tests passed');
