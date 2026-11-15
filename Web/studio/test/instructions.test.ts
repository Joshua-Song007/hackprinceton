import { INSTRUCTION_LIMITS, parseInstructions, parseScene } from '@pear/runtime';
import { describe, expect, it } from 'vitest';
import { addPhase, addRole, blankInstructions, editInstructions, instructionsDiff, lintMessages, parseStepsText, removePhase, removeRole, stepsText } from '../src/instructionsPanel';
import { Project, templateSnapshot } from '../src/project';

const draw = () => parseInstructions({ title: 'Quick Draw', players: { min: 3, max: 3 }, roles: [{ id: 'ref', kind: 'ref' }] });

describe('project instructions', () => {
  it('has none at first and keeps the key out of the snapshot', () => {
    const p = new Project(templateSnapshot('blank'));
    expect(p.instructions).toBeNull();
    expect('instructions' in p.snapshot()).toBe(false);
  });

  it('setInstructions is one undoable step, and the same value changes nothing', () => {
    const p = new Project(templateSnapshot('blank'));
    const seen: string[] = [];
    p.onChange((c) => seen.push(c));
    p.setInstructions(draw());
    expect(p.instructions).toEqual(draw());
    expect(p.dirty).toBe(true);
    expect(seen).toEqual(['instructions']);
    p.setInstructions(draw());
    expect(seen).toEqual(['instructions']);
    p.undo();
    expect(p.instructions).toBeNull();
    p.redo();
    expect(p.instructions).toEqual(draw());
  });

  it('stores a copy, so editing the original later does not change the project', () => {
    const p = new Project(templateSnapshot('blank'));
    const mine = draw();
    p.setInstructions(mine);
    mine.title = 'changed';
    expect(p.instructions!.title).toBe('Quick Draw');
  });

  it('carries instructions to the cloud in metadata and back, and drops metadata that is not an object', () => {
    const p = new Project(templateSnapshot('blank'));
    expect(p.toVersion().metadata).not.toHaveProperty('instructions');
    p.setInstructions(draw());
    const body = p.toVersion();
    expect(body.metadata.instructions).toEqual(draw());
    const version = { ...body, id: 'v', game_id: 'g', version: 2, published_at: '' };
    expect(Project.snapshotOfVersion(version).instructions).toEqual(draw());
    expect('instructions' in Project.snapshotOfVersion({ ...version, metadata: { instructions: 5 } })).toBe(false);
    expect('instructions' in Project.snapshotOfVersion({ ...version, metadata: null as unknown as Record<string, unknown> })).toBe(false);
  });

  it('a proposal waits for the creator: accept applies it as an undoable step, reject drops it', () => {
    const p = new Project(templateSnapshot('blank'));
    const seen: string[] = [];
    p.onChange((c) => seen.push(c));
    expect(p.propose({ title: 'Quick Draw', players: { min: 3, max: 3 }, roles: [{ id: 'ref', kind: 'ref' }] })).toBeUndefined();
    expect(p.proposal).toEqual(draw());
    expect(p.instructions).toBeNull();
    expect(p.dirty).toBe(false);
    p.acceptProposal();
    expect(p.instructions).toEqual(draw());
    expect(p.proposal).toBeNull();
    expect(seen).toEqual(['proposal', 'instructions', 'proposal']);
    p.undo();
    expect(p.instructions).toBeNull();
    p.propose({ title: 'Other' });
    p.rejectProposal();
    expect(p.proposal).toBeNull();
    expect(p.instructions).toBeNull();
  });

  it('a bad proposal returns a sentence and leaves the pending one alone; loading drops a pending proposal', () => {
    const p = new Project(templateSnapshot('blank'));
    p.propose({ title: 'First' });
    expect(p.propose(7)).toBe('instructions: expected object');
    expect(p.proposal!.title).toBe('First');
    p.load(templateSnapshot('flagship'));
    expect(p.proposal).toBeNull();
  });
});

