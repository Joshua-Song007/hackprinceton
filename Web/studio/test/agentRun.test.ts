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
});

type Internals = {
  server: unknown;
  holders: Map<string, string>;
  cue(p: TestPlayer, kind: string, text: string): void;
  applyAgent(p: TestPlayer, a: unknown): void;
  walk(): void;
  wander(): void;
};

function setup(opts: { instructions?: boolean; url?: string | null; local?: boolean } = {}) {
  const logs: string[] = [];
  const deps = {
    project: { instructions: opts.instructions === false ? null : instructions },
    debug: { addOutput: (_l: string, text: string) => void logs.push(text) },
    viewport: { setRunning: vi.fn() },
    agentUrl: () => (opts.url === undefined ? 'ws://runtime' : opts.url),
  } as unknown as RunDeps;
  const run = new RunController(deps);
  const players = [player('player-1', 0, 0), player('player-2', 0, -3), player('player-3', 0, 3), player('player-4', 20, 0)];
  run.players = players;
  run.driven = 'player-1';
  const internals = run as unknown as Internals;
  if (opts.local !== false) internals.server = {};
  return { run, players, logs, internals };
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
