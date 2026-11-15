import { describe, expect, it, vi } from 'vitest';
import { parseInstructions, parseScene } from '@pear/runtime';
import type { ScriptSandbox } from '@pear/script';
import type { SimDeviceKind } from '@pear/sim';
import { LocalRun, RunController, type RunDeps, type TestPlayer } from '../src/run';

const sandbox = { loadScript: async () => {}, call: async () => ({ outputs: [] }), dispose: () => {} } as unknown as ScriptSandbox;

const player = (id: string, x: number, z: number, kinds: SimDeviceKind[] = ['airpods', 'phone']): TestPlayer => {
  const run = new LocalRun({ scene: parseScene({}), clientScripts: {}, sandbox, devices: { kinds } });
  run.devices.setPosition(x, 1.6, z);
  return { id, name: id, run, wander: false, source: 'manual', botMode: 'chase', botEvery: 2, botLeft: 2, liveDevices: new Set(), lastEvent: null, hapticAt: 0, goal: null, cues: [], agent: null };
};

const instructions = parseInstructions({
  title: 'T', roles: [{ id: 'ref', name: 'Referee', brief: 'Runs it', kind: 'ref' }, { id: 'runner', name: 'Runner', brief: 'Runs', kind: 'player' }],
  phases: [{ id: 'p1', title: 'Warm up', text: 'Stretch', steps: [] }],
});

type Internals = {
  server: unknown;
  agentTransport: unknown;
  holders: Map<string, string>;
  cue(p: TestPlayer, kind: string, text: string): void;
  applyAgent(p: TestPlayer, a: unknown): void;
  walk(): void;
  wander(): void;
};

function setup(opts: { instructions?: boolean; url?: string | null; local?: boolean } = {}) {
  const logs: string[] = [];
  const viewport = { setRunning: vi.fn() };
  const deps = {
    project: { instructions: opts.instructions === false ? null : instructions, playerLimits: () => ({ min: 2, max: 4, from: 'instructions' }) },
    debug: { addOutput: (_l: string, text: string) => void logs.push(text), setServerConnected: vi.fn() },
    viewport,
    agentUrl: () => (opts.url === undefined ? 'ws://runtime' : opts.url),
  } as unknown as RunDeps;
  const run = new RunController(deps);
  const players = [player('player-1', 0, 0), player('player-2', 0, -3), player('player-3', 0, 3), player('player-4', 20, 0)];
  run.players = players;
  run.driven = 'player-1';
  const internals = run as unknown as Internals;
  if (opts.local !== false) internals.server = { dispose() {} };
  return { run, players, logs, internals, viewport };
}

describe('observationFor', () => {
  it('shows only who is in front and in range, and clears the cues once read', () => {
    const { run, players, internals } = setup();
    internals.cue(players[0]!, 'haptic', 'tap 1');
    const first = run.observationFor('player-1')!;
    expect(first.others.map((o) => o.id)).toEqual(['player-2']);
    expect(JSON.stringify(first)).not.toMatch(/player-3|player-4/);
    expect(first.heard).toMatchObject([{ kind: 'haptic', text: 'tap 1' }]);
    expect(run.observationFor('player-1')!.heard).toEqual([]);
    expect(run.observationFor('nobody')).toBeNull();
  });
});

