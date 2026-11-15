import { INSTRUCTION_LIMITS, parseInstructions, parseScene } from '@pear/runtime';
import { describe, expect, it } from 'vitest';
import { addPhase, addRole, blankInstructions, editInstructions, instructionsDiff, lintMessages, parseStepsText, playersMismatch, removePhase, removeRole, stepsText } from '../src/instructionsPanel';
import { Project, limitsText, playersText, templateSnapshot } from '../src/project';

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
    expect(seen).toEqual(['instructions', 'scene']); // the scene's declared player count follows the instructions
    p.setInstructions(draw());
    expect(seen).toEqual(['instructions', 'scene']);
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
    expect(seen).toEqual(['proposal', 'instructions', 'scene', 'proposal']);
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
    phases: [{ id: 'p1', title: 'Warm up', text: 'Stretch', steps: [{ role: 'runner', do: 'Stretch' }] }], win: 'First across', lose: 'Drop the baton',
  });

  it('a blank set parses to empty fields, and an edit is cleaned by the parse (min above max is swapped, ids stay unique)', () => {
    expect(blankInstructions()).toMatchObject({ title: '', lose: '', roles: [], phases: [], players: { min: 1, max: 32 } });
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
      title: 'Relay 2', summary: '', lose: 'Leave the lane', players: { min: 2, max: 6 }, setup: ['Stand in a circle'], gestures: ['flick'], devices: { watch: 'free' },
      roles: [{ id: 'runner', name: 'Sprinter', brief: 'Runs', kind: 'player' }, { id: 'coach', name: 'Coach', brief: '', kind: 'player' }],
      phases: [{ id: 'p1', title: 'Warm up', text: 'Stretch', steps: [] }, { id: 'p2', title: 'Race', text: '', steps: [{ role: '', do: 'Go' }] }],
    });
    const lines = instructionsDiff(base(), next);
    expect(lines).toEqual(expect.arrayContaining([
      'Title changed from "Relay" to "Relay 2".',
      'Summary cleared.',
      'Lose condition changed from "Drop the baton" to "Leave the lane".',
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

  it('a scene that declares another player count than the instructions is a mismatch, one that agrees or declares none is not', () => {
    const i = parseInstructions({ players: { min: 3, max: 3 } });
    expect(playersMismatch(i, () => parseScene({ inputs: { gestures: ['tap'], players: [2, 4] }, entities: [] }))).toBe(true);
    expect(playersMismatch(i, () => parseScene({ inputs: { gestures: ['tap'], players: [3, 3] }, entities: [] }))).toBe(false);
    expect(playersMismatch(i, () => parseScene({ entities: [] }))).toBe(false);
    expect(playersMismatch(i, () => { throw new Error('bad'); })).toBe(false);
  });

  it('lint messages come from the scene, and a scene that does not parse is one line', () => {
    const scene = parseScene({ inputs: { gestures: ['tap'], players: [3, 3] }, entities: [] });
    const messages = lintMessages(base(), () => scene);
    expect(messages.some((m) => m.includes('2 to 4 players'))).toBe(true);
    expect(lintMessages(parseInstructions({ players: { min: 3, max: 3 }, gestures: ['tap'], roles: [], win: 'Fastest tap', lose: 'Tap early' }), () => parseScene({ inputs: { gestures: ['tap'], players: [3, 3] }, entities: [] }))).toEqual([]);
    expect(lintMessages(base(), () => { throw new Error('bad scene'); })).toEqual(['Scene is invalid: bad scene']);
  });
});

describe('one player limit', () => {
  const scenePlayers = (p: Project) => (p.scene.inputs as { players: number[] }).players;
  const withInstructions = (players: { min: number; max: number }) => {
    const p = new Project(templateSnapshot('blank'));
    p.setInstructions(parseInstructions({ title: 'T', players }));
    return p;
  };

  it('comes from the instructions, else the scene inputs, else the default', () => {
    const p = new Project(templateSnapshot('hotpotato'));
    expect(p.playerLimits()).toEqual({ min: 2, max: 32, from: 'scene' });
    p.setInstructions(parseInstructions({ title: 'T', players: { min: 3, max: 5 } }));
    expect(p.playerLimits()).toEqual({ min: 3, max: 5, from: 'instructions' });
    const bare = new Project(templateSnapshot('blank'));
    delete bare.scene.inputs;
    expect(bare.playerLimits()).toEqual({ min: 1, max: 32, from: 'default' });
  });

  it('setting the instructions writes the same count to the scene in the same undo step, and undo restores both', () => {
    const p = new Project(templateSnapshot('blank'));
    const seen: string[] = [];
    p.onChange((c) => seen.push(c));
    p.setInstructions(parseInstructions({ title: 'T', players: { min: 3, max: 3 } }));
    expect(scenePlayers(p)).toEqual([3, 3]);
    expect(seen).toEqual(['instructions', 'scene']);
    p.undo();
    expect(p.instructions).toBeNull();
    expect(scenePlayers(p)).toEqual([1, 32]);
  });

  it('setPlayers writes both together as one step, and says so when it cannot', () => {
    const p = withInstructions({ min: 1, max: 4 });
    expect(p.setPlayers(2, 6)).toBeUndefined();
    expect(p.instructions!.players).toEqual({ min: 2, max: 6 });
    expect(scenePlayers(p)).toEqual([2, 6]);
    p.undo();
    expect(p.instructions!.players).toEqual({ min: 1, max: 4 });
    expect(scenePlayers(p)).toEqual([1, 4]);
    for (const bad of [[0, 3], [4, 3], [1, 33], [1.5, 3]] as const) expect(p.setPlayers(bad[0], bad[1])).toMatch(/whole numbers from 1 to 32/);
    const none = new Project(templateSnapshot('blank'));
    delete none.scene.inputs;
    expect(none.setPlayers(2, 3)).toMatch(/Write the instructions/);
  });

  it('setPlayers with no instructions changes the scene only, and the same value is no step', () => {
    const p = new Project(templateSnapshot('blank'));
    expect(p.setPlayers(2, 5)).toBeUndefined();
    expect(scenePlayers(p)).toEqual([2, 5]);
    expect(p.instructions).toBeNull();
    const steps = p.canUndo;
    p.undo();
    expect(scenePlayers(p)).toEqual([1, 32]);
    expect(steps).toBe(true);
    expect(p.setPlayers(1, 32)).toBeUndefined();
    expect(p.canUndo).toBe(false);
  });

  it('accepting a proposal moves the scene to its count, and a scene write cannot make the two differ', () => {
    const p = withInstructions({ min: 2, max: 2 });
    p.propose({ title: 'T', players: { min: 4, max: 6 } });
    p.acceptProposal();
    expect(scenePlayers(p)).toEqual([4, 6]);
    expect(p.setSceneSetting('inputs', { gestures: ['tap'], players: [1, 32] })).toBeUndefined();
    expect(scenePlayers(p)).toEqual([4, 6]);
    expect(p.applyPeripheralChange({ inputs: { head: false, position: false, heartRate: false, gestures: ['tap'], players: [1, 8] } })).toBeUndefined();
    expect(scenePlayers(p)).toEqual([4, 6]);
    expect(p.setScene({ ...p.scene, inputs: { gestures: ['tap'], players: [9, 9] } })).toBeUndefined();
    expect(scenePlayers(p)).toEqual([4, 6]);
  });

  it('a scene without inputs is left alone, and a loaded mismatch is not rewritten', () => {
    const p = withInstructions({ min: 2, max: 3 });
    p.setSceneSetting('inputs', null);
    p.setInstructions(parseInstructions({ title: 'T', players: { min: 3, max: 4 } }));
    expect(p.scene.inputs).toBeUndefined();
    const snap = templateSnapshot('blank');
    snap.instructions = parseInstructions({ title: 'T', players: { min: 5, max: 6 } });
    const loaded = new Project(snap);
    expect(scenePlayers(loaded)).toEqual([1, 32]);
    expect(loaded.playerLimits()).toMatchObject({ min: 5, max: 6, from: 'instructions' });
  });

  it('says the limit the same way everywhere', () => {
    expect(limitsText({ min: 2, max: 4 })).toBe('2 to 4');
    expect(limitsText({ min: 3, max: 3 })).toBe('3');
    expect(playersText(3, { min: 2, max: 4 })).toBe('3 players (the game allows 2 to 4)');
    expect(playersText(1, { min: 1, max: 1 })).toBe('1 player (the game allows 1)');
  });
});
