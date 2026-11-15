import { describe, expect, it } from 'vitest';
import { INSTRUCTION_LIMITS, InstructionsError, lintInstructions, parseInstructions, parseScene } from '../src';

const scene = parseScene({
  name: 'Quick Draw',
  inputs: { gestures: ['tap'], players: [3, 3] },
  ownership: { phone: { mode: 'passed' } },
  entities: [],
});

const good = () => parseInstructions({
  title: 'Quick Draw',
  players: { min: 3, max: 3 },
  gestures: ['tap'],
  devices: { phone: 'passed' },
  roles: [{ id: 'ref', name: 'Referee', brief: 'Calls the draw.', kind: 'ref' }, { id: 'duelist', name: 'Duelist' }],
  phases: [{ id: 'draw', title: 'Draw', text: 'Wait for the cue.', steps: [{ role: 'duelist', do: 'Tap when the cue sounds' }, { role: '', do: 'Stand still' }] }],
  win: 'The faster clean tap wins.',
  lose: 'Tapping before the cue loses the round.',
});

describe('parseInstructions', () => {
  it('fills defaults from an empty object', () => {
    expect(parseInstructions({})).toEqual({
      title: '', summary: '', space: '', setup: [], players: { min: 1, max: 32 }, gestures: [], devices: {}, roles: [], phases: [], win: '', lose: '',
    });
  });

  it('throws only when the value is not an object', () => {
    for (const bad of [null, 5, 'x', [], undefined]) expect(() => parseInstructions(bad)).toThrow(InstructionsError);
    expect(() => parseInstructions({ title: 5, setup: 'x', roles: 3, phases: {}, devices: 7, gestures: 'tap' })).not.toThrow();
  });

  it('drops bad entries and keeps good ones', () => {
    const p = parseInstructions({
      gestures: ['tap', 'wave', 'tap', 'flick'],
      devices: { phone: 'passed', watch: 'bogus', airpods: 'player', tv: 'free' },
      roles: [{ id: 'a' }, { id: '' }, 'x', { id: 'a', name: 'Dup' }, { id: 'b', kind: 'wizard' }],
      phases: [{ steps: [{ role: 'a', do: '' }, { role: 5, do: 'x' }, { role: 'a', do: 'ok' }] }, 'x', {}],
      setup: ['one', '', 3, '  two  '],
    });
    expect(p.gestures).toEqual(['tap', 'flick']);
    expect(p.devices).toEqual({ phone: 'passed' });
    expect(p.roles).toEqual([{ id: 'a', name: 'a', brief: '', kind: 'player' }, { id: 'b', name: 'b', brief: '', kind: 'player' }]);
    expect(p.phases.map((x) => x.id)).toEqual(['phase-1', 'phase-2']);
    expect(p.phases[0]!.steps).toEqual([{ role: 'a', do: 'ok' }]);
    expect(p.setup).toEqual(['one', 'two']);
  });

  it('cuts to the limits, then trims, and a second parse changes nothing', () => {
    const L = INSTRUCTION_LIMITS;
    const spaced = 'a'.repeat(L.long - 1) + ' ' + 'b'.repeat(50);
    const p = parseInstructions({
      summary: spaced,
      setup: Array.from({ length: 40 }, (_, i) => `step ${i}`),
      roles: Array.from({ length: 30 }, (_, i) => ({ id: `r${i}` })),
      phases: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, steps: Array.from({ length: 50 }, () => ({ role: '', do: 'x' })) })),
    });
    expect(p.summary).toBe('a'.repeat(L.long - 1));
    expect(p.setup).toHaveLength(L.setup);
    expect(p.roles).toHaveLength(L.roles);
    expect(p.phases).toHaveLength(L.phases);
    expect(p.phases[0]!.steps).toHaveLength(L.steps);
    expect(parseInstructions(p)).toEqual(p);
  });

  it('renames a repeated phase id and keeps it stable', () => {
    const long = 'x'.repeat(INSTRUCTION_LIMITS.id);
    const p = parseInstructions({ phases: [{ id: 'a' }, { id: 'a' }, { id: 'a' }, { id: long }, { id: long }] });
    expect(p.phases.map((x) => x.id)).toEqual(['a', 'a-2', 'a-3', long, 'x'.repeat(INSTRUCTION_LIMITS.id - 2) + '-2']);
    expect(parseInstructions(p)).toEqual(p);
  });

  it('clamps players, swaps them, and defaults what is not a whole number', () => {
    expect(parseInstructions({ players: { min: 0, max: 99 } }).players).toEqual({ min: 1, max: 32 });
    expect(parseInstructions({ players: { min: 8, max: 2 } }).players).toEqual({ min: 2, max: 8 });
    expect(parseInstructions({ players: { min: 1.5, max: 'x' } }).players).toEqual({ min: 1, max: 32 });
    expect(parseInstructions({ players: [2, 4] }).players).toEqual({ min: 2, max: 4 });
  });
});

