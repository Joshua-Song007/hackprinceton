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
  // Runs the newest live timer (countdown, arming delay, or the report window), as the host would when it elapses.
  const tick = () => {
    const t = timers.filter((x) => x.live).at(-1)!;
    t.live = false;
    t.fn();
    return t;
  };
  // A phone sends ready / raised with the round it last saw in "state", as the phone page and player.js do.
  const ready = (id: string) => s.remote(id, 'ready', { round: lastState().round });
  const raised = (id: string, sinceFireMs: number | null) => s.remote(id, 'raised', { round: lastState().round, sinceFireMs });
  return { s, fired, errors, timers, events, lastState, tick, ready, raised };
}

// Two phones in the lobby, no referee and no third device.
function twoPhones() {
  const h = make();
  h.s.join('p1', 'Ann');
  h.s.join('p2', 'Bo');
  h.s.remote('p1', 'role', { role: 'phone' });
  h.s.remote('p2', 'role', { role: 'phone' });
  return h;
}

// Both phones ready -> the countdown starts itself -> arming -> the cue.
function toFire(h: ReturnType<typeof make>) {
  h.ready('p1');
  h.ready('p2');
  expect(h.lastState().phase).toBe('countdown');
  expect(h.tick().ms).toBe(3000);
  expect(h.lastState().phase).toBe('arming');
  const arm = h.timers.filter((t) => t.live).at(-1)!;
  expect(arm.ms).toBeGreaterThanOrEqual(2000);
  expect(arm.ms).toBeLessThanOrEqual(6000);
  h.tick();
  expect(h.lastState().phase).toBe('fire');
}