describe('what an agent can do', () => {
  it('turns its head toward a player or a spot, and notes an unknown player', () => {
    const { players, internals } = setup();
    const me = players[0]!;
    internals.applyAgent(me, { type: 'look_at', player: 'player-3' });
    expect(Math.abs(me.run.devices.headLook.yaw)).toBeCloseTo(Math.PI);
    internals.applyAgent(me, { type: 'look_at', x: -5, z: 0 });
    expect(me.run.devices.headLook.yaw).toBeCloseTo(Math.PI / 2);
    internals.applyAgent(me, { type: 'look_at', player: 'ghost' });
    expect(me.cues.at(-1)).toMatchObject({ kind: 'note', text: expect.stringContaining('ghost') });
  });

  it('speech is heard within 8 m by others only', () => {
    const { players, internals, logs } = setup();
    internals.applyAgent(players[0]!, { type: 'say', text: 'ready?' });
    expect(players[1]!.cues).toMatchObject([{ kind: 'speech', text: 'ready?', from: 'player-1' }]);
    expect(players[2]!.cues).toHaveLength(1);
    expect(players[3]!.cues).toEqual([]);
    expect(players[0]!.cues).toEqual([]);
    expect(logs).toContain('[player-1] says: ready?');
  });

  it('a gesture needs a phone: with one it is sent, without one it comes back as a note', () => {
    const { players, internals } = setup();
    const gesture = vi.spyOn(players[0]!.run.devices, 'gesture');
    internals.applyAgent(players[0]!, { type: 'gesture', gesture: 'flick' });
    expect(gesture).toHaveBeenCalledWith('flick', [1, 0, 0]);
    const bare = player('player-5', 0, 0, ['airpods']);
    internals.applyAgent(bare, { type: 'gesture', gesture: 'tap' });
    expect(bare.cues).toMatchObject([{ kind: 'note', text: expect.stringContaining('no phone') }]);
  });

  it('giving a device needs holding it and a real receiver, then hands it over', () => {
    const { run, players, internals } = setup();
    internals.applyAgent(players[0]!, { type: 'give_device', device: 'phone', to: 'player-2' });
    expect(players[0]!.cues.at(-1)).toMatchObject({ kind: 'note', text: expect.stringContaining('do not hold') });
    internals.holders.set('phone', 'player-1');
    internals.applyAgent(players[0]!, { type: 'give_device', device: 'phone', to: 'ghost' });
    expect(players[0]!.cues.at(-1)).toMatchObject({ kind: 'note', text: expect.stringContaining('ghost') });
    expect(run.holderOf('phone')).toBe('player-1');
    internals.applyAgent(players[0]!, { type: 'give_device', device: 'phone', to: 'player-2' });
    expect(run.holderOf('phone')).toBe('player-2');
  });
});

describe('setAgent', () => {
  it('makes an agent of a plain player and plays its instructions role', () => {
    const { run, players } = setup();
    players[1]!.wander = true;
    players[1]!.source = 'bot';
    expect(run.setAgent('player-2', { persona: 'cheats', role: 'ref' })).toBeUndefined();
    expect(players[1]!.agent?.seat).toEqual({ persona: 'cheats', role: 'ref' });
    expect(players[1]!.wander).toBe(false);
    expect(players[1]!.source).toBe('manual');
    expect(players[1]!.run.role).toBe('ref');
    expect(run.setAgent('player-2', null)).toBeUndefined();
    expect(players[1]!.agent).toBeNull();
  });

  it('answers with a sentence instead of making an agent it cannot run', () => {
    expect(setup({ local: false }).run.setAgent('player-2', { persona: 'follows', role: '' })).toMatch(/local Play/);
    expect(setup().run.setAgent('player-1', { persona: 'follows', role: '' })).toMatch(/cannot be the player you drive/);
    const replay = setup();
    replay.players[1]!.source = 'replay';
    expect(replay.run.setAgent('player-2', { persona: 'follows', role: '' })).toMatch(/Manual/);
    expect(setup({ instructions: false }).run.setAgent('player-2', { persona: 'follows', role: '' })).toMatch(/instructions first/);
    expect(setup({ url: null }).run.setAgent('player-2', { persona: 'follows', role: '' })).toMatch(/Install the Deep Agent plugin/);
  });

  it('driving, wandering or a clip takes the player back from its agent', () => {
    const { run, players } = setup();
    for (const act of [() => run.drive('player-2'), () => run.setWander('player-2', true), () => run.setSource('player-2', 'live')]) {
      run.driven = 'player-1';
      run.setAgent('player-2', { persona: 'follows', role: '' });
      expect(players[1]!.agent).not.toBeNull();
      act();
      expect(players[1]!.agent).toBeNull();
    }
  });
});

