import { parseInstructions } from '@pear/runtime';
import { describe, expect, it } from 'vitest';
import { matches } from '../src/menubar';
import { Project, templateSnapshot } from '../src/project';
import { gameSnapshot } from './games';
import { parseProjectFile, safeFileName, serializeProject } from '../src/projectFile';

describe('project file', () => {
  it('round-trips a project', () => {
    const snap = gameSnapshot('QuickDraw');
    expect(parseProjectFile(serializeProject(snap))).toEqual(snap);
  });

  it('keeps instructions through a file, and a file without them opens with none', () => {
    const instructions = parseInstructions({ title: 'Quick Draw', players: { min: 3, max: 3 }, roles: [{ id: 'ref', kind: 'ref' }] });
    const snap = { ...gameSnapshot('QuickDraw'), instructions };
    expect(parseProjectFile(serializeProject(snap))).toEqual(snap);
    const plain = parseProjectFile(serializeProject(gameSnapshot('QuickDraw')));
    expect('instructions' in plain).toBe(false);
  });

  it('refuses instructions that are not an object, with a sentence', () => {
    const text = JSON.stringify({ format: 'pear-project', v: 1, scene: {}, clientScripts: {}, serverScripts: {}, instructions: 5 });
    expect(() => parseProjectFile(text)).toThrow("The project file's instructions are not valid: instructions: expected object");
  });

  it.each([
    ['not json', '{'],
    ['wrong format', '{"format":"x","v":1}'],
    ['future version', JSON.stringify({ format: 'pear-project', v: 2 })],
    ['no scene', JSON.stringify({ format: 'pear-project', v: 1, clientScripts: {}, serverScripts: {} })],
    ['script not text', JSON.stringify({ format: 'pear-project', v: 1, scene: {}, clientScripts: { a: 1 }, serverScripts: {} })],
    ['bad cloud link', JSON.stringify({ format: 'pear-project', v: 1, scene: {}, clientScripts: {}, serverScripts: {}, gameId: 7 })],
  ])('rejects %s', (_n, text) => {
    expect(() => parseProjectFile(text)).toThrow();
  });

  it('file names are safe', () => {
    expect(safeFileName('a/b:c')).toBe('abc.pear.json');
    expect(safeFileName('???')).toBe('project.pear.json');
  });
});

describe('undo and redo', () => {
  it('steps back through scene edits and forward again', () => {
    const p = new Project(templateSnapshot('blank'));
    const first = p.scene.entities as { name: string }[];
    const name = first[0]!.name;
    p.updateEntity(name, (e) => (e.name = 'renamed'));
    expect(p.canUndo).toBe(true);
    p.undo();
    expect((p.scene.entities as { name: string }[])[0]!.name).toBe(name);
    expect(p.canRedo).toBe(true);
    p.redo();
    expect((p.scene.entities as { name: string }[])[0]!.name).toBe('renamed');
  });

  it('loading clears history; delete removes the entity', () => {
    const p = new Project(templateSnapshot('blank'));
    const name = (p.scene.entities as { name: string }[])[0]!.name;
    expect(p.deleteEntity(name)).toBe(true);
    expect(p.deleteEntity(name)).toBe(false);
    p.load(templateSnapshot('blank'));
    expect(p.canUndo).toBe(false);
  });
});

describe('shortcut matching', () => {
  const e = (o: Partial<KeyboardEvent>) => ({ key: 's', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
  it('distinguishes Ctrl+S from Ctrl+Shift+S and plain s', () => {
    const save = { key: 's', ctrl: true, run: () => {} };
    expect(matches(save, e({ ctrlKey: true }))).toBe(true);
    expect(matches(save, e({ metaKey: true }))).toBe(true);
    expect(matches(save, e({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matches(save, e({}))).toBe(false);
  });
});
