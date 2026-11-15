// Offline lobby simulator for pear-check (plan.md 13.2): runs a game's server scripts in the in-page LocalServer with an
// injected virtual clock, N simulated phones in one lobby, scripted gestures and reactive rules. Same scenario shape as
// Web/packages/pear-sim/src/headless.ts (Device/Step/Rule/Expect), minus the network: no backend, deterministic, instant.
// Run from Web/: vite-node ../Tools/pear-check/sim.ts with {files, scenarios} JSON on stdin; prints JSON on stdout.
// shortcut: step extras (`leave`, `every`/`until`) and device `count`/`joinAt` are pear-check only; the hosted headless
// runner ignores them. Fold them into headless.ts when the two runners merge.
import { readFileSync } from 'node:fs';
import type { Device, Expect, Rule, Step } from '../../Web/packages/pear-sim/src/headless';
import { evalExpr, interpolate, truthy } from '../../Web/packages/pear-ui/src/expr';
import { emptyState, reduceFrame, type ViewState } from '../../Web/packages/pear-ui/src/types';
import { LocalServer } from '../../Web/packages/pear-script/src/server-local';

type Frame = { name: string; data?: unknown };
type CStep = Step | { at: number; leave: true } | { at: number; send: Frame; every: number; until?: number };
type CDevice = Omit<Device, 'script'> & { script?: CStep[]; joinAt?: number; count?: number };
export interface CScenario { name: string; durationMs: number; devices: CDevice[]; expect?: Expect[]; motionEvent?: string; gpsEvent?: string; lobby?: string }
interface Input { files: Record<string, string>; scenarios: CScenario[] }

const EPOCH = 1_000_000;
const MAX_EVENTS = 200_000;

