import { describe, expect, it } from 'vitest';
import prelude from '../../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js?raw';
import quickdraw from '../../../../Games/QuickDraw/scripts/game.js?raw';
import { LocalServer } from '../src';

function make() {
  const fired: [string | null, string, any][] = [];
  const errors: string[] = [];
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const s = new LocalServer({
    prelude,
    onFire: (p, n, d) => fired.push([p, n, d]),
    onError: (m) => errors.push(m),
    setTimer: (fn, ms) => timers.push({ fn, ms, live: true }) - 1,
    clearTimer: (h) => void (timers[h as number]!.live = false),
  });
  s.load([quickdraw]);
  const events = (name: string) => fired.filter((f) => f[1] === name).map((f) => f[2]);
  const lastState = () => events('state').at(-1);
  // Runs the newest live timer (the arming delay, or the report window).
  const runTimer = () => timers.filter((t) => t.live).at(-1)!;
  return { s, fired, errors, timers, events, lastState, runTimer };
}

function lobbyWithTwoReadyPhones() {
  const h = make();
  h.s.join('p1', 'Ann');
  h.s.join('p2', 'Bo');
  h.s.join('r', 'Ref');
  h.s.remote('p1', 'role', { role: 'phone' });
  h.s.remote('p2', 'role', { role: 'phone' });
  h.s.remote('r', 'role', { role: 'ref' });
  return h;
}

// start -> arming delay elapses -> "fire" goes out.
function startAndFire(h: ReturnType<typeof make>) {
  h.s.remote('r', 'start', {});
  expect(h.lastState().phase).toBe('arming');
  const arm = h.runTimer();
  expect(arm.ms).toBeGreaterThanOrEqual(2000);
  expect(arm.ms).toBeLessThanOrEqual(6000);
  arm.fn();
  expect(h.lastState().phase).toBe('fire');
}