describe('Quick Draw server script', () => {
  it('plays lobby, ready, auto countdown, foul, fast, match over, replay, then a leave returns to lobby', () => {
    const h = twoPhones();
    expect(h.lastState().phase).toBe('lobby');
    expect(h.lastState().needs).toBe('waiting for both phones to calibrate');

    h.ready('p1');
    expect(h.lastState().phase).toBe('lobby'); // one phone is not enough
    expect(h.lastState().players).toEqual([
      { id: 'p1', name: 'Ann', ready: true, role: 'phone' },
      { id: 'p2', name: 'Bo', ready: false, role: 'phone' },
    ]);
    h.s.remote('p1', 'start', {}); // there is no start event any more
    expect(h.lastState().phase).toBe('lobby');
    h.ready('p2');
    expect(h.lastState()).toMatchObject({ phase: 'countdown', round: 1, matchRound: 1, needs: 'get ready' });
    expect(h.events('countdown')).toEqual([{ round: 1, matchRound: 1, ms: 3000 }]);
    expect(h.lastState().players.map((p: any) => p.ready)).toEqual([false, false]); // readiness is consumed by the start

    // Round 1: p1 raises while arming -> foul, p2 wins.
    h.tick();
    expect(h.lastState().phase).toBe('arming');
    const arm = h.timers.filter((t) => t.live).at(-1)!;
    expect(h.events('arming')).toEqual([{ round: 1, fireAt: expect.any(Number) }]);
    h.raised('p1', null);
    expect(arm.live).toBe(false);
    expect(h.events('roundResult')).toEqual([
      { round: 1, matchRound: 1, winnerId: 'p2', reason: 'foul', reactionMs: { p1: null, p2: null }, scores: { p1: 0, p2: 1 } },
    ]);
    expect(h.lastState().phase).toBe('roundOver');
    expect(h.lastState().needs).toBe('both phones: lower and get ready for the next round');

    // Round 2: both raise after the cue; the lower time wins whatever the arrival order. 1-1.
    h.ready('p1');
    h.ready('p2');
    h.tick();
    h.tick();
    expect(h.events('fire')).toEqual([{ round: 2, fireAt: expect.any(Number) }]);
    h.raised('p2', 300);
    expect(h.lastState().phase).toBe('fire'); // waiting for p1's report
    h.raised('p1', 250);
    expect(h.events('roundResult').at(-1)).toEqual({ round: 2, matchRound: 2, winnerId: 'p1', reason: 'fast', reactionMs: { p1: 250, p2: 300 }, scores: { p1: 1, p2: 1 } });
    expect(h.lastState().phase).toBe('roundOver');

    // Round 3: only p2 reports; the report window closes and p2 takes the match 2-1.
    h.ready('p1');
    h.ready('p2');
    h.tick();
    h.tick();
    h.raised('p2', 200);
    h.tick();
    expect(h.events('roundResult').at(-1)).toEqual({ round: 3, matchRound: 3, winnerId: 'p2', reason: 'fast', reactionMs: { p1: null, p2: 200 }, scores: { p1: 1, p2: 2 } });
    expect(h.events('matchOver')).toEqual([{ winnerId: 'p2', scores: { p1: 1, p2: 2 } }]);
    expect(h.lastState().phase).toBe('matchOver');

    // Replay: both phones must ready again; scores and the match round reset, the stale-input round token does not.
    h.ready('p1');
    expect(h.lastState().phase).toBe('matchOver');
    h.ready('p2');
    expect(h.lastState()).toMatchObject({ phase: 'countdown', round: 4, matchRound: 1, scores: { p1: 0, p2: 0 } });

    // A phone leaving mid-match ends it: lobby, countdown timer cancelled, readiness cleared.
    const countdown = h.timers.filter((t) => t.live).at(-1)!;
    h.s.leave('p1');
    expect(countdown.live).toBe(false);
    expect(h.lastState()).toMatchObject({ phase: 'lobby', matchRound: 0, scores: { p2: 0 }, needs: 'waiting for 1 more phone' });
    expect(h.lastState().players.map((p: any) => p.ready)).toEqual([false]);
    expect(h.errors).toEqual([]);
  });

  it('breaks a tie to nobody, and treats an early (null) raise during fire as a foul', () => {
    const h = twoPhones();
    toFire(h);
    h.raised('p2', 300);
    h.raised('p1', 300);
    expect(h.events('roundResult').at(-1)).toMatchObject({ winnerId: null, reason: 'tie', scores: { p1: 0, p2: 0 } });
    expect(h.lastState().phase).toBe('roundOver');

    h.ready('p1');
    h.ready('p2');
    h.tick();
    h.tick();
    h.raised('p2', null);
    expect(h.events('roundResult').at(-1)).toMatchObject({ winnerId: 'p1', reason: 'foul' });
  });

  it('ignores stale, malformed and duplicate input', () => {
    const h = twoPhones();
    h.s.remote('p1', 'ready', { round: 99 }); // a ready from before an invalidation
    h.s.remote('p1', 'ready', {});
    expect(h.lastState().players.map((p: any) => p.ready)).toEqual([false, false]);
    toFire(h);
    const round = h.lastState().round;
    h.s.remote('p1', 'raised', { round: round - 1, sinceFireMs: 100 });
    h.s.remote('p1', 'raised', { sinceFireMs: 100 });
    h.s.remote('p1', 'raised', { round, sinceFireMs: 'x' });
    h.s.remote('p1', 'raised', { round, sinceFireMs: -5 });
    expect(h.events('roundResult')).toEqual([]);
    h.raised('p1', 200);
    h.raised('p1', 50); // a duplicate keeps the first report
    h.raised('p2', 300);
    expect(h.events('roundResult')).toEqual([expect.objectContaining({ winnerId: 'p1', reactionMs: { p1: 200, p2: 300 } })]);
    h.raised('p2', 10); // late duplicate after the round
    expect(h.events('roundResult')).toHaveLength(1);
    h.s.remote('p1', 'ready', { round: round - 1 });
    h.s.remote('p2', 'ready', { round: round - 1 });
    expect(h.lastState().phase).toBe('roundOver'); // stale readies start nothing
  });

  it('has no referee role: a ref-role client stays a spectator and nothing it sends matters', () => {
    const h = twoPhones();
    h.s.join('r', 'Ref');
    h.s.remote('r', 'role', { role: 'ref' });
    expect(h.lastState().players.find((p: any) => p.id === 'r').role).toBeNull();
    h.s.remote('r', 'start', {});
    h.ready('p1');
    h.ready('p2'); // the two phones alone start the countdown
    expect(h.lastState().phase).toBe('countdown');
    h.s.remote('r', 'raised', { round: h.lastState().round, sinceFireMs: null });
    expect(h.lastState().phase).toBe('countdown');
  });

  it('queues extra phones FIFO, keeps them out of the match, and promotes the head when a slot frees', () => {
    const h = twoPhones();
    for (const id of ['q1', 'q2']) {
      h.s.join(id, id);
      h.s.remote(id, 'role', { role: 'phone' });
    }
    h.s.remote('q1', 'role', { role: 'phone' }); // a reload keeps its place, no second entry
    expect(h.lastState().queue).toEqual(['q1', 'q2']);
    expect(h.lastState().players.find((p: any) => p.id === 'q1').role).toBe('queued');
    h.ready('q1'); // queued phones cannot ready
    h.ready('p1');
    expect(h.lastState().phase).toBe('lobby');
    h.ready('p2');
    h.tick();
    h.tick();
    h.raised('q1', 1); // nor draw
    expect(h.events('roundResult')).toEqual([]);
    h.s.leave('p2'); // a match phone leaves: lobby, readiness reset, the queue head takes the slot
    expect(h.lastState()).toMatchObject({ phase: 'lobby', queue: ['q2'] });
    expect(h.lastState().players.filter((p: any) => p.role === 'phone').map((p: any) => p.id)).toEqual(['p1', 'q1']);
    expect(h.lastState().players.map((p: any) => p.ready)).toEqual([false, false, false]);
  });

  it('keeps pos in state only', () => {
    const h = twoPhones();
    const before = h.fired.length;
    h.s.remote('p1', 'pos', { lat: 40.35, lon: -74.65, acc: 12 });
    expect(h.fired.length).toBe(before);
    expect(JSON.parse(h.s.stateJSON()).players.p1.pos).toMatchObject({ lat: 40.35, lon: -74.65, acc: 12 });
  });
});
