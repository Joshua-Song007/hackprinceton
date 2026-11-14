import { parseScene } from '@omni/runtime';
import { describe, expect, it } from 'vitest';
import { eulerToQuat, Project, quatToEuler, templateSnapshot } from '../src/project';

const fresh = () => new Project(templateSnapshot('blank'));
const parses = (p: Project) => expect(() => parseScene(p.scene)).not.toThrow();

describe('authoring', () => {
  it('adds entities with unique names and undoes', () => {
    const p = fresh();
    const a = p.addEntity(null, 'box')!;
    const b = p.addEntity(null, 'box')!;
    expect(b).not.toBe(a);
    expect(b).toMatch(/^Box( 2)?$/);
    const child = p.addEntity(a, 'trigger', [1, 2, 3])!;
    expect(child).toBe(`${a}/Trigger`);
    expect(p.entity(child)!.components).toHaveLength(1);
    expect(p.addEntity('nope', 'box')).toBeNull();
    parses(p);
    p.undo();
    expect(p.entity(child)).toBeUndefined();
    p.redo();
    expect(p.entity(child)).toBeDefined();
  });

  it('duplicates deeply with a unique name', () => {
    const p = fresh();
    const a = p.addEntity(null, 'sphere')!;
    p.addEntity(a, 'box');
    const copy = p.duplicateEntity(a)!;
    expect(copy).not.toBe(a);
    expect(p.entity(`${copy}/Box`)).toBeDefined();
    parses(p);
    p.undo();
    expect(p.entity(copy)).toBeUndefined();
  });

  it('renames keeping ids unique', () => {
    const p = fresh();
    const a = p.addEntity(null, 'box')!;
    const b = p.addEntity(null, 'sphere')!;
    expect(p.renameEntity(b, a)).toHaveProperty('error');
    expect(p.renameEntity(b, 'a/b')).toHaveProperty('error');
    expect(p.renameEntity(b, 'Hero')).toEqual({ id: 'Hero' });
    expect(p.entity('Hero')).toBeDefined();
    p.undo();
    expect(p.entity(b)).toBeDefined();
  });

  it('adds and removes components', () => {
    const p = fresh();
    const a = p.addEntity(null, 'box')!;
    for (const t of ['script', 'trigger', 'audioEmitter'] as const) expect(p.addComponent(a, t)).toBe(true);
    expect(p.entity(a)!.components!.map((c) => c.type)).toEqual(['script', 'trigger', 'audioEmitter']);
    parses(p);
    expect(p.removeComponent(a, 1)).toBe(true);
    expect(p.removeComponent(a, 9)).toBe(false);
    expect(p.entity(a)!.components).toHaveLength(2);
    p.undo();
    expect(p.entity(a)!.components).toHaveLength(3);
  });

  it('validates scene settings', () => {
    const p = fresh();
    expect(p.setSceneSetting('requiredTier', 4)).toBeTruthy();
    expect(p.setSceneSetting('runMode', 'tv')).toBeTruthy();
    expect(p.setSceneSetting('playerOrigin', [1, 2])).toBeTruthy();
    expect(p.setSceneSetting('bogus', 1)).toBeTruthy();
    expect(p.setSceneSetting('requiredTier', 3)).toBeUndefined();
    expect(p.setSceneSetting('runMode', 'device')).toBeUndefined();
    expect(p.setSceneSetting('permissions.location', true)).toBeUndefined();
    expect(p.setSceneSetting('playerOrigin', [0, 1, 2])).toBeUndefined();
    expect(p.setSceneSetting('name', 'Mine')).toBeUndefined();
    const d = parseScene(p.scene);
    expect([d.requiredTier, d.runMode, d.permissions.location, d.name]).toEqual([3, 'device', true, 'Mine']);
    p.undo();
    expect(parseScene(p.scene).name).not.toBe('Mine');
  });

  it('creates and attaches a script as one undo step', () => {
    const p = fresh();
    const a = p.addEntity(null, 'box')!;
    expect(p.createAndAttachScript(a, 'bad name')).toBeTruthy();
    expect(p.createAndAttachScript('nope', 'ok')).toBeTruthy();
    expect(p.createAndAttachScript(a, 'door')).toBeUndefined();
    expect(p.clientScripts.door).toBeDefined();
    expect(parseScene(p.scene).clientScripts).toContain('door');
    expect(p.entity(a)!.components).toContainEqual({ type: 'script', name: 'door' });
    p.undo();
    expect(p.clientScripts.door).toBeUndefined();
    expect(p.entity(a)!.components).toHaveLength(0);
  });

  it('round-trips euler and quaternion', () => {
    for (const e of [[0, 0, 0], [30, 45, 60], [-80, 170, -20], [10, -120, 5]] as [number, number, number][]) {
      const back = quatToEuler(eulerToQuat(e));
      back.forEach((v, i) => expect(v).toBeCloseTo(e[i]!, 6));
    }
    const q = eulerToQuat([20, 30, 40]);
    expect(Math.hypot(...q)).toBeCloseTo(1, 9);
  });
});