describe('instructions panel helpers', () => {
  const base = () => parseInstructions({
    title: 'Relay', summary: 'Pass the baton', players: { min: 2, max: 4 }, setup: ['Stand in a line'], gestures: ['tap'], devices: { phone: 'passed' },
    roles: [{ id: 'ref', name: 'Referee', brief: 'Starts it', kind: 'ref' }, { id: 'runner', name: 'Runner', brief: 'Runs', kind: 'player' }],
    phases: [{ id: 'p1', title: 'Warm up', text: 'Stretch', steps: [{ role: 'runner', do: 'Stretch' }] }], win: 'First across',
  });

  it('a blank set parses to empty fields, and an edit is cleaned by the parse (min above max is swapped, ids stay unique)', () => {
    expect(blankInstructions()).toMatchObject({ title: '', roles: [], phases: [], players: { min: 1, max: 32 } });
    expect(editInstructions(base(), { players: { min: 6, max: 3 } }).players).toEqual({ min: 3, max: 6 });
    expect(editInstructions(base(), { title: '  New  ' }).title).toBe('New');
    expect(editInstructions(base(), { roles: [...base().roles, { id: 'ref', name: 'Dup', brief: '', kind: 'player' }] }).roles).toHaveLength(2);
  });

  it('adds and removes roles and phases with the lowest unused id, and stops at the limits', () => {
    const one = addRole(base());
    expect(one.roles.map((r) => r.id)).toEqual(['ref', 'runner', 'role-1']);
    expect(addRole(removeRole(one, 'ref')).roles.map((r) => r.id)).toEqual(['runner', 'role-1', 'role-2']);
    expect(removeRole(base(), 'ref').roles.map((r) => r.id)).toEqual(['runner']);
    expect(addPhase(base()).phases.map((p) => p.id)).toEqual(['p1', 'phase-1']);
    expect(removePhase(addPhase(base()), 'p1').phases.map((p) => p.id)).toEqual(['phase-1']);
    let roles = blankInstructions();
    for (let n = 0; n < INSTRUCTION_LIMITS.roles + 2; n++) roles = addRole(roles);
    expect(roles.roles).toHaveLength(INSTRUCTION_LIMITS.roles);
    let phases = blankInstructions();
    for (let n = 0; n < INSTRUCTION_LIMITS.phases + 2; n++) phases = addPhase(phases);
    expect(phases.phases).toHaveLength(INSTRUCTION_LIMITS.phases);
  });

  it('steps text is one step per line and round-trips, including a step for every player and a bar in the text', () => {
    const steps = [{ role: 'ref', do: 'Say go' }, { role: '', do: 'Start | now' }];
    expect(stepsText(steps)).toBe('ref | Say go\n| Start | now');
    expect(parseStepsText(stepsText(steps))).toEqual(steps);
    expect(parseStepsText('Everyone cheers\n\n  runner  |  runs  \n')).toEqual([{ role: '', do: 'Everyone cheers' }, { role: 'runner', do: 'runs' }]);
  });

  it('a diff against nothing summarizes the proposal, an equal one says no changes', () => {
    expect(instructionsDiff(null, base())).toEqual(['New instructions: "Relay", 2 roles, 1 phase.']);
    expect(instructionsDiff(base(), base())).toEqual(['No changes.']);
  });

  it('a diff names each kind of change', () => {
    const next = editInstructions(base(), {
      title: 'Relay 2', summary: '', players: { min: 2, max: 6 }, setup: ['Stand in a circle'], gestures: ['flick'], devices: { watch: 'free' },
      roles: [{ id: 'runner', name: 'Sprinter', brief: 'Runs', kind: 'player' }, { id: 'coach', name: 'Coach', brief: '', kind: 'player' }],
      phases: [{ id: 'p1', title: 'Warm up', text: 'Stretch', steps: [] }, { id: 'p2', title: 'Race', text: '', steps: [{ role: '', do: 'Go' }] }],
    });
    const lines = instructionsDiff(base(), next);
    expect(lines).toEqual(expect.arrayContaining([
      'Title changed from "Relay" to "Relay 2".',
      'Summary cleared.',
      'Players changed from 2 to 4 to 2 to 6.',
      'Setup line removed: "Stand in a line".',
      'Setup line added: "Stand in a circle".',
      'Gesture removed: tap.',
      'Gesture added: flick.',
      "The phone changes from passed between players to each player's own.",
      'The watch changes from each player\'s own to free in the room.',
      'Role added: Coach (player).',
      'Role "Sprinter" changed: name.',
      'Role removed: Referee.',
      'Phase added: Race (1 step).',
      'Phase "Warm up" changed: steps (1 to 0).',
    ]));
    expect(lines).not.toContain('No changes.');
  });

  it('a long text is cut in the diff', () => {
    const next = editInstructions(base(), { summary: 'x'.repeat(100) });
    const line = instructionsDiff(base(), next)[0]!;
    expect(line).toBe(`Summary changed from "Pass the baton" to "${'x'.repeat(57)}...".`);
  });

  it('lint messages come from the scene, and a scene that does not parse is one line', () => {
    const scene = parseScene({ inputs: { gestures: ['tap'], players: [3, 3] }, entities: [] });
    const messages = lintMessages(base(), () => scene);
    expect(messages.some((m) => m.includes('2 to 4 players'))).toBe(true);
    expect(lintMessages(parseInstructions({ players: { min: 3, max: 3 }, gestures: ['tap'], roles: [] }), () => parseScene({ inputs: { gestures: ['tap'], players: [3, 3] }, entities: [] }))).toEqual([]);
    expect(lintMessages(base(), () => { throw new Error('bad scene'); })).toEqual(['Scene is invalid: bad scene']);
  });
});