describe('hold and release', () => {
  it('notify listeners, freeze walking and wandering, and resume after', () => {
    const { run, players, internals } = setup();
    const seen = vi.fn();
    run.onChange(seen);
    players[1]!.goal = [5, 5];
    players[2]!.wander = true;
    run.hold();
    expect(run.held).toBe(true);
    const before = [[...players[1]!.run.devices.position], [...players[2]!.run.devices.position]];
    internals.walk();
    internals.wander();
    expect([...players[1]!.run.devices.position]).toEqual(before[0]);
    expect([...players[2]!.run.devices.position]).toEqual(before[1]);
    run.release();
    expect(run.held).toBe(false);
    internals.walk();
    expect([...players[1]!.run.devices.position]).not.toEqual(before[0]);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe('the playtest report', () => {
  type Pending = { resolve(r: { unsure: { phase: string; line: string; why: string }[]; summary: string }): void; reject(e: Error): void };
  function seeded() {
    const s = setup();
    const reports: Pending[] = [];
    s.internals.agentTransport = {
      decide: () => new Promise(() => {}),
      report: () => new Promise((resolve, reject) => reports.push({ resolve, reject } as Pending)),
      close() {},
    };
    s.run.setAgent('player-2', { persona: 'cheats', role: 'runner' });
    const driver = s.players[1]!.agent!;
    driver.calls = 2;
    driver.notes.push({ from: 'player-2', gameTime: 3, phase: 'p1', line: 'Stretch', why: 'how long?', kind: 'unsure' });
    return { ...s, reports, driver };
  }

  it('finishing answers with a sentence when there is nothing to finish', async () => {
    expect(await setup({ local: false }).run.finishPlaytest()).toMatch(/local Play/);
    expect(await setup().run.finishPlaytest()).toBe('No agent players to finish.');
    const fresh = setup();
    fresh.run.setAgent('player-2', { persona: 'follows', role: '' });
    expect(await fresh.run.finishPlaytest()).toBe('The agents have not played yet.');
  });

  it('asks each agent to look back, then builds the report with the instructions title, phase and role names', async () => {
    const { run, reports } = seeded();
    const seen = vi.fn();
    run.onChange(seen);
    const done = run.finishPlaytest();
    expect(run.finishing).toBe(true);
    expect(await run.finishPlaytest()).toBe('The agents are already looking back.');
    reports[0]!.resolve({ unsure: [{ phase: 'p1', line: 'Pass it', why: 'to whom?' }], summary: 'Fine.' });
    expect(await done).toBeUndefined();
    expect(run.finishing).toBe(false);
    expect(run.report).toMatchObject({
      title: 'T', lookedBack: true, calls: 2,
      players: [{ id: 'player-2', persona: 'cheats', role: 'Runner', summary: 'Fine.' }],
      groups: [{ phase: 'p1', title: 'Warm up', items: [{ line: 'Pass it' }, { line: 'Stretch' }] }], // the look back's note carries the driver's last game time (0 here: it never decided)
    });
    expect(seen).toHaveBeenCalled();
    expect(await run.finishPlaytest()).toBe('The playtest is finished.');
  });

  it('a stop without the look back keeps a report of the notes so far, and a finished one is left alone', async () => {
    const a = seeded();
    a.run.stop();
    expect(a.run.report).toMatchObject({ lookedBack: false, groups: [{ title: 'Warm up' }] });
    const b = seeded();
    const done = b.run.finishPlaytest();
    b.reports[0]!.resolve({ unsure: [], summary: '' });
    await done;
    const finished = b.run.report;
    b.run.stop();
    expect(b.run.report).toBe(finished);
  });

  it('a stop during the look back keeps the partial report and drops the late answer', async () => {
    const { run, reports } = seeded();
    const done = run.finishPlaytest();
    run.stop();
    reports[0]!.resolve({ unsure: [{ phase: 'p1', line: 'Late', why: 'too late' }], summary: 'late' });
    await done;
    expect(run.finishing).toBe(false);
    expect(run.report).toMatchObject({ lookedBack: false });
    expect(JSON.stringify(run.report)).not.toContain('Late');
  });

  it('an agent taken off its player still has its notes in the report', () => {
    const { run } = seeded();
    run.drive('player-2');
    run.stop();
    expect(run.report).toMatchObject({ players: [{ id: 'player-2' }], groups: [{ items: [{ line: 'Stretch', from: ['player-2'] }] }] });
  });
});

describe('nobody driven', () => {
  it('drive(null) stops driving but keeps the run on screen, and driving a player binds the viewport to it', () => {
    const { run, players, viewport } = setup();
    const seen = vi.fn();
    run.onChange(seen);
    run.drive(null);
    expect(run.driven).toBeNull();
    expect(run.drivenPlayer).toBeUndefined();
    expect(viewport.setRunning).toHaveBeenLastCalledWith(null, undefined, true);
    expect(seen).toHaveBeenCalledTimes(1);
    run.drive('player-3');
    expect(run.driven).toBe('player-3');
    expect(viewport.setRunning).toHaveBeenLastCalledWith(players[2]!.run.devices);
  });

  it('removing the driven player leaves nobody driven in local Play', () => {
    const { run } = setup();
    run.status = { ...run.status, kind: 'local' };
    run.drive('player-3');
    run.removePlayer('player-3');
    expect(run.driven).toBeNull();
    expect(run.players.map((p) => p.id)).toEqual(['player-1', 'player-2', 'player-4']);
  });

  it('every player can be an agent when nobody is driven, but not the driven one', () => {
    const { run } = setup();
    expect(run.setAgent('player-1', { persona: 'follows', role: '' })).toMatch(/cannot be the player you drive/);
    run.drive(null);
    expect(run.setAgent('player-1', { persona: 'follows', role: '' })).toBeUndefined();
  });

  it('a seat can carry a call budget and a quiet limit', () => {
    const { run, players } = setup();
    run.drive(null);
    expect(run.setAgent('player-2', { persona: 'skims', role: 'runner' }, { calls: 20, quiet: true })).toBeUndefined();
    const driver = players[1]!.agent as unknown as { cap: number; o: { quiet: boolean } };
    expect(driver.cap).toBe(20);
    expect(driver.o.quiet).toBe(true);
    expect(run.setAgent('player-3', { persona: 'skims', role: '' })).toBeUndefined();
    expect((players[2]!.agent as unknown as { cap: number }).cap).toBe(60);
  });
});

describe('starting a playtest', () => {
  const options = { players: 3, crew: 'realistic' as const, calls: 40 };

  it('says what is missing instead of starting', async () => {
    expect(await setup({ instructions: false }).run.startPlaytest(options)).toMatch(/instructions first/);
    expect(await setup({ url: null }).run.startPlaytest(options)).toMatch(/Install the Deep Agent plugin/);
    const s = setup();
    expect(await s.run.startPlaytest({ ...options, players: 0 })).toMatch(/Choose between/);
    expect(await s.run.startPlaytest({ ...options, players: 33 })).toMatch(/Choose between/);
  });

  it('will not replace a server or join run', async () => {
    const s = setup();
    (s.internals as unknown as { local: unknown }).local = {};
    s.run.status = { ...s.run.status, kind: 'server' };
    expect(await s.run.startPlaytest(options)).toBe('Stop the current run first.');
  });
});

describe('watching a playtest', () => {
  const entry = (from: string, gameTime: number, text: string) => ({ gameTime, from, kind: 'did' as const, text });

  it('merges the play-by-play of every agent by game time, with the role name beside each player', () => {
    const { run, players } = setup();
    run.drive(null);
    run.setAgent('player-2', { persona: 'follows', role: 'ref' });
    run.setAgent('player-3', { persona: 'skims', role: 'runner' });
    players[1]!.agent!.log.push(entry('player-2', 5, 'says "go"'), entry('player-2', 9, 'waits 2 s'));
    players[2]!.agent!.log.push(entry('player-3', 7, 'walks to x 1.0, z 1.0'));
    expect(run.playtestLog().map((l) => [l.who, l.entry.gameTime])).toEqual([['player-2 (Referee)', 5], ['player-3 (Runner)', 7], ['player-2 (Referee)', 9]]);
  });

  it('ends the playtest by itself once every agent has used its decisions, and not before', async () => {
    const s = setup();
    const reports: { resolve(r: { unsure: never[]; summary: string }): void }[] = [];
    s.internals.agentTransport = { decide: () => new Promise(() => {}), report: () => new Promise((resolve) => reports.push({ resolve } as never)), close() {} };
    s.run.drive(null);
    s.run.setAgent('player-2', { persona: 'follows', role: '' }, { calls: 2, quiet: true });
    s.run.setAgent('player-3', { persona: 'follows', role: '' }, { calls: 2, quiet: true });
    const [a, b] = [s.players[1]!.agent!, s.players[2]!.agent!];
    a.calls = 2;
    b.calls = 1;
    (s.run as unknown as { playtest: unknown }).playtest = { options: { players: 3, crew: 'realistic', calls: 2 }, state: 'running' };
    const tick = () => (s.run as unknown as { agentTick(): void }).agentTick();
    tick();
    expect(s.run.finishing).toBe(false);
    expect(b.status).toBe('thinking'); // the first tick sent its last decision: not done while it is in flight
    (b as unknown as { thinking: boolean }).thinking = false;
    tick();
    expect(s.run.finishing).toBe(true);
    expect(s.run.playtest?.state).toBe('finishing');
    reports.forEach((r) => r.resolve({ unsure: [], summary: 'ok' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(s.run.finishing).toBe(false);
    expect(s.run.playtest?.state).toBe('done');
    expect(s.run.report?.lookedBack).toBe(true);
  });

  it('stopping keeps the play-by-play and marks the playtest done', () => {
    const { run, players } = setup();
    run.drive(null);
    run.setAgent('player-2', { persona: 'follows', role: '' });
    players[1]!.agent!.log.push(entry('player-2', 3, 'says "hi"'));
    players[1]!.agent!.calls = 1;
    (run as unknown as { playtest: unknown }).playtest = { options: { players: 4, crew: 'careful', calls: 20 }, state: 'running' };
    run.stop();
    expect(run.playtest?.state).toBe('done');
    expect(run.playtestLog().map((l) => l.entry.text)).toEqual(['says "hi"']);
  });
});
