// pear-sim-run <scenario.json> [--cloud URL] [--token T] [--full]: runs a C2 scenario headless, prints the report JSON
// (frames trimmed to the last 200 unless --full), exit 0 when every expectation passed.
// Run from Web/: npx vite-node packages/pear-sim/bin/pear-sim-run.ts ../Games/QuickDraw/scenario.json
import { readFileSync } from 'node:fs';
import { runScenario } from '../src/headless';

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const cloud = flag('--cloud') ?? process.env.PEAR_CLOUD_URL ?? 'https://155-138-208-146.sslip.io';
const token = flag('--token') ?? process.env.PEAR_TOKEN;
const full = args.includes('--full');
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('usage: pear-sim-run <scenario.json> [--cloud URL] [--token T] [--full]'); process.exit(2); }
// The hosted box is IP-only with Caddy's internal CA.
if (/sslip\.io|localhost|127\.0\.0\.1/.test(cloud) || process.env.PEAR_INSECURE === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const report = await runScenario(JSON.parse(readFileSync(file, 'utf8')), { cloudUrl: cloud, token });
if (!full && report.frames.length > 200) report.frames = report.frames.slice(-200);
console.log(JSON.stringify(report, null, 2));
// exitCode, not exit(): exit() can cut off a large report when stdout is a pipe.
process.exitCode = report.ok ? 0 : 1;