// mulberry32: scripts that pick a random holder or cue delay behave the same on every run.
function seedRandom(seed: number) {
  Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function sources(files: Record<string, string>): { path: string; src: string | undefined }[] {
  const scene = JSON.parse(files['scene.json'] ?? '{}');
  return (scene.serverScripts ?? []).map((n: string) => ({ path: `scripts/server/${n}.js`, src: files[`scripts/server/${n}.js`] }));
}

function boot(files: Record<string, string>, onFire: (p: string | null, n: string, d: unknown) => void, errors: string[], now: () => number, setTimer: (fn: () => void, ms: number) => unknown, clearTimer: (h: unknown) => void) {
  const prelude = readFileSync(new URL('../../Packages/PearScript/Sources/PearScript/Resources/prelude.js', import.meta.url), 'utf8');
  const names = sources(files).map((s) => s.path).join(', ') || 'no server scripts';
  const server = new LocalServer({ prelude, onFire, now, setTimer, clearTimer, onError: (m) => errors.push(`${names}: ${m}`), onLog: (l, t) => { if (l === 'error') errors.push(`${names}: console.error ${t}`); } });
  for (const s of sources(files)) {
    if (s.src === undefined) { errors.push(`${s.path}: missing`); continue; }
    try { server.load([s.src]); } catch (e) { errors.push(`${s.path}: ${(e as Error).message}`); }
  }
  return server;
}

/** Fake-ctx self-check with no per-game knowledge: join phones, send junk and unknown events, leave; nothing may throw. */
function selfcheck(files: Record<string, string>) {
  const errors: string[] = [];
  let t = EPOCH;
  const queue: { at: number; fn: () => void; live: boolean }[] = [];
  const server = boot(files, () => {}, errors, () => t, (fn, ms) => { const q = { at: t + ms, fn, live: true }; queue.push(q); return q; }, (h) => { (h as { live: boolean }).live = false; });
  const junk: unknown[] = [undefined, null, {}, 0, 'x', [], { round: 'x', x: NaN, pitch: 'x' }];
  for (const id of ['a', 'b', 'c']) server.join(id, id);
  for (const id of ['a', 'b', 'c']) for (const name of ['role', 'ready', 'start', 'tag', 'raised', 'lowered', 'pos', 'aim', 'location', 'no_such_event']) for (const d of junk) server.remote(id, name, d);
  server.remote('ghost', 'ready', {}); server.leave('ghost');
  for (const id of ['a', 'b', 'c']) server.leave(id);
  for (let i = 0; i < 50 && queue.some((q) => q.live); i++) { const q = queue.filter((x) => x.live).sort((x, y) => x.at - y.at)[0]; q.live = false; t = Math.max(t, q.at); q.fn(); }
  server.dispose();
  return { ok: errors.length === 0, errors };
}

function expand(devs: CDevice[]): CDevice[] {
  return devs.flatMap((d) => d.count ? Array.from({ length: d.count }, (_, i) => ({ ...d, name: `${d.name}${i + 1}`, count: undefined })) : [d]);
}

function runScenario(files: Record<string, string>, sc: CScenario) {
  seedRandom(1);
  const errors: string[] = [];
  const lobby = (sc.lobby ?? 'CHECK').toUpperCase();
  let t = 0;
  let seq = 0;
  type Ev = { at: number; seq: number; live: boolean; fn: () => void };
  const queue: Ev[] = [];
  const at = (when: number, fn: () => void): Ev => { const e = { at: when, seq: seq++, live: true, fn }; queue.push(e); return e; };
  const states: Record<string, ViewState> = {};
  const ids: Record<string, string> = {};
  const online = new Set<string>();
  const frames: { t: number; device: string; dir: 'in' | 'out'; name: string; data: unknown }[] = [];
  const devs = expand(sc.devices);
  const rulesFired = new Map<string, Set<Rule>>();

  const send = (dev: CDevice, f: Frame) => {
    if (!online.has(dev.name)) return;
    frames.push({ t, device: dev.name, dir: 'out', name: f.name, data: f.data ?? {} });
    server.remote(ids[dev.name], f.name, f.data ?? {});
  };
  const deliver = (dev: CDevice, f: Frame) => {
    if (!online.has(dev.name)) return;
    frames.push({ t, device: dev.name, dir: 'in', name: f.name, data: f.data });
    states[dev.name] = reduceFrame(states[dev.name], f);
    if (f.name === '_welcome' && dev.role) at(t, () => send(dev, { name: 'role', data: { role: dev.role } }));
    for (const r of dev.rules ?? []) {
      const done = rulesFired.get(dev.name)!;
      if (r.on !== f.name || (r.once && done.has(r))) continue;
      const scope = { ...states[dev.name], data: f.data };
      if (r.when && !truthy(evalExpr(scope, r.when))) continue;
      done.add(r);
      const out = { name: r.send.name, data: interpolate(scope, r.send.data ?? {}) };
      at(t + (r.after ?? 0), () => send(dev, out));
    }
  };
  const server = boot(files, (player, name, data) => {
    for (const d of devs) if (player === null || ids[d.name] === player) deliver(d, { name, data });
  }, errors, () => EPOCH + t, (fn, ms) => at(t + ms, fn), (h) => { (h as Ev).live = false; });
  const join = (dev: CDevice) => {
    online.add(dev.name);
    states[dev.name] = emptyState(dev.kind ?? 'phone');
    deliver(dev, { name: '_welcome', data: { id: ids[dev.name], name: dev.name, lobby } });
    server.join(ids[dev.name], dev.name);
  };
  for (const dev of devs) {
    ids[dev.name] = `p-${dev.name}`;
    rulesFired.set(dev.name, new Set());
    at(dev.joinAt ?? 0, () => join(dev));
    for (const st of dev.script ?? []) {
      const out: Frame | null = 'leave' in st ? null : 'send' in st ? st.send
        : 'motion' in st ? { name: sc.motionEvent ?? 'aim', data: { roll: 0, yaw: 0, ...st.motion } }
        : 'gps' in st ? { name: sc.gpsEvent ?? 'location', data: { acc: 5, ...st.gps } } : { name: 'tap', data: {} };
      if (!out) { at(st.at, () => { if (online.delete(dev.name)) server.leave(ids[dev.name]); }); continue; }
      const every = 'every' in st ? st.every : 0;
      const until = 'until' in st ? st.until ?? sc.durationMs : 0;
      for (let w = st.at; w <= (every > 0 ? until : st.at); w += every || 1) at(w, () => send(dev, out));
    }
  }
  const expects = [...(sc.expect ?? [])].sort((a, b) => a.by - b.by);
  const passed = new Set<Expect>();
  const probe = () => { for (const e of expects) if (!passed.has(e) && t <= e.by && states[e.device] && truthy(evalExpr(states[e.device], e.expr))) passed.add(e); };
  let n = 0;
  while (queue.length && n++ < MAX_EVENTS) {
    queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const e = queue.shift()!;
    if (!e.live) continue;
    if (e.at > sc.durationMs) break;
    t = e.at;
    e.fn();
    probe();
    if (expects.length && passed.size === expects.length) break;
  }
  if (n >= MAX_EVENTS) errors.push(`${sc.name}: stopped after ${MAX_EVENTS} events (a rule or timer loops)`);
  server.dispose();
  const result = expects.map((e) => ({ ...e, pass: passed.has(e), actual: states[e.device] ? evalExpr(states[e.device], e.expr.split(/==|!=/)[0].replace(/^!/, '').trim()) : undefined }));
  return {
    name: sc.name, ok: errors.length === 0 && result.every((r) => r.pass), virtualMs: t, errors, expect: result,
    sent: [...new Set(frames.filter((f) => f.dir === 'out').map((f) => f.name))],
    frames: frames.slice(-60), final: states,
  };
}

const input = JSON.parse(readFileSync(0, 'utf8')) as Input;
console.log(JSON.stringify({ selfcheck: selfcheck(input.files), scenarios: input.scenarios.map((s) => runScenario(input.files, s)) }));
