import { describe, expect, it } from 'vitest';
import {
  CALL_BUDGETS, CREWS, PERSONA_LABELS, agentColorVar, assignRoles, costText, describeAction, describeCue, describeUnsure, logLine, personaFor, readiness, seatCrew, startProblem,
} from '../src/playtestPlan';
import { PERSONAS } from '../src/agentPlayers';

const roles = [
  { id: 'ref', kind: 'ref' as const }, { id: 'runner', kind: 'player' as const }, { id: 'scorer', kind: 'player' as const },
];

describe('agentColorVar', () => {
  it('gives each player a token the viewport also uses, and cycles past the last one', () => {
    expect(agentColorVar(0)).toBe('--axis-z');
    expect(agentColorVar(1)).toBe('--selection');
    expect(agentColorVar(4)).toBe(agentColorVar(0));
    expect(new Set([0, 1, 2, 3].map(agentColorVar)).size).toBe(4);
  });
});

describe('crews and budgets', () => {
  it('every crew only names known behaviours, and every behaviour has a plain label', () => {
    for (const c of CREWS) for (const p of c.personas) expect(PERSONAS).toContain(p);
    for (const p of PERSONAS) expect(PERSONA_LABELS[p].length).toBeGreaterThan(10);
  });

  it('the n-th player takes the crew behaviours in turn', () => {
    expect([0, 1, 2, 3, 4].map((n) => personaFor('realistic', n))).toEqual(['follows', 'skims', 'confused', 'follows', 'skims']);
    expect([0, 1, 2].map((n) => personaFor('careful', n))).toEqual(['follows', 'follows', 'follows']);
    expect([0, 1, 2].map((n) => personaFor('rule-benders', n))).toEqual(['cheats', 'follows', 'cheats']);
  });

  it('the budgets stay within the most one player may use, and the cost line multiplies', () => {
    expect(CALL_BUDGETS.map((b) => b.calls)).toEqual([20, 40, 60]);
    expect(costText(3, 40)).toBe('Up to 120 Deep Agent calls (3 players x 40 decisions each).');
    expect(costText(1, 20)).toBe('Up to 20 Deep Agent calls (1 player x 20 decisions each).');
  });
});

describe('assignRoles and seatCrew', () => {
  it('every referee role once first, then the player roles in turn', () => {
    expect(assignRoles(roles, 5)).toEqual(['ref', 'runner', 'scorer', 'runner', 'scorer']);
    expect(assignRoles(roles, 2)).toEqual(['ref', 'runner']);
    expect(assignRoles(roles, 1)).toEqual(['ref']);
  });

  it('only referee roles repeat; no roles gives none', () => {
    expect(assignRoles([{ id: 'ref', kind: 'ref' }], 3)).toEqual(['ref', 'ref', 'ref']);
    expect(assignRoles([], 3)).toEqual(['', '', '']);
    expect(assignRoles([{ id: 'p', kind: 'player' }], 3)).toEqual(['p', 'p', 'p']);
  });

  it('a seat is a behaviour and a role', () => {
    expect(seatCrew(4, 'realistic', roles)).toEqual([
      { persona: 'follows', role: 'ref' }, { persona: 'skims', role: 'runner' }, { persona: 'confused', role: 'scorer' }, { persona: 'follows', role: 'runner' },
    ]);
    expect(seatCrew(0, 'mix', roles)).toEqual([]);
  });
});

describe('the words of the play-by-play', () => {
  it('describes every kind of action', () => {
    expect(describeAction({ type: 'walk_to', x: 2, z: 3 })).toBe('walks to x 2.0, z 3.0');
    expect(describeAction({ type: 'look_at', player: 'player-3' })).toBe('looks at player-3');
    expect(describeAction({ type: 'look_at', x: 1, z: 0 })).toBe('looks toward x 1.0, z 0.0');
    expect(describeAction({ type: 'gesture', gesture: 'tap' })).toBe('does a tap');
    expect(describeAction({ type: 'give_device', device: 'phone', to: 'player-3' })).toBe('gives the phone to player-3');
    expect(describeAction({ type: 'say', text: 'ready?' })).toBe('says "ready?"');
    expect(describeAction({ type: 'wait', seconds: 2 })).toBe('waits 2 s');
  });

  it('describes every kind of cue', () => {
    expect(describeCue({ t: 1, kind: 'speech', text: 'go', from: 'player-2' })).toBe('hears player-2 say "go"');
    expect(describeCue({ t: 1, kind: 'speech', text: 'go' })).toBe('hears someone say "go"');
    expect(describeCue({ t: 1, kind: 'haptic', text: 'tap 1' })).toBe('feels a buzz: tap 1');
    expect(describeCue({ t: 1, kind: 'audio', text: 'play beep' })).toBe('hears a sound: play beep');
    expect(describeCue({ t: 1, kind: 'note', text: 'no phone' })).toBe('could not: no phone');
  });

  it('describes a note about the instructions, with or without a line and phase', () => {
    expect(describeUnsure({ phase: 'p1', line: 'Pass it', why: 'to whom?' })).toBe('was not sure about "Pass it" (phase p1): to whom?');
    expect(describeUnsure({ phase: '', line: '', why: 'who starts?' })).toBe('was not sure: who starts?');
  });

  it('a line says when and who', () => {
    const entry = { gameTime: 12.4, from: 'player-2', kind: 'did' as const, text: 'says "ready?"' };
    expect(logLine(entry)).toBe('12 s  player-2 says "ready?"');
    expect(logLine(entry, (id) => `${id} (Referee)`)).toBe('12 s  player-2 (Referee) says "ready?"');
  });
});

describe('readiness and startProblem', () => {
  const ok = { hasInstructions: true, hasPlugin: true, limits: { min: 2, max: 4 }, players: 3 };

  it('everything ready means no problem', () => {
    expect(readiness(ok).every((i) => i.ok)).toBe(true);
    expect(readiness(ok)[2]!.label).toBe('3 players, inside the limit (the game allows 2 to 4)');
    expect(startProblem(ok)).toBeUndefined();
  });

  it('names the first thing that is missing, in the order a creator fixes them', () => {
    expect(startProblem({ ...ok, hasInstructions: false, hasPlugin: false })).toBe("Write the game's instructions first (the Instructions panel).");
    expect(startProblem({ ...ok, hasPlugin: false })).toBe('Install the Deep Agent plugin first.');
    expect(startProblem({ ...ok, players: 5 })).toBe('Choose between 2 and 4 players.');
    expect(startProblem({ ...ok, players: 1 })).toBe('Choose between 2 and 4 players.');
    expect(startProblem({ ...ok, players: Number.NaN })).toBe('Choose between 2 and 4 players.');
  });

  it('says the limit as one number when min and max are equal', () => {
    expect(readiness({ ...ok, limits: { min: 3, max: 3 } })[2]!.label).toBe('3 players, inside the limit (the game allows 3)');
    expect(readiness({ ...ok, players: 5 })[2]!.label).toBe('5 players is outside the limit (the game allows 2 to 4)');
  });
});
