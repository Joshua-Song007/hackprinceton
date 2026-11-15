import { describe, expect, it } from 'vitest';
import { emptyForm, newGameSnapshot, templatePlayers, validateNewGame, type NewGameForm } from '../src/newGame';
import { Project } from '../src/project';

const filled = (over: Partial<NewGameForm> = {}): NewGameForm => ({
  ...emptyForm('blank'), title: 'Relay', summary: 'Pass the baton', min: '2', max: '4', win: 'First across', lose: 'Drop the baton', ...over,
});

describe('validateNewGame', () => {
  it('lists every required thing that is missing, in the order of the form', () => {
    expect(validateNewGame(emptyForm('blank'))).toEqual([
      'Give the game a title.',
      'Describe the game in a sentence or two (the summary).',
      'Say how many players: the fewest and the most, whole numbers from 1 to 32.',
      'Say how the game is won.',
      'Say how the game is lost.',
    ]);
  });

  it('accepts a filled form, and whitespace alone does not count', () => {
    expect(validateNewGame(filled())).toEqual([]);
    expect(validateNewGame(filled({ title: '  ', win: '\n' }))).toEqual(['Give the game a title.', 'Say how the game is won.']);
  });

  it('checks the player numbers', () => {
    expect(validateNewGame(filled({ min: '5', max: '3' }))).toEqual(['The fewest players cannot be more than the most.']);
    for (const bad of [{ min: '0' }, { max: '33' }, { min: '1.5' }, { max: '' }, { min: 'two' }]) {
      expect(validateNewGame(filled(bad))).toEqual(['Say how many players: the fewest and the most, whole numbers from 1 to 32.']);
    }
    expect(validateNewGame(filled({ min: '3', max: '3' }))).toEqual([]);
  });

  it('asks for a name on every role, and a game with no roles is fine', () => {
    expect(validateNewGame(filled({ roles: [{ name: 'Player', brief: '', kind: 'player' }, { name: ' ', brief: 'x', kind: 'ref' }] }))).toEqual(['Give every role a name, or remove the empty ones.']);
    expect(validateNewGame(filled({ roles: [] }))).toEqual([]);
  });
});

describe('templatePlayers and the starting form', () => {
  it('only a count the template chose is filled in', () => {
    expect(templatePlayers('hotpotato')).toEqual([2, 32]);
    expect(templatePlayers('blank')).toBeNull();
    expect(templatePlayers('tapcounter')).toBeNull();
    expect(templatePlayers('flagship')).toBeNull();
    expect(emptyForm('hotpotato')).toMatchObject({ min: '2', max: '32' });
    expect(emptyForm('blank')).toMatchObject({ min: '', max: '', roles: [{ name: 'Player', kind: 'player' }], phases: [] });
  });
});

describe('newGameSnapshot', () => {
  it('writes the instructions into the template, names the scene after the game and sets its player count', () => {
    const snap = newGameSnapshot(filled({
      roles: [{ name: 'Runner', brief: 'Runs', kind: 'player' }, { name: 'Runner', brief: 'Runs too', kind: 'player' }, { name: 'The Ref!', brief: '', kind: 'ref' }, { name: ' ', brief: '', kind: 'player' }],
      phases: [{ title: 'Race', text: 'Go' }, { title: '', text: '' }],
    }));
    expect(snap.instructions).toMatchObject({
      title: 'Relay', summary: 'Pass the baton', players: { min: 2, max: 4 }, win: 'First across', lose: 'Drop the baton',
      roles: [{ id: 'runner', name: 'Runner' }, { id: 'runner-2', name: 'Runner' }, { id: 'the-ref', name: 'The Ref!', kind: 'ref' }],
      phases: [{ id: 'phase-1', title: 'Race', text: 'Go', steps: [] }],
    });
    expect(snap.scene.name).toBe('Relay');
    expect((snap.scene.inputs as { players: number[] }).players).toEqual([2, 4]);
  });

  it('keeps the template, and the project it opens as has one player limit', () => {
    const snap = newGameSnapshot(filled({ template: 'hotpotato', min: '3', max: '5' }));
    expect(Object.keys(snap.clientScripts).length + Object.keys(snap.serverScripts).length).toBeGreaterThan(0);
    const p = new Project(snap);
    expect(p.playerLimits()).toEqual({ min: 3, max: 5, from: 'instructions' });
    expect((p.scene.inputs as { players: number[] }).players).toEqual([3, 5]);
    expect(p.name).toBe('Relay');
  });
});
