import { describe, expect, it, vi } from 'vitest';
import type { AgentNoteRecord } from '../src/agentPlayers';
import { EMPTY_TEXT, NO_PHASE_TITLE, PROMPT_LIMIT, buildPlaytestReport, playtestLines, playtestPrompt, sendReport, type PlaytestPlayer } from '../src/playtestReport';

const note = (from: string, phase: string, line: string, why: string, gameTime = 1, kind: AgentNoteRecord['kind'] = 'unsure'): AgentNoteRecord => ({ from, gameTime, phase, line, why, kind });
const player = (id: string, calls = 3, summary = ''): PlaytestPlayer => ({ id, persona: 'follows', role: 'Runner', calls, status: 'stopped', summary });
const phases = [{ id: 'p1', title: 'Warm up' }, { id: 'p2', title: 'Race' }];
const build = (notes: AgentNoteRecord[], extra: Partial<Parameters<typeof buildPlaytestReport>[0]> = {}) =>
  buildPlaytestReport({ title: 'Relay', phases, gameTime: 42.4, players: [player('player-2'), player('player-3', 5, 'Fine.')], notes, lookedBack: true, ...extra });

describe('buildPlaytestReport', () => {
  it('groups notes by phase in the instructions order, then unknown ids, then no phase', () => {
    const r = build([note('player-2', '', 'Setup', 'where?'), note('player-2', 'zz', 'Odd', 'who?'), note('player-3', 'p2', 'Go', 'when?'), note('player-2', 'p1', 'Pass it', 'to whom?')]);
    expect(r.groups.map((g) => [g.phase, g.title])).toEqual([['p1', 'Warm up'], ['p2', 'Race'], ['zz', 'zz'], ['', NO_PHASE_TITLE]]);
    expect(r.calls).toBe(8);
  });

  it('merges the same note from two players into one item at its earliest time, ordered by time', () => {
    const r = build([note('player-3', 'p1', 'Pass it', 'to whom?', 9), note('player-2', 'p1', 'Pass it', 'to whom?', 4), note('player-2', 'p1', 'Pass it', 'to whom?', 6), note('player-2', 'p1', 'Early', 'huh', 2)]);
    expect(r.groups[0]!.items).toEqual([
      { line: 'Early', why: 'huh', from: ['player-2'], gameTime: 2 },
      { line: 'Pass it', why: 'to whom?', from: ['player-3', 'player-2'], gameTime: 4 },
    ]);
  });

  it('keeps notes about the run apart from notes about the instructions, once each', () => {
    const r = build([note('player-2', '', '', 'no key', 1, 'run'), note('player-2', '', '', 'no key', 5, 'run'), note('player-3', 'p1', 'Pass it', 'to whom?')]);
    expect(r.problems).toEqual([{ from: 'player-2', why: 'no key' }]);
    expect(r.groups).toHaveLength(1);
    expect(playtestPrompt(r)).not.toContain('no key');
  });

  it('an empty run has no groups, no prompt and says so', () => {
    const r = build([]);
    expect(r.groups).toEqual([]);
    expect(playtestPrompt(r)).toBe('');
    expect(playtestLines(r).empty).toBe(EMPTY_TEXT);
    expect(playtestLines(build([note('player-2', '', '', 'no key', 1, 'run')])).empty).toBe('');
  });
});

describe('playtestPrompt', () => {
  it('names the game, the players and the notes by phase, and asks for a revision', () => {
    const text = playtestPrompt(build([note('player-2', 'p1', 'Pass it', 'to whom?', 4), note('player-3', '', '', 'Nobody said who starts', 7)]));
    expect(text).toBe([
      'Playtest of "Relay": 2 agent players, 42 s of game time. They flagged these parts of the instructions:',
      'Phase "Warm up":',
      '- "Pass it" (player-2): to whom?',
      `${NO_PHASE_TITLE}:`,
      '- (player-3): Nobody said who starts',
      'Revise the instructions to fix these. Keep everything else.',
    ].join('\n'));
  });

  it('is cut to the limit by dropping whole items and says how many', () => {
    const notes = Array.from({ length: 120 }, (_, i) => note('player-2', 'p1', `Line number ${i}`, 'x'.repeat(80), i));
    const text = playtestPrompt(build(notes));
    expect(text.length).toBeLessThanOrEqual(PROMPT_LIMIT);
    expect(text).toMatch(/… and \d+ more\nRevise the instructions/);
    const kept = text.split('\n').filter((l) => l.startsWith('- ')).length;
    const dropped = Number(/… and (\d+) more/.exec(text)![1]);
    expect(kept + dropped).toBe(120);
  });
});

describe('playtestLines and sendReport', () => {
  it('writes the summary, one row per player and the notes with who and when', () => {
    const lines = playtestLines(build([note('player-2', 'p1', 'Pass it', 'to whom?', 4)]));
    expect(lines.summary).toBe('2 agent players, 8 calls, 42 s of game time. Look back done.');
    expect(lines.players).toEqual(['player-2: follows, Runner, 3 calls', 'player-3: follows, Runner, 5 calls. Fine.']);
    expect(lines.groups).toEqual([{ title: 'Warm up', items: ['"Pass it" (player-2, 4 s): to whom?'] }]);
    expect(playtestLines(build([], { lookedBack: false })).summary).toContain('Stopped before the look back.');
  });

  it('sends the prompt, passes on a refusal sentence, and sends nothing for an empty report', () => {
    const r = build([note('player-2', 'p1', 'Pass it', 'to whom?')]);
    const ok = vi.fn(() => undefined);
    expect(sendReport(r, ok)).toBe('');
    expect(ok).toHaveBeenCalledWith(playtestPrompt(r));
    expect(sendReport(r, () => 'Open the Deep Agent panel first.')).toBe('Open the Deep Agent panel first.');
    const none = vi.fn(() => undefined);
    expect(sendReport(build([]), none)).toBe('Nothing to send.');
    expect(none).not.toHaveBeenCalled();
  });
});