describe('Quick Draw server script', () => {
  it('plays lobby, ready, foul, fast, match over, rematch, then a leave returns to lobby', () => {
    const h = lobbyWithTwoReadyPhones();
    expect(h.lastState().phase).toBe('lobby');
    expect(h.lastState().needs).toBe('waiting for both phones to calibrate');

    h.s.remote('p1', 'ready', {});
    expect(h.lastState().needs).toBe('waiting for both phones to calibrate');
    h.s.remote('r', 'start', {}); // not ready yet: ignored
    expect(h.lastState().phase).toBe('lobby');
    h.s.remote('p2', 'ready', {});
    expect(h.lastState().phase).toBe('ready');
    expect(h.lastState().players).toEqual([
      { id: 'p1', name: 'Ann', ready: true, role: 'phone' },
      { id: 'p2', name: 'Bo', ready: true, role: 'phone' },
      { id: 'r', name: 'Ref', ready: false, role: 'ref' },
    ]);
    h.s.remote('p1', 'start', {}); // a phone cannot start
    expect(h.lastState().phase).toBe('ready');

    // Round 1: p1 raises while arming -> foul, p2 wins.
    h.s.remote('r', 'start', {});
    expect(h.lastState().phase).toBe('arming');
    const arm = h.runTimer();
    h.s.remote('p1', 'raised', { sinceFireMs: null });
    expect(arm.live).toBe(false);
    expect(h.events('roundResult')).toEqual([
      { round: 1, winnerId: 'p2', reason: 'foul', reactionMs: { p1: null, p2: null }, scores: { p1: 0, p2: 1 } },
    ]);
    expect(h.lastState().phase).toBe('roundOver');

    // Round 2: both raise after the cue, p1 is faster (arrives second); p1 wins -> 1-1.
    startAndFire(h);
    expect(h.events('fire')).toEqual([{ round: 2 }]);
    h.s.remote('p2', 'raised', { sinceFireMs: 300 });
    expect(h.lastState().phase).toBe('fire'); // waiting for p1's report
    h.s.remote('p1', 'raised', { sinceFireMs: 250 });
    expect(h.events('roundResult').at(-1)).toEqual({ round: 2, winnerId: 'p1', reason: 'fast', reactionMs: { p1: 250, p2: 300 }, scores: { p1: 1, p2: 1 } });
    expect(h.lastState().phase).toBe('roundOver');

    // Round 3: only p2 reports; the report window closes and p2 takes the match 2-1.
    startAndFire(h);
    h.s.remote('p2', 'raised', { sinceFireMs: 200 });
    h.runTimer().fn();
    expect(h.events('roundResult').at(-1)).toEqual({ round: 3, winnerId: 'p2', reason: 'fast', reactionMs: { p1: null, p2: 200 }, scores: { p1: 1, p2: 2 } });
    expect(h.events('matchOver')).toEqual([{ winnerId: 'p2', scores: { p1: 1, p2: 2 } }]);
    expect(h.lastState().phase).toBe('matchOver');

    // Rematch resets scores and the round counter.
    h.s.remote('r', 'start', {});
    expect(h.lastState()).toMatchObject({ phase: 'arming', round: 1, scores: { p1: 0, p2: 0 } });

    // A phone leaving mid-match ends it: lobby, arming timer cancelled, calibration cleared.
    const arm2 = h.runTimer();
    h.s.leave('p1');
    expect(arm2.live).toBe(false);
    expect(h.lastState()).toMatchObject({ phase: 'lobby', round: 0, scores: { p2: 0 }, needs: 'waiting for 1 more phone' });
    expect(h.lastState().players.map((p: any) => p.ready)).toEqual([false, false]);
    expect(h.errors).toEqual([]);
  });

  it('breaks ties to the first arrival, and treats an early (null) raise during fire as a foul', () => {
    const h = lobbyWithTwoReadyPhones();
    h.s.remote('p1', 'ready', {});
    h.s.remote('p2', 'ready', {});
    startAndFire(h);
    h.s.remote('p2', 'raised', { sinceFireMs: 300 });
    h.s.remote('p1', 'raised', { sinceFireMs: 300 });
    expect(h.events('roundResult').at(-1).winnerId).toBe('p2');

    startAndFire(h);
    h.s.remote('p2', 'raised', { sinceFireMs: null });
    expect(h.events('roundResult').at(-1)).toMatchObject({ winnerId: 'p1', reason: 'foul' });
  });

  it('keeps a third phone, a second ref and a late joiner out, and ignores their events', () => {
    const h = lobbyWithTwoReadyPhones();
    h.s.join('p3', 'Cy');
    h.s.remote('p3', 'role', { role: 'phone' });
    h.s.join('r2', 'Ref2');
    h.s.remote('r2', 'role', { role: 'ref' });
    expect(h.lastState().players.filter((p: any) => p.role === null).map((p: any) => p.id)).toEqual(['p3', 'r2']);
    h.s.remote('p1', 'ready', {});
    h.s.remote('p2', 'ready', {});
    h.s.remote('r', 'start', {});
    h.s.join('late', 'Dee');
    h.s.remote('late', 'role', { role: 'phone' });
    h.s.remote('p3', 'raised', { sinceFireMs: null });
    expect(h.lastState()).toMatchObject({ phase: 'arming', scores: { p1: 0, p2: 0 } });
    expect(h.lastState().players.find((p: any) => p.id === 'late').role).toBeNull();
    h.s.leave('late'); // a spectator leaving does not end the match
    expect(h.lastState().phase).toBe('arming');
  });

  it('keeps pos in state only', () => {
    const h = lobbyWithTwoReadyPhones();
    const before = h.fired.length;
    h.s.remote('p1', 'pos', { lat: 40.35, lon: -74.65, acc: 12 });
    expect(h.fired.length).toBe(before);
    expect(JSON.parse(h.s.stateJSON()).players.p1.pos).toMatchObject({ lat: 40.35, lon: -74.65, acc: 12 });
  });
});
