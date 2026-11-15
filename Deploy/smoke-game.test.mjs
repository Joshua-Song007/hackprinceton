// Tests for the pure part of smoke-game.mjs. Run: node Deploy/smoke-game.test.mjs
import assert from 'node:assert/strict';
import { normalize } from './smoke-game.mjs';

const sc = { name: 'x', durationMs: 5000, devices: [
  { name: 'P', kind: 'phone', role: 'phone', count: 2, script: [{ at: 0, every: 2000, send: { name: 'pos', data: {} } }] },
  { name: 'Ref', kind: 'ipad', role: 'referee' },
], expect: [{ by: 1, device: 'P1', expr: 'a' }] };
const { scenario } = normalize(sc, 'G', 'SMKABCD');
assert.deepEqual(scenario.devices.map((d) => d.name), ['P1', 'P2', 'Ref']);
assert.deepEqual(scenario.devices[0].script.map((s) => s.at), [0, 2000, 4000]);
assert.ok(!('count' in scenario.devices[0]) && scenario.game === 'G' && scenario.lobby === 'SMKABCD' && !('name' in scenario));
assert.match(normalize({ ...sc, devices: [{ name: 'G', script: [{ at: 1, leave: true }] }] }, 'G', 'L').skip, /leave/);
assert.match(normalize({ ...sc, devices: [{ name: 'G', joinAt: 5 }] }, 'G', 'L').skip, /joinAt/);
console.log('PASS smoke-game normalize');
