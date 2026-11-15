import { describe, expect, it } from 'vitest';
import prelude from '../../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js?raw';
import { LocalServer, ScriptRuntime, type HandlerCall } from '@pear/script';

// Shared fixtures (Tests/conformance/*.json): Rust (Backend/tests/conformance.rs) and Swift read the same files.
const fixtures = import.meta.glob('../../../../Tests/conformance/*.json', { eager: true, import: 'default' }) as Record<string, any>;

describe('conformance fixtures', () => {
  it('are present', () => expect(Object.keys(fixtures).length).toBeGreaterThanOrEqual(3));

  for (const [path, f] of Object.entries(fixtures)) {
    it(`${path.split('/').pop()}: ${f.name}`, () => {
      if (f.runtime === 'client') {
        const rt = new ScriptRuntime(prelude);
        for (const [n, src] of Object.entries<string>(f.scripts)) rt.load(n, src);
        for (const c of f.calls) {
          const r = rt.call(c.call as HandlerCall);
          expect(r.error).toBeUndefined();
          expect(r.outputs).toEqual(c.outputs);
        }
        return;
      }
      const fired: unknown[] = [];
      const errors: string[] = [];
      const timers: { fn: () => void; ms: number; live: boolean }[] = [];
      const s = new LocalServer({
        prelude,
        onFire: (p, n, d) => fired.push([p, n, d]),
        onError: (m) => errors.push(m),
        setTimer: (fn, ms) => timers.push({ fn, ms, live: true }) - 1,
        clearTimer: (h) => void (timers[h as number]!.live = false),
      });
      s.load(f.scripts);
      for (const st of f.steps) {
        fired.length = 0;
        errors.length = 0;
        const before = timers.length;
        if (st.op === 'join') s.join(st.id, st.name);
        else if (st.op === 'leave') s.leave(st.id);
        else if (st.op === 'remote') s.remote(st.id, st.name, st.data);
        else if (timers[st.index]!.live) timers[st.index]!.fn();
        expect(fired).toEqual(st.fired ?? []);
        expect(errors).toEqual(st.errors ?? []);
        if (st.state) expect(JSON.parse(s.stateJSON())).toEqual(st.state);
        if (st.timers) expect(timers.slice(before).map((t) => t.ms)).toEqual(st.timers);
        if (st.pending !== undefined) expect(s.pendingTimers).toBe(st.pending);
      }
    });
  }
});
