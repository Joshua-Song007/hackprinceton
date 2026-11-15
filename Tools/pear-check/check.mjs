// pear-check (plan.md 13.2): one offline command that says whether a game is fit to publish.
//   node Tools/pear-check/check.mjs <game folder | Games/Name> [--full]      exit 0 = every check passed
// Steps: (1) schema: validateGame from Tools/pear-mcp/src/devtools.js; (2) fake-ctx self-check: generic junk-event pass plus
// the folder's own selfcheck script named in check.json; (3) check.json scenarios: N simulated phones in one lobby on
// Tools/pear-check/sim.ts (virtual clock, scripted gestures). The report lists what was tested and what was NOT.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { filesFromDir, validateGame } from '../pear-mcp/src/devtools.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', '..', 'Web');
const tail = (s, n = 400) => String(s ?? '').trim().split('\n').slice(-6).join(' | ').slice(-n);

/**
 * @param {Record<string,string>} files save_version layout (scene.json, scripts/server/*.js, ui.json, check.json ...)
 * @param {{dir?: string, full?: boolean}} opts dir = game folder on disk (enables the folder's own selfcheck script); full keeps frames and final view states of passing scenarios
 */
export function checkFiles(files, { dir, full = false } = {}) {
  const tested = [], untested = [], errors = [];
  const report = { ok: false, tested, untested, errors };

  const schema = validateGame(files);
  report.schema = schema;
  (schema.ok ? tested : errors).push(...(schema.ok ? ['schema: scene.json, script syntax, ui.json, scenario files'] : schema.errors.map((e) => `schema: ${e}`)));

  let spec = null;
  if (!files['check.json']) untested.push('check.json missing: no scenarios, no custom self-check (only the generic self-check ran)');
  else {
    try { spec = JSON.parse(files['check.json']); } catch (e) { errors.push(`check.json: ${e.message}`); }
    if (spec && !Array.isArray(spec.scenarios)) { errors.push('check.json: needs a "scenarios" array'); spec = null; }
  }

  if (!schema.ok) {
    untested.push('self-check and scenarios skipped: fix schema errors first');
    return report;
  }

  if (spec?.selfcheck) {
    const f = dir && join(dir, spec.selfcheck);
    if (!f || !existsSync(f)) untested.push(`self-check script ${spec.selfcheck}: ${dir ? 'file not found' : 'not available without a game folder'}`);
    else {
      const r = spawnSync(process.execPath, [f], { cwd: dir, encoding: 'utf8' });
      report.selfcheckScript = { path: spec.selfcheck, ok: r.status === 0 };
      if (r.status === 0) tested.push(`self-check script ${spec.selfcheck}`);
      else errors.push(`${spec.selfcheck}: ${tail(r.stderr || r.stdout)}`);
    }
  }

  const input = JSON.stringify({ files, scenarios: spec?.scenarios ?? [] });
  const r = spawnSync('npx', ['vite-node', join('..', 'Tools', 'pear-check', 'sim.ts')], { cwd: WEB, input, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1 << 28 });
  let sim;
  try { sim = JSON.parse(r.stdout.trim().split('\n').pop()); }
  catch { errors.push(`sim: could not run (is Web/ installed?): ${tail(r.stderr)}`); return report; }

  report.selfcheck = sim.selfcheck;
  if (sim.selfcheck.ok) tested.push('generic self-check: join, junk and unknown events, leave, timers drain, no handler throws');
  else errors.push(...sim.selfcheck.errors.map((e) => `self-check: ${e}`));

  report.scenarios = sim.scenarios.map((s) => (full || !s.ok ? s : { ...s, frames: undefined, final: undefined }));
  for (const s of sim.scenarios) {
    if (s.ok) tested.push(`scenario "${s.name}" (${s.expect.length} expectations, ${Math.round(s.virtualMs)} ms virtual)`);
    else {
      errors.push(...s.errors.map((e) => `scenario "${s.name}": ${e}`));
      errors.push(...s.expect.filter((x) => !x.pass).map((x) => `scenario "${s.name}": ${x.device} expected ${x.expr} by ${x.by} ms, last value ${JSON.stringify(x.actual)}`));
    }
  }

  // Server events the script handles that no scenario ever sends: named so a reader knows what stayed unexercised.
  const sent = new Set(sim.scenarios.flatMap((s) => s.sent));
  const handled = new Set();
  for (const [p, src] of Object.entries(files)) if (p.startsWith('scripts/server/')) for (const m of src.matchAll(/\bname\s*===\s*["'](\w+)["']/g)) handled.add(m[1]);
  const missing = [...handled].filter((n) => !sent.has(n));
  if (missing.length) untested.push(`server events never sent by any scenario: ${missing.join(', ')}`);
  if (!('ui.json' in files)) untested.push('ui.json absent: no PearUI screens to check');
  untested.push(...(spec?.untested ?? []).map((u) => `declared in check.json: ${u}`));

  report.ok = errors.length === 0;
  return report;
}

export function checkDir(dir, full) {
  return checkFiles(filesFromDir(dir), { dir, full });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!arg) { console.error('usage: node Tools/pear-check/check.mjs <game folder> [--full]'); process.exit(2); }
  const dir = resolve(arg);
  if (!existsSync(join(dir, 'scene.json'))) { console.error(`${arg}: no scene.json`); process.exit(2); }
  const report = { game: basename(dir), ...checkDir(dir, process.argv.includes('--full')) };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
