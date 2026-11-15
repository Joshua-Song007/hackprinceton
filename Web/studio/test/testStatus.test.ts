import { describe, expect, it } from 'vitest';
import { checkGame, type Check } from '../src/gamePanel';
import { Project, templateSnapshot } from '../src/project';
import { gameSnapshot } from './games';
import { deviceCaption, devicesSubtitle, emptyPlayersText, playingText, readinessRows, readinessSummary, runLine, slotWords } from '../src/testStatus';

describe('readinessRows', () => {
  it('a blank game has one thing to fix; server scripts and publishing are optional; the run state is dropped', () => {
    const blank = new Project(templateSnapshot('blank'));
    const checks = checkGame(blank, 'Stopped', null).checks;
    const r = readinessRows(checks);
    expect(r.needs).toMatch(/^Needs /);
    expect(r.rows.map((x) => [x.level, x.label])).toEqual([
      ['fix', '0 script attachments'],
      ['optional', '0 server scripts'],
      ['optional', 'Not published'],
    ]);
    expect(r.fixes).toBe(1);
    expect(r.rows.some((x) => x.label.startsWith('Last run'))).toBe(false);
  });

  it('a game that has everything is ready; only the not-published row is left', () => {
    const game = new Project(gameSnapshot('QuickDraw'));
    const r = readinessRows(checkGame(game, 'Stopped', null).checks);
    expect(r.fixes).toBe(0);
    expect(r.rows.map((x) => x.level)).toEqual(['optional']);
    expect(readinessSummary(r.fixes)).toBe('Ready to play');
  });

  it('keeps hints and one-click fixes, and shows the last publish time as done', () => {
    const fix = { label: 'Declare these', setting: 'inputs', value: {} };
    const checks: Check[] = [
      { ok: false, label: 'Inputs not declared', hint: 'Scripts use head', fix },
      { ok: true, label: 'Published as version 2', kind: 'publish' },
      { ok: true, label: 'Last published: today', kind: 'publish' },
      { ok: false, label: 'Last run: Stopped', kind: 'run' },
    ];
    const r = readinessRows(checks);
    expect(r.rows).toEqual([
      { level: 'fix', label: 'Inputs not declared', hint: 'Scripts use head', fix },
      { level: 'done', label: 'Last published: today' },
    ]);
    expect(r.needs).toBeNull();
  });

  it('the summary counts things to fix', () => {
    expect(readinessSummary(1)).toBe('1 thing to fix');
    expect(readinessSummary(3)).toBe('3 things to fix');
  });
});

describe('checkGame tags', () => {
  it('marks server scripts optional and the run and publish checks by kind', () => {
    const checks = checkGame(new Project(templateSnapshot('blank')), 'Stopped', null).checks;
    expect(checks.find((c) => c.label.endsWith('server scripts'))?.optional).toBe(true);
    expect(checks.find((c) => c.label.startsWith('Last run'))?.kind).toBe('run');
    expect(checks.find((c) => c.label === 'Not published')?.kind).toBe('publish');
  });
});

describe('the words', () => {
  it('says the player count one way', () => {
    expect(playingText(0, { min: 1, max: 2 })).toBe('0 playing · allows 1 to 2');
    expect(playingText(3, { min: 3, max: 3 })).toBe('3 playing · allows 3');
  });

  it('describes where a device is worn and who holds it', () => {
    expect(slotWords('hand')).toBe('Held in hand');
    expect(slotWords('leftWrist')).toBe('Worn on the left wrist');
    expect(slotWords('tail')).toBe('tail');
    expect(deviceCaption('hand', 'Each player has their own')).toBe('Held in hand · each player has their own');
    expect(deviceCaption('head', 'Held by Ada')).toBe('Worn on the head · held by Ada');
  });

  it('explains the device list in the three cases', () => {
    expect(devicesSubtitle(true, true)).toBe('The game lists these devices, so you get exactly them.');
    expect(devicesSubtitle(false, true)).toBe('Remembered in this browser (the game lists none).');
    expect(devicesSubtitle(false, false)).toBe('The game needs no input. These devices are remembered in this browser.');
  });

  it('says what Play does before it runs, and names the run state', () => {
    expect(emptyPlayersText(1)).toBe('Nobody is playing yet. Play starts with 1 player; add more here once it runs.');
    expect(emptyPlayersText(2)).toBe('Nobody is playing yet. Play starts with 2 players; add more here once it runs.');
    expect(runLine('Playing locally', true)).toBe('Playing locally');
    expect(runLine('  ', false)).toBe('Stopped');
    expect(runLine('', true)).toBe('Running');
  });
});
