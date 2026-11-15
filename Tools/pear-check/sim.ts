// Offline lobby simulator CLI for pear-check (plan.md 13.2); the engine lives in simcore.ts so Studio can run it in the page.
// Run from Web/: vite-node ../Tools/pear-check/sim.ts with {files, scenarios} JSON on stdin; prints JSON on stdout.
import { readFileSync } from 'node:fs';
import { runScenario, selfcheck, type CScenario } from './simcore';

const prelude = readFileSync(new URL('../../Packages/PearScript/Sources/PearScript/Resources/prelude.js', import.meta.url), 'utf8');
const input = JSON.parse(readFileSync(0, 'utf8')) as { files: Record<string, string>; scenarios: CScenario[] };
console.log(JSON.stringify({ selfcheck: selfcheck(prelude, input.files), scenarios: input.scenarios.map((s) => runScenario(prelude, input.files, s)) }));
