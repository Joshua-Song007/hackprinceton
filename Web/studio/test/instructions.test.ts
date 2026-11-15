import { parseInstructions } from '@pear/runtime';
import { describe, expect, it } from 'vitest';
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
