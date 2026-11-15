// Game-building tools for agents (plan.md Phase 14): start from a curated reference game, check files offline before
// saving, and generate realistic GPS paths for outdoor scenarios. Read-only on the repo's Games/ folder (curated public
// templates only); scripts are syntax-checked with `node --check`, never executed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GAMES = join(ROOT, 'Games');
const WEB = join(ROOT, 'Web');
const NAME = /^[A-Za-z0-9_-]+$/;

function templateFiles(name) {
  if (!NAME.test(name) || !existsSync(join(GAMES, name, 'scene.json'))) throw new Error(`no template "${name}" (see list_templates)`);
  const dir = join(GAMES, name);
  const read = (rel) => readFileSync(join(dir, rel), 'utf8');
  const scene = JSON.parse(read('scene.json'));
  const files = { 'scene.json': read('scene.json') };
  for (const n of scene.serverScripts ?? []) files[`scripts/server/${n}.js`] = read(`scripts/${n}.js`);
  for (const n of scene.clientScripts ?? []) files[`scripts/client/${n}.js`] = read(`scripts/${n}.js`);
  if (existsSync(join(dir, 'pear-game.json'))) files['metadata.json'] = JSON.stringify({ manifest: JSON.parse(read('pear-game.json')) }, null, 2);
  for (const f of readdirSync(dir)) if (f === 'ui.json' || /^scenario.*\.json$/.test(f)) files[f] = read(f);
  return files;
}

function listTemplates() {
  return readdirSync(GAMES).filter((n) => NAME.test(n) && existsSync(join(GAMES, n, 'scene.json'))).map((n) => {
    const s = JSON.parse(readFileSync(join(GAMES, n, 'scene.json'), 'utf8'));
    const has = (f) => existsSync(join(GAMES, n, f));
    return { name: n, title: s.name, runMode: s.runMode, inputs: s.inputs, ui: has('ui.json'), scenario: has('scenario.json') };
  });
}

/** Offline checks of a files map (same layout as save_version). */
function validateGame(files) {
  const errors = [], warnings = [];
  let scene = null;
  try { scene = JSON.parse(files['scene.json'] ?? ''); } catch (e) { errors.push(`scene.json: ${e.message}`); }
  if (scene) {
    for (const [kind, key] of [['server', 'serverScripts'], ['client', 'clientScripts']]) {
      for (const n of scene[key] ?? []) if (!(`scripts/${kind}/${n}.js` in files)) errors.push(`scene.json ${key} lists "${n}" but scripts/${kind}/${n}.js is missing`);
    }
    if (!['screen', 'device'].includes(scene.runMode)) warnings.push('scene.json runMode should be "device" for phone games (or "screen")');
  }
  const tmp = mkdtempSync(join(tmpdir(), 'pear-check-'));
  try {
    for (const [path, src] of Object.entries(files)) {
      if (!path.endsWith('.js')) continue;
      const f = join(tmp, path.replace(/[\\/]/g, '_') + '.mjs');
      writeFileSync(f, src);
      const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
      if (r.status !== 0) errors.push(`${path}: ${(r.stderr || '').split('\n').filter(Boolean).slice(-3).join(' | ').replaceAll(f, path)}`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  if ('ui.json' in files) {
    const r = spawnSync('npx', ['vite-node', 'packages/pear-ui/bin/validate.ts'], { cwd: WEB, input: files['ui.json'], encoding: 'utf8', shell: process.platform === 'win32' });
    try { for (const e of JSON.parse(r.stdout.trim().split('\n').pop()).errors) errors.push(`ui.json: ${e}`); }
    catch { warnings.push(`ui.json not checked (is Web/ installed?): ${(r.stderr || '').slice(-200)}`); }
  } else warnings.push('no ui.json: phones will have no PearUI screens');
  for (const [path, src] of Object.entries(files)) {
    if (!/^scenario.*\.json$/.test(path)) continue;
    try { const s = JSON.parse(src); if (!Array.isArray(s.devices) || !s.devices.length) errors.push(`${path}: needs a non-empty devices array`); }
    catch (e) { errors.push(`${path}: ${e.message}`); }
  }
  return { ok: errors.length === 0, errors, warnings };
}

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
/** Point `meters` from (lat,lng) along `bearingDeg` (great circle). */
export function offset(lat, lng, bearingDeg, meters) {
  const d = meters / R, b = rad(bearingDeg), p1 = rad(lat), l1 = rad(lng);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: +deg(p2).toFixed(7), lng: +deg(l2).toFixed(7) };
}
export function distance(a, b) {
  const dp = rad(b.lat - a.lat), dl = rad(b.lng - a.lng);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Scenario `gps` steps walking legs from start at speed, one fix every everyMs. */
export function gpsPath({ start, legs, speedMps = 1.4, everyMs = 1000, startAt = 0 }) {
  const steps = [{ at: startAt, gps: { ...start } }];
  let at = startAt, cur = { ...start };
  for (const leg of legs) {
    const n = Math.max(1, Math.round((leg.meters / speedMps) * 1000 / everyMs));
    const from = cur;
    for (let i = 1; i <= n; i++) { at += everyMs; cur = offset(from.lat, from.lng, leg.bearingDeg, (leg.meters * i) / n); steps.push({ at, gps: cur }); }
    if (leg.pauseMs) at += leg.pauseMs;
  }
  return { steps, endsAt: at, end: cur };
}

const ll = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export function registerDevTools(server, tool) {
  server.tool('list_templates', 'Curated reference games to start from (e.g. QuickDraw = motion duel, Manhunt = GPS chase). Start new games from the closest one.', {}, tool(async () => listTemplates()));
  server.tool('get_template', 'Files of a reference game in save_version layout. Change titles/ids before saving; scenario files reference the template game id, replace it with yours.', { name: z.string() }, tool(async ({ name }) => templateFiles(name)));
  server.tool('validate_game', 'Offline check of a files map before save_version: scene.json, script syntax (node --check, not executed), ui.json against PearUI v1, scenario shape. Fix every error first.', { files: z.record(z.string()) }, tool(async ({ files }) => validateGame(files)));
  server.tool('geo_path', 'Realistic GPS walk for scenarios: from start, follow legs [{bearingDeg (0=N,90=E), meters, pauseMs?}] at speedMps (1.4 walk, 3 jog). Returns scenario steps [{at, gps}] to paste into a device script.', {
    start: ll, legs: z.array(z.object({ bearingDeg: z.number(), meters: z.number().positive(), pauseMs: z.number().int().min(0).optional() })).min(1),
    speedMps: z.number().positive().max(12).optional(), everyMs: z.number().int().min(200).max(10000).optional(), startAt: z.number().int().min(0).optional(),
  }, tool(async (a) => gpsPath(a)));
  server.tool('geo_measure', 'Distance in meters between two points, and the point at bearing/meters from a. Use to place players and check tag radii.', {
    a: ll, b: ll.optional(), bearingDeg: z.number().optional(), meters: z.number().optional(),
  }, tool(async ({ a, b, bearingDeg, meters }) => ({
    ...(b ? { meters: +distance(a, b).toFixed(2) } : {}),
    ...(bearingDeg !== undefined && meters !== undefined ? { point: offset(a.lat, a.lng, bearingDeg, meters) } : {}),
  })));
}

export const _test = { templateFiles, listTemplates, validateGame };
