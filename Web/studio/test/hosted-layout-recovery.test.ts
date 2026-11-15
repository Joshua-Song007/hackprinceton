import { describe, expect, it, vi } from 'vitest';
import { LayoutManager } from '../src/layout';

function workspace() {
  const initial = { panels: { editor: { contentComponent: 'editor' } } };
  let state = initial;
  const values = new Map<string, string>();
  const editor = { id: 'editor', api: { setActive: vi.fn(), close: vi.fn() } };
  const api = {
    toJSON: () => state,
    fromJSON: vi.fn((data: typeof initial & { broken?: boolean }) => { state = data; if (data.broken) throw new Error('Invalid grid'); }),
    getPanel: vi.fn((id: string) => id === 'editor' ? editor : undefined),
  };
  const manager: LayoutManager = Object.assign(Object.create(LayoutManager.prototype), {
    specs: new Map(['editor', 'explorer', 'inspector', 'livePreview'].map((id) => [id, {}])),
    collapsed: new Map(),
    storage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } },
    api,
  });
  return { manager, api, editor, initial, values, state: () => state };
}

describe('hosted layout saved-state recovery', () => {
  it('rejects unknown serialized plugins without replacing the current workspace', () => {
    const w = workspace();
    w.values.set('pear.studio.layouts', JSON.stringify({ Old: { panels: { plugin: { contentComponent: 'removed-plugin' } } } }));
    expect(w.manager.loadNamed('Old')).toBe(false);
    expect(w.api.fromJSON).not.toHaveBeenCalled();
    expect(w.state()).toEqual(w.initial);
  });

  it('rejects malformed or empty current storage and resets to default', () => {
    for (const saved of ['{', 'null', JSON.stringify({ panels: {} }), JSON.stringify({ panels: { old: { contentComponent: 'removed-plugin' } } })]) {
      const w = workspace();
      w.values.set('pear.studio.layout.current', saved);
      const reset = vi.spyOn(w.manager, 'applyPreset').mockImplementation(() => {});
      w.manager.start();
      expect(reset).toHaveBeenCalledWith('default');
    }
  });

  it('preserves an intentional single-panel named layout and rolls back a broken grid', () => {
    const w = workspace();
    w.values.set('pear.studio.layouts', JSON.stringify({ Single: w.initial, Broken: { ...w.initial, broken: true } }));
    expect(w.manager.loadNamed('Single')).toBe(true);
    expect(w.manager.loadNamed('Broken')).toBe(false);
    expect(w.state()).toEqual(w.initial);
  });

  it('activates an existing inactive editor tab instead of toggling it closed', () => {
    const w = workspace();
    w.manager.show('editor');
    expect(w.editor.api.setActive).toHaveBeenCalledOnce();
    expect(w.editor.api.close).not.toHaveBeenCalled();
  });

  it('reopens a closed editor before activating it', () => {
    const w = workspace();
    w.api.getPanel.mockReturnValueOnce(undefined);
    const toggle = vi.spyOn(w.manager, 'togglePanel').mockImplementation(() => {});
    w.manager.show('editor');
    expect(toggle).toHaveBeenCalledWith('editor');
    expect(w.editor.api.setActive).toHaveBeenCalledOnce();
  });
});