describe('lintInstructions', () => {
  it('is quiet when the instructions and the scene agree', () => {
    expect(lintInstructions(good(), scene)).toEqual([]);
  });

  it('flags a player count the scene disagrees with', () => {
    const w = lintInstructions({ ...good(), players: { min: 2, max: 4 } }, scene);
    expect(w.map((x) => x.code)).toEqual(['players']);
    expect(w[0]!.message).toBe('The instructions say 2 to 4 players; scene.json says 3.');
  });

  it('flags gestures missing from the scene and gestures the instructions never use', () => {
    expect(lintInstructions({ ...good(), gestures: ['tap', 'flick'] }, scene).map((x) => x.code)).toEqual(['gesture-missing']);
    expect(lintInstructions({ ...good(), gestures: [] }, scene).map((x) => x.code)).toEqual(['gesture-unused']);
  });

  it('flags a device the instructions and the scene hold differently, including one only the scene frees', () => {
    expect(lintInstructions({ ...good(), devices: {} }, scene).map((x) => x.code)).toEqual(['device']);
    const freeScene = parseScene({ inputs: { gestures: ['tap'], players: [3, 3] }, ownership: { phone: { mode: 'passed' }, watch: { mode: 'free' } }, entities: [] });
    const w = lintInstructions(good(), freeScene);
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toBe("The instructions say the watch is each player's own; scene.json says a free-floating room device.");
  });

  it('flags a step for an undeclared role and a phase with no steps, but not a role-less game or an all-players step', () => {
    const base = good();
    const bad = { ...base, phases: [{ id: 'x', title: '', text: '', steps: [{ role: 'ghost', do: 'boo' }] }, { id: 'y', title: '', text: '', steps: [] }] };
    expect(lintInstructions(bad, scene).map((x) => x.code)).toEqual(['step-role', 'phase-empty']);
    expect(lintInstructions({ ...bad, roles: [] }, scene).map((x) => x.code)).toEqual(['phase-empty']);
  });

  it('flags a game with no way to win or no way to lose', () => {
    expect(lintInstructions({ ...good(), win: '' }, scene).map((x) => x.code)).toEqual(['win-missing']);
    const w = lintInstructions({ ...good(), lose: '' }, scene);
    expect(w.map((x) => [x.code, x.message])).toEqual([['lose-missing', 'The instructions say nothing about how the game is lost.']]);
    expect(lintInstructions({ ...good(), win: '', lose: '' }, scene).map((x) => x.code)).toEqual(['win-missing', 'lose-missing']);
  });

  it('keeps and cuts the lose text like the win text', () => {
    expect(parseInstructions({ lose: '  Drop it and you are out  ' }).lose).toBe('Drop it and you are out');
    expect(parseInstructions({ lose: 'x'.repeat(INSTRUCTION_LIMITS.long + 50) }).lose).toHaveLength(INSTRUCTION_LIMITS.long);
    expect(parseInstructions({ lose: 7 }).lose).toBe('');
  });

  it('skips the players and gesture checks when the scene declares no inputs', () => {
    const bare = parseScene({ ownership: { phone: { mode: 'passed' } }, entities: [] });
    expect(lintInstructions({ ...good(), players: { min: 1, max: 2 }, gestures: ['flick'] }, bare)).toEqual([]);
  });
});
