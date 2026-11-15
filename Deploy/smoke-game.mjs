// Live smoke for any game: runs the scenarios of a game's check.json with real sockets against a local or hosted backend.
//   node Deploy/smoke-game.mjs <gameId> --spec Games/QuickDraw/check.json [--cloud URL] [--scenario <index|name part>]
// --cloud defaults to $PEAR_CLOUD_URL, else http://localhost:8080 (cd Backend && PEAR_DEV_SIGNIN=1 cargo run). Needs Node 22+,
// Web/ installed (it runs the headless runner Web/packages/pear-sim) and PEAR_DEV_SIGNIN=1 on the target (throwaway "sim-*" accounts).
// Read-only against hosted: it never publishes, lists or edits a game; the game must already be there. Every scenario plays in its
// own random lobby (SMK....), so a smoke run never takes a real player's slot. Scenarios that need pear-check-only features
// (a `leave` step, device `joinAt`) are skipped and said so; `count` and `every` steps are expanded here.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'Web');

/** pear-check scenario -> headless (C2) scenario for `game`, or {skip: reason}. */
export function normalize(sc, game, lobby) {
  const devices = [];
  for (const d of sc.devices) {
    if (d.joinAt !== undefined) return { skip: `device ${d.name} uses joinAt (pear-check only)` };
    if ((d.script ?? []).some((s) => s.leave)) return { skip: `device ${d.name} uses a leave step (pear-check only)` };
    const script = (d.script ?? []).flatMap((s) => {
      if (!s.every) return [s];
      const out = [];
      for (let at = s.at; at <= (s.until ?? sc.durationMs); at += s.every) out.push({ at, send: s.send });
      return out;
    });
    const { count, joinAt, ...rest } = d;
    const base = d.script ? { ...rest, script } : rest;
    if (!count) devices.push(base);
    else for (let i = 1; i <= count; i++) devices.push({ ...base, name: `${d.name}${i}` });
  }
  const { name, ...keep } = sc;
  return { scenario: { ...keep, devices, game, lobby } };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
  const cloud = (flag('--cloud') ?? process.env.PEAR_CLOUD_URL ?? 'http://localhost:8080').replace(/\/$/, '');
  const spec = flag('--spec');
  const pick = flag('--scenario');
  const game = argv[0];
  if (!game || !spec) { console.error('usage: node Deploy/smoke-game.mjs <gameId> --spec <check.json> [--cloud URL] [--scenario <index|name part>]'); process.exit(2); }

  const scenarios = JSON.parse(readFileSync(resolve(spec), 'utf8')).scenarios;
  const chosen = scenarios.map((sc, i) => ({ sc, i })).filter(({ sc, i }) => pick === undefined || String(i) === pick || sc.name.toLowerCase().includes(pick.toLowerCase()));
  if (!chosen.length) { console.error(`no scenario matches ${pick}`); process.exit(2); }

  const tmp = mkdtempSync(join(tmpdir(), 'smoke-game-'));
  let ran = 0, failed = 0;
  try {
    for (const { sc, i } of chosen) {
      const lobby = ('SMK' + Math.random().toString(36).slice(2, 6)).toUpperCase();
      const n = normalize(sc, game, lobby);
      if (n.skip) { console.log(`SKIP  [${i}] ${sc.name}: ${n.skip}`); continue; }
      const file = join(tmp, `s${i}.json`);
      writeFileSync(file, JSON.stringify(n.scenario));
      const r = spawnSync('npx', ['vite-node', 'packages/pear-sim/bin/pear-sim-run.ts', file, '--cloud', cloud], { cwd: WEB, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1 << 28 });
      let rep;
      try { rep = JSON.parse(r.stdout); } catch { rep = { ok: false, error: `runner gave no report: ${String(r.stderr).trim().split('\n').slice(-3).join(' | ')}`, expect: [] }; }
      ran++;
      if (!rep.ok) failed++;
      console.log(`${rep.ok ? 'PASS' : 'FAIL'}  [${i}] ${sc.name} (lobby ${rep.lobby ?? lobby})${rep.error ? ': ' + rep.error : ''}`);
      for (const e of rep.expect) console.log(`        ${e.pass ? 'ok  ' : 'MISS'} ${e.device}: ${e.expr}${e.pass ? '' : ` (last ${JSON.stringify(e.actual)})`}`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  console.log(ran && !failed ? `SMOKE PASS (${ran} scenario${ran > 1 ? 's' : ''} on ${cloud})` : `SMOKE FAIL (${ran} run, ${failed} failed)`);
  process.exitCode = ran && !failed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
