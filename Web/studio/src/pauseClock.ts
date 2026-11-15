// A clock that stands still while held: `now` (monotonic ms, like performance.now) and `epoch` (ms since 1970, like Date.now) stop
// advancing and timers made with `setTimer` keep their remaining time, so a simulation run on it freezes while an agent thinks.
// Holds nest: the clock runs again when every hold is released. Pure apart from the injected time sources.
export interface PauseClockOptions {
  now?: () => number;
  epoch?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface PauseClock {
  now(): number;
  epoch(): number;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(handle: unknown): void;
  hold(): void;
  /** Releases one hold; extra releases are ignored. */
  release(): void;
  /** Drops every hold and runs again; time already paused stays paused, so `now` never jumps. */
  reset(): void;
  readonly held: number;
}

interface Timer {
  fn: () => void;
  remaining: number;
  real: unknown;
  armedAt: number;
}

export function createPauseClock(o: PauseClockOptions = {}): PauseClock {
  const base = o.now ?? (() => performance.now());
  const wall = o.epoch ?? (() => Date.now());
  const set = o.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = o.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let held = 0;
  let pausedMs = 0;
  let heldBase = 0;
  let heldEpoch = 0;
  let nextId = 1;
  const timers = new Map<number, Timer>();

  const arm = (id: number, t: Timer) => {
    t.armedAt = base();
    t.real = set(() => {
      timers.delete(id);
      t.fn();
    }, t.remaining);
  };
  const freeze = () => {
    for (const t of timers.values()) {
      if (t.real === null) continue;
      clear(t.real);
      t.real = null;
      t.remaining = Math.max(0, t.remaining - (base() - t.armedAt));
    }
  };
  const thaw = () => {
    pausedMs += base() - heldBase;
    for (const [id, t] of [...timers]) arm(id, t);
  };

  return {
    now: () => (held > 0 ? heldBase : base()) - pausedMs,
    epoch: () => (held > 0 ? heldEpoch : wall()) - pausedMs,
    setTimer(fn, ms) {
      const id = nextId++;
      const t: Timer = { fn, remaining: Math.max(0, ms), real: null, armedAt: 0 };
      timers.set(id, t);
      if (held === 0) arm(id, t);
      return id;
    },
    clearTimer(handle) {
      const t = timers.get(handle as number);
      if (!t) return;
      if (t.real !== null) clear(t.real);
      timers.delete(handle as number);
    },
    hold() {
      if (held++ === 0) {
        heldBase = base();
        heldEpoch = wall();
        freeze();
      }
    },
    release() {
      if (held > 0 && --held === 0) thaw();
    },
    reset() {
      if (held > 0) {
        held = 0;
        thaw();
      }
    },
    get held() {
      return held;
    },
  };
}
