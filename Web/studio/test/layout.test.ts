import { describe, expect, it } from 'vitest';
import { LayoutManager, isLegacyDefault, panelsToOffer, wants3D } from '../src/layout';

const added = [{ id: 'peripherals', beside: 'explorer' }];

describe('panelsToOffer', () => {
  it('offers an added panel a saved layout lacks, once', () => {
    expect(panelsToOffer(['explorer', 'viewport'], [], ['explorer', 'peripherals'], added)).toEqual(added);
    expect(panelsToOffer(['explorer', 'viewport'], ['peripherals'], ['explorer', 'peripherals'], added)).toEqual([]);
  });
  it('does nothing when the panel is already open', () => {
    expect(panelsToOffer(['explorer', 'peripherals'], [], ['explorer', 'peripherals'], added)).toEqual([]);
  });
  it('needs the panel to be registered and its neighbour to be open', () => {
    expect(panelsToOffer(['explorer'], [], ['explorer'], added)).toEqual([]);
    expect(panelsToOffer(['viewport'], [], ['explorer', 'peripherals'], added)).toEqual([]);
  });
  it('the real list offers Peripherals beside the Explorer', () => {
    expect(panelsToOffer(['explorer'], [], ['explorer', 'peripherals'])).toEqual(added);
  });
});

describe('non-3D default', () => {
  const ent = (scale: number[], children: never[] = []) => ({ scale, children });
  it('recognises only the exact old default panel set', () => {
    expect(isLegacyDefault(['viewport', 'editor', 'explorer', 'peripherals', 'test', 'inspector', 'console'])).toBe(true);
    expect(isLegacyDefault(['viewport', 'editor', 'explorer', 'peripherals', 'test', 'inspector', 'console', 'livePreview'])).toBe(false);
    expect(isLegacyDefault(['editor', 'explorer'])).toBe(false);
  });
  it('opens the viewport only for screen scenes with a visible entity', () => {
    expect(wants3D({ runMode: 'screen', entities: [ent([1, 1, 1])] })).toBe(true);
    expect(wants3D({ runMode: 'screen', entities: [ent([0, 0, 0])] })).toBe(false);
    expect(wants3D({ runMode: 'screen', entities: [] })).toBe(false);
    expect(wants3D({ runMode: 'device', entities: [ent([1, 1, 1])] })).toBe(false);
  });
});

describe('saved workspace recovery', () => {
  const workspace = () => {
    const current = { panels: { editor: { contentComponent: 'editor' } } };
    let state = current;
    const storage = new Map<string, string>();
    const manager = Object.assign(Object.create(LayoutManager.prototype), {
      specs: new Map([['editor', {}], ['explorer', {}], ['inspector', {}]]),
      collapsed: new Map(),
      storage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
      api: {
        toJSON: () => state,
        fromJSON: (data: typeof current & { broken?: boolean }) => {
          state = data;
          if (data.broken) throw new Error('Invalid grid');
        },
      },
    });
    return { manager: manager as LayoutManager, storage, current, state: () => state };
  };
  it('restores an intentionally editor-only layout', () => {
    const w = workspace();
    w.storage.set('pear.studio.layouts', JSON.stringify({ Writing: w.current }));
    expect(w.manager.loadNamed('Writing')).toBe(true);
  });
  it('rolls back a malformed named layout without losing the current workspace', () => {
    const w = workspace();
    w.storage.set('pear.studio.layouts', JSON.stringify({ Broken: { ...w.current, broken: true } }));
    expect(w.manager.loadNamed('Broken')).toBe(false);
    expect(w.state()).toEqual(w.current);
  });
  it('treats non-object named-layout storage as empty', () => {
    const w = workspace();
    for (const invalid of ['null', '[]', '42']) {
      w.storage.set('pear.studio.layouts', invalid);
      expect(w.manager.namedLayouts()).toEqual([]);
    }
  });
});
