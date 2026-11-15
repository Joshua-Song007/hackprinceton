import { describe, expect, it } from 'vitest';
import { createPauseClock } from '../src/pauseClock';

// A hand-driven time source and scheduler: `advance(ms)` moves real time and fires the real timeouts that fall due.
function world() {
  let t = 1000;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const clock = createPauseClock({
    now: () => t,
    epoch: () => 1_700_000_000_000 + t,
    setTimeout: (fn, ms) => (pending.set(nextHandle, { at: t + ms, fn }), nextHandle++),
    clearTimeout: (h) => void pending.delete(h as number),
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = [...pending].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      t = due[1].at;
      due[1].fn();
    }
    t = end;
  };
  return { clock, advance, pending };
}

describe('createPauseClock', () => {
  it('runs like the base clock while not held', () => {
    const { clock, advance } = world();
    const a = clock.now(), e = clock.epoch();
    advance(250);
    expect(clock.now() - a).toBe(250);
    expect(clock.epoch() - e).toBe(250);
  });

  it('stands still while held and continues from the same value after release', () => {
    const { clock, advance } = world();
    advance(100);
    const before = clock.now(), epochBefore = clock.epoch();
    clock.hold();
    advance(5000);
    expect(clock.now()).toBe(before);
    expect(clock.epoch()).toBe(epochBefore);
    clock.release();
    expect(clock.now()).toBe(before);
    advance(40);
    expect(clock.now()).toBe(before + 40);
    expect(clock.epoch()).toBe(epochBefore + 40);
  });

  it('holds nest and extra releases are ignored', () => {
    const { clock, advance } = world();
    clock.hold();
    clock.hold();
    expect(clock.held).toBe(2);
    clock.release();
    const frozen = clock.now();
    advance(100);
    expect(clock.now()).toBe(frozen);
    clock.release();
    clock.release();
    expect(clock.held).toBe(0);
    advance(100);
    expect(clock.now()).toBe(frozen + 100);
  });

  it('a timer fires after the remaining time once released', () => {
    const { clock, advance } = world();
    const fired: number[] = [];
    clock.setTimer(() => fired.push(clock.now()), 1000);
    advance(400);
    clock.hold();
    advance(10_000);
    expect(fired).toEqual([]);
    clock.release();
    advance(599);
    expect(fired).toEqual([]);
    advance(1);
    expect(fired).toHaveLength(1);
  });

  it('a timer set while held starts on release; one fires once', () => {
    const { clock, advance } = world();
    let n = 0;
    clock.hold();
    clock.setTimer(() => n++, 300);
    advance(1000);
    expect(n).toBe(0);
    clock.release();
    advance(299);
    expect(n).toBe(0);
    advance(1);
    advance(1000);
    expect(n).toBe(1);
  });

  it('clearTimer works held, running and for a fired or unknown handle', () => {
    const { clock, advance, pending } = world();
    let n = 0;
    const running = clock.setTimer(() => n++, 100);
    clock.clearTimer(running);
    expect(pending.size).toBe(0);
    clock.hold();
    const held = clock.setTimer(() => n++, 100);
    clock.clearTimer(held);
    clock.release();
    advance(500);
    expect(n).toBe(0);
    const fired = clock.setTimer(() => n++, 10);
    advance(10);
    clock.clearTimer(fired);
    clock.clearTimer(999);
    expect(n).toBe(1);
  });

  it('reset drops every hold without moving now', () => {
    const { clock, advance } = world();
    clock.hold();
    clock.hold();
    advance(700);
    const frozen = clock.now();
    clock.reset();
    expect(clock.held).toBe(0);
    expect(clock.now()).toBe(frozen);
    advance(10);
    expect(clock.now()).toBe(frozen + 10);
    clock.reset();
    expect(clock.now()).toBe(frozen + 10);
  });
});
