import { describe, expect, it } from 'vitest';
import prelude from '../../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js?raw';
import quickdraw from '../../../../Games/QuickDraw/scripts/game.js?raw';
import { LocalServer } from '../src';

function make() {
  const fired: [string | null, string, any][] = [];
  const errors: string[] = [];
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const clock = { t: 1_000_000 };
  const s = new LocalServer({
    prelude,
    onFire: (p, n, d) => fired.push([p, n, d]),
    onError: (m) => errors.push(m),
    now: () => clock.t,
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
  return { s, fired, errors, timers, events, lastState, tick, ready, raised, clock };
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

function toFireFromCountdown(h: ReturnType<typeof make>) {
  h.tick();
  h.tick();
  expect(h.lastState().phase).toBe('fire');
}

// After a round that did not end the match: both lowered, the minimum roundOver time elapses, the next countdown starts by itself.
function nextRound(h: ReturnType<typeof make>) {
  h.s.remote('p1', 'lowered', {});
  h.s.remote('p2', 'lowered', {});
  expect(h.lastState().phase).toBe('roundOver'); // not before the minimum display time
  const t = h.tick();
  expect(t.ms).toBe(2500);
  expect(h.lastState().phase).toBe('countdown');
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
      { id: 'p1', name: 'Ann', ready: true, role: 'phone', raised: false, idleKickAt: null },
      { id: 'p2', name: 'Bo', ready: false, role: 'phone', raised: false, idleKickAt: 1_045_000 }, // p2 holds up a ready p1
    ]);
    expect(h.lastState().phones).toEqual(['p1', 'p2']);
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
    expect(h.events('arming')).toEqual([{ round: 1 }]);
    h.raised('p1', null);
    expect(arm.live).toBe(false);
    expect(h.events('roundResult')).toEqual([
      { round: 1, matchRound: 1, winnerId: 'p2', reason: 'foul', reactionMs: { p1: null, p2: null }, scores: { p1: 0, p2: 1 } },
    ]);
    expect(h.lastState().phase).toBe('roundOver');
    expect(h.lastState().needs).toBe('both phones: lower your phone, the next round starts by itself');
    expect(h.lastState().players.map((p: any) => p.raised)).toEqual([true, false]); // server-tracked from raised/lowered

    // Round 2 starts by itself (no ready); both raise after the cue; the lower time wins whatever the arrival order. 1-1.
    h.s.remote('p1', 'ready', { round: h.lastState().round }); // a ready in roundOver is ignored
    h.tick(); // the 2500 ms minimum passes, but p1 is still raised
    expect(h.lastState().phase).toBe('roundOver');
    h.s.remote('p1', 'lowered', {}); // the last phone lowering starts it
    expect(h.lastState()).toMatchObject({ phase: 'countdown', round: 2, matchRound: 2 });
    expect(h.lastState().players.map((p: any) => p.raised)).toEqual([false, false]);
    h.tick();
    h.tick();
    expect(h.events('fire')).toEqual([{ round: 2 }]);
    h.raised('p2', 300);
    expect(h.lastState().phase).toBe('fire'); // waiting for p1's report
    h.raised('p1', 250);
    expect(h.events('roundResult').at(-1)).toEqual({ round: 2, matchRound: 2, winnerId: 'p1', reason: 'fast', reactionMs: { p1: 250, p2: 300 }, scores: { p1: 1, p2: 1 } });
    expect(h.lastState().phase).toBe('roundOver');

    // Round 3: only p2 reports; the report window closes and p2 takes the match 2-1.
    nextRound(h);
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

    h.s.remote('p1', 'lowered', {});
    h.s.remote('p2', 'lowered', {});
    h.tick();
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

  it('promotes from the queue after every change and moves an idle phone to the back after 45 s', () => {
    const h = twoPhones();
    h.s.join('q1', 'Q1');
    h.s.remote('q1', 'role', { role: 'phone' });
    h.s.join('q2', 'Q2');
    h.s.remote('q2', 'role', { role: 'phone' });
    h.ready('p1');
    const idle = h.timers.filter((t) => t.live).at(-1)!;
    expect(idle.ms).toBe(45000);
    expect(h.lastState().players.find((p: any) => p.id === 'p2').idleKickAt).toBe(h.clock.t + 45000);
    idle.live = false;
    idle.fn(); // p2 never readied: back of the queue, q1 takes the slot, p1 keeps its readiness
    expect(h.lastState()).toMatchObject({ phase: 'lobby', queue: ['q2', 'p2'], phones: ['p1', 'q1'] });
    expect(h.lastState().players.map((p: any) => [p.id, p.role, p.ready])).toEqual([['p1', 'phone', true], ['p2', 'queued', false], ['q1', 'phone', false], ['q2', 'queued', false]]);
    expect(h.lastState().players.find((p: any) => p.id === 'q1').idleKickAt).toBe(h.clock.t + 45000);
    h.ready('q1');
    expect(h.lastState().phase).toBe('countdown'); // the idle clock was cancelled by the start
    expect(h.timers.filter((t) => t.live && t.ms === 45000)).toEqual([]);
  });

  it('keeps an idle phone when nobody is queued, and kicks in matchOver too', () => {
    const h = twoPhones();
    h.ready('p1');
    const idle = h.timers.filter((t) => t.live).at(-1)!;
    idle.live = false;
    idle.fn();
    expect(h.lastState()).toMatchObject({ phase: 'lobby', queue: [], phones: ['p1', 'p2'] });
    expect(h.lastState().players.find((p: any) => p.id === 'p2').idleKickAt).toBeNull();
    h.s.join('q1', 'Q1'); // someone queues later: the clock starts again
    h.s.remote('q1', 'role', { role: 'phone' });
    expect(h.lastState().players.find((p: any) => p.id === 'p2').idleKickAt).not.toBeNull();
    h.ready('p2');
    toFireFromCountdown(h);
    h.raised('p1', 100);
    h.raised('p2', 200);
    nextRound(h);
    h.tick();
    h.tick();
    h.raised('p1', 100);
    h.raised('p2', 200);
    expect(h.lastState().phase).toBe('matchOver');
    h.ready('p1');
    const idle2 = h.timers.filter((t) => t.live).at(-1)!;
    expect(idle2.ms).toBe(45000);
    idle2.live = false;
    idle2.fn();
    expect(h.lastState()).toMatchObject({ phase: 'lobby', queue: ['p2'], phones: ['p1', 'q1'] });
  });

  it('fills a free slot as soon as a phone joins an empty slot, and handles a ghost leaving in any phase', () => {
    const h = twoPhones();
    h.s.leave('p2');
    h.s.join('p3', 'Cy');
    h.s.remote('p3', 'role', { role: 'phone' });
    expect(h.lastState()).toMatchObject({ queue: [], phones: ['p1', 'p3'] });
    h.ready('p1');
    h.ready('p3');
    h.tick();
    h.tick();
    h.raised('p1', 10);
    h.raised('p3', 20);
    h.s.leave('p3'); // leaves during roundOver
    expect(h.lastState()).toMatchObject({ phase: 'lobby', phones: ['p1'] });
    expect(h.errors).toEqual([]);
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
});
