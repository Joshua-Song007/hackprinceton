// Headless simulator (plan.md Phase 14, Contract C2): runs a scenario of simulated devices against a real backend
// over `/play` sockets from Node, no browser, and reports frames, debug logs, expectations and final view states.
// This is the agent's test loop: write a game, run a scenario, read the report, fix.
import { emptyState, evalExpr, interpolate, reduceFrame, truthy, type ViewState } from '@pear/ui';

type Frame = { name: string; data?: unknown };
export type Step =
  | { at: number; send: Frame }
  | { at: number; motion: { pitch: number; roll?: number; yaw?: number } }
  | { at: number; gps: { lat: number; lng: number; acc?: number } }
  | { at: number; tap: true };
/** Reactive step (C2 extension): when `on` arrives (and `when` holds on {data, ...viewState}), send after `after` ms. */
export type Rule = { on: string; when?: string; after?: number; send: Frame; once?: boolean };
export interface Device { name: string; kind?: 'phone' | 'ipad' | 'watch'; role?: string; script?: Step[]; rules?: Rule[] }
export interface Expect { by: number; expr: string; device: string }
export interface Scenario { game: string; version?: number; lobby?: string; durationMs: number; devices: Device[]; expect?: Expect[]; motionEvent?: string; gpsEvent?: string }
export interface ReportFrame { t: number; device: string; dir: 'in' | 'out'; name: string; data: unknown }
export interface Report {
  ok: boolean; lobby: string; error?: string;
  expect: (Expect & { pass: boolean; actual: unknown })[];
  frames: ReportFrame[]; logs: unknown[]; final: Record<string, ViewState>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runScenario(sc: Scenario, opts: { cloudUrl?: string; token?: string; log?: (s: string) => void } = {}): Promise<Report> {
  const base = (opts.cloudUrl ?? process.env.PEAR_CLOUD_URL ?? 'https://155-138-208-146.sslip.io').replace(/\/$/, '');
  const ws = base.replace(/^http/, 'ws');
  const lobby = (sc.lobby ?? 'SIM' + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const run = Date.now().toString(36);
  const t0 = Date.now();
  const frames: ReportFrame[] = [];
  const logs: unknown[] = [];
  const states: Record<string, ViewState> = {};
  const sockets: WebSocket[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const report: Report = { ok: false, lobby, expect: [], frames, logs, final: states };

  async function signIn(name: string): Promise<string> {
    const r = await fetch(`${base}/api/accounts/signin`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'dev', subject: `sim-${name}-${run}`, display_name: name }),
    });
    if (!r.ok) throw new Error(`dev sign-in for ${name} failed: HTTP ${r.status} (is PEAR_DEV_SIGNIN on?)`);
    return ((await r.json()) as { token: string }).token;
  }
  const open = (url: string) => new Promise<WebSocket>((res, rej) => {
    const s = new WebSocket(url);
    s.onopen = () => res(s);
    s.onerror = () => rej(new Error(`socket failed: ${url.replace(/token=[^&]+/, 'token=…')}`));
  });

  try {
    // Debug stream (owner/developer only): optional, skipped on 401/403.
    if (opts.token) {
      try {
        const d = await open(`${ws}/debug/${sc.game}?token=${opts.token}`);
        d.onmessage = (m) => { try { logs.push(JSON.parse(String(m.data))); } catch { /* ignore */ } };
        sockets.push(d);
      } catch { /* not allowed: no logs */ }
    }
    for (const dev of sc.devices) {
      const token = await signIn(dev.name);
      const v = sc.version ? `&version=${sc.version}` : '';
      const s = await open(`${ws}/play/${sc.game}?token=${token}&lobby=${lobby}${v}`);
      sockets.push(s);
      states[dev.name] = emptyState(dev.kind ?? 'phone');
      const send = (f: Frame) => {
        if (s.readyState !== WebSocket.OPEN) return;
        s.send(JSON.stringify({ name: f.name, data: f.data ?? {} }));
        frames.push({ t: Date.now() - t0, device: dev.name, dir: 'out', name: f.name, data: f.data ?? {} });
      };
      const fired = new Set<Rule>();
      s.onmessage = (m) => {
        let f: Frame;
        try { f = JSON.parse(String(m.data)); } catch { return; }
        frames.push({ t: Date.now() - t0, device: dev.name, dir: 'in', name: f.name, data: f.data });
        states[dev.name] = reduceFrame(states[dev.name], f);
        if (f.name === '_welcome' && dev.role) send({ name: 'role', data: { role: dev.role } });
        for (const r of dev.rules ?? []) {
          if (r.on !== f.name || (r.once && fired.has(r))) continue;
          const scope = { ...states[dev.name], data: f.data };
          if (r.when && !truthy(evalExpr(scope, r.when))) continue;
          fired.add(r);
          const out = { name: r.send.name, data: interpolate(scope, r.send.data ?? {}) };
          timers.push(setTimeout(() => send(out), r.after ?? 0));
        }
      };
      for (const st of dev.script ?? []) {
        const out: Frame = 'send' in st ? st.send
          : 'motion' in st ? { name: sc.motionEvent ?? 'aim', data: { roll: 0, yaw: 0, ...st.motion } }
          : 'gps' in st ? { name: sc.gpsEvent ?? 'location', data: { acc: 5, ...st.gps } }
          : { name: 'tap', data: {} };
        timers.push(setTimeout(() => send(out), Math.max(0, st.at - (Date.now() - t0))));
      }
    }
    const expects = [...(sc.expect ?? [])].sort((a, b) => a.by - b.by);
    const pending = new Map(expects.map((e) => [e, false]));
    // Poll expectations every 100 ms; each passes as soon as it holds, fails if still false at `by`.
    while (Date.now() - t0 < sc.durationMs) {
      for (const e of expects) if (!pending.get(e) && states[e.device] && truthy(evalExpr(states[e.device], e.expr))) pending.set(e, true);
      if (expects.length && [...pending.values()].every(Boolean)) break;
      if (expects.some((e) => !pending.get(e) && Date.now() - t0 > e.by)) break;
      await sleep(100);
    }
    report.expect = expects.map((e) => ({ ...e, pass: !!pending.get(e), actual: states[e.device] ? evalExpr(states[e.device], e.expr.split(/==|!=/)[0].replace(/^!/, '').trim()) : undefined }));
    report.ok = report.expect.every((e) => e.pass);
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
  } finally {
    timers.forEach(clearTimeout);
    sockets.forEach((s) => { try { s.close(); } catch { /* ignore */ } });
  }
  return report;
}
