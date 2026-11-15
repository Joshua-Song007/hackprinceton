import { describe, expect, it } from 'vitest';
import { entityScripts, usedBy, usedByText } from '../src/explorerText';

describe('entityScripts', () => {
  it('names the script file, keeps other component types, and says "script" for an unnamed one', () => {
    expect(entityScripts([{ type: 'script', name: 'tap' }])).toBe('tap.js');
    expect(entityScripts([{ type: 'script', name: 'tap' }, { type: 'trigger' }, { type: 'script', name: 'doubleTap' }])).toBe('tap.js, trigger, doubleTap.js');
    expect(entityScripts([{ type: 'script', name: '' }])).toBe('script');
    expect(entityScripts([{ type: 'audioEmitter' }])).toBe('audioEmitter');
    expect(entityScripts([])).toBe('');
    expect(entityScripts(undefined)).toBe('');
  });
});

describe('usedBy', () => {
  const holder = (name: string, script: string, children: unknown[] = []) => ({ name, components: [{ type: 'script', name: script }], children });
  const scene = { entities: [holder('iPhone', 'tap'), { name: 'Floor' }, holder('iPhone 2', 'tap', [holder('Child', 'tap'), holder('Other', 'doubleTap')])] };

  it('lists the objects holding a script, children included, in scene order', () => {
    expect(usedBy(scene, 'tap')).toEqual(['iPhone', 'iPhone 2', 'Child']);
    expect(usedBy(scene, 'doubleTap')).toEqual(['Other']);
  });

  it('is empty for a script nothing uses, and for a scene with no entities', () => {
    expect(usedBy(scene, 'unused')).toEqual([]);
    expect(usedBy({}, 'tap')).toEqual([]);
  });
});

describe('usedByText', () => {
  it('says nothing for none, lists up to two, and counts the rest', () => {
    expect(usedByText([])).toBe('');
    expect(usedByText(['iPhone'])).toBe('used by iPhone');
    expect(usedByText(['iPhone', 'iPhone 2'])).toBe('used by iPhone, iPhone 2');
    expect(usedByText(['A', 'B', 'C'])).toBe('used by A, B +1');
    expect(usedByText(['A', 'B', 'C', 'D', 'E'])).toBe('used by A, B +3');
  });
});
