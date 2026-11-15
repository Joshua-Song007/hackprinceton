// Offline test of the game-building tools (templates, validate_game, geo). Run: node test-devtools.mjs (needs ../../Web installed)
import assert from 'node:assert/strict';
import { _test, distance, gpsPath, offset } from './src/devtools.js';

const names = _test.listTemplates().map((t) => t.name);
assert.ok(names.includes('QuickDraw'), names.join());
const qd = _test.templateFiles('QuickDraw');
assert.ok(qd['scripts/server/game.js'] && qd['scripts/client/player.js'] && qd['ui.json'], Object.keys(qd).join());
assert.throws(() => _test.templateFiles('../Backend'));
const ok = _test.validateGame(qd);
assert.equal(ok.ok, true, JSON.stringify(ok));
const bad = _test.validateGame({ ...qd, 'scripts/server/game.js': 'export default (function(){ return {', 'ui.json': '{"pearui":1,"route":[],"screens":{}}' });
assert.equal(bad.ok, false);
assert.ok(bad.errors.some((e) => e.startsWith('scripts/server/game.js')) && bad.errors.some((e) => e.startsWith('ui.json')), JSON.stringify(bad.errors));
const a = { lat: 40.3431, lng: -74.6551 };
const b = offset(a.lat, a.lng, 90, 100);
assert.ok(Math.abs(distance(a, b) - 100) < 0.5);
const p = gpsPath({ start: a, legs: [{ bearingDeg: 0, meters: 14 }], speedMps: 1.4, everyMs: 1000 });
assert.equal(p.steps.length, 11);
assert.ok(Math.abs(distance(a, p.end) - 14) < 0.2);
console.log('PASS devtools', names.join(','));
