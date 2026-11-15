import { describe, expect, it } from 'vitest';
import { emptyState, evalExpr, FILL, interpolate, mount, pickScreen, reduceFrame, screenFill, validate, type PearUI } from '../src';

const s = reduceFrame(reduceFrame(emptyState('ipad'), { name: '_welcome', data: { id: 'p1', name: 'Ada' } }), {
  name: 'state', data: { phase: 'fire', round: 2, scores: { p1: 3 } },
});

describe('expr', () => {
  it('paths, equality, negation, fallback', () => {
    expect(evalExpr(s, 'ev.state.phase')).toBe('fire');
    expect(evalExpr(s, "ev.state.phase == 'fire'")).toBe(true);
    expect(evalExpr(s, 'ev.state.round == 2')).toBe(true);
    expect(evalExpr(s, 'ev.state.round != 2')).toBe(false);
    expect(evalExpr(s, '!ev.missing')).toBe(true);
    expect(evalExpr(s, "ev.missing || 'none'")).toBe('none');
    expect(evalExpr(s, "device.kind == 'ipad'")).toBe(true);
  });
  it('.length on arrays and strings', () => {
    const t = { ev: { q: [1, 2, 3], n: 'abcd', none: [] } };
    expect(evalExpr(t, 'ev.q.length')).toBe(3);
    expect(evalExpr(t, 'ev.n.length')).toBe(4);
    expect(evalExpr(t, 'ev.none.length')).toBe(0);
    expect(evalExpr(t, 'ev.q.length == 3')).toBe(true);
    expect(evalExpr(t, 'ev.missing.length')).toBeUndefined();
  });
  it('interpolates strings and keeps whole-expression types', () => {
    expect(interpolate(s, 'Round {{ev.state.round}} — {{me.name}}')).toBe('Round 2 — Ada');
    expect(interpolate(s, '{{ev.state.scores}}')).toEqual({ p1: 3 });
    expect(interpolate(s, { who: '{{me.id}}' })).toEqual({ who: 'p1' });
  });
});

describe('route + validate', () => {
  const ui: PearUI = {
    pearui: 1,
    route: [{ when: "device.kind == 'ipad'", screen: 'ref' }, { screen: 'gun' }],
    screens: { ref: { type: 'text', value: 'ref' }, gun: { type: 'button', label: 'Ready', action: { send: 'ready' } } },
  };
  it('picks the first matching route', () => {
    expect(pickScreen(ui, s)).toBe('ref');
    expect(pickScreen(ui, { ...s, device: { kind: 'phone' } })).toBe('gun');
  });
  it('accepts valid and reports broken ui', () => {
    expect(validate(ui)).toEqual([]);
    expect(validate({ pearui: 1, route: [{ when: 'x', screen: 'nope' }], screens: {} }).length).toBe(2);
  });
});

describe('&& expressions', () => {
  it('binds tighter than || and yields its last term', () => {
    expect(evalExpr(s, "ev.state.phase == 'fire' && me.id == 'p1'")).toBe(true);
    expect(evalExpr(s, "ev.state.phase == 'fire' && ev.missing")).toBeUndefined();
    expect(evalExpr(s, "ev.state.phase == 'lobby' && 'x' || ev.state.phase == 'fire' && 'bad'")).toBe('bad');
  });
});

/** Minimal element tree for `mount` (tests run without a DOM). */
function fakeEl(): any {
  const doc: any = { head: null };
  doc.createElement = (tag: string) => {
    const e: any = {
      tagName: tag, className: '', style: {}, dataset: {}, children: [], textContent: '', ownerDocument: doc,
      appendChild(c: any) { e.children.push(c); return c; }, replaceChildren() { e.children = []; }, remove() {}, addEventListener() {},
      classList: { add(c: string) { e.className += ` ${c}`; } },
    };
    return e;
  };
  return doc.createElement('div');
}

describe('list direction + screen fill', () => {
  const ui: PearUI = {
    pearui: 1,
    route: [{ screen: 'main' }],
    screens: { main: { type: 'column', style: { fill: "{{ev.state.phase == 'fire' && 'bad' || 'neutral'}}" }, children: [
      { type: 'list', items: 'ev.items', direction: 'row', item: { type: 'text', value: '{{item}}' } },
    ] } },
  };
  it('row list lays items side by side', () => {
    const el = fakeEl();
    mount(el, ui, { ...s, ev: { ...s.ev, items: ['a', 'b'] } }, () => {});
    const list = el.children[0].children[0].children[0];
    expect(list.className).toContain('pui-list-row');
    expect(list.children.length).toBe(2);
  });
  it('fill colors the whole screen from an expression', () => {
    expect(screenFill(ui.screens.main, s)).toBe(FILL.bad);
    const el = fakeEl();
    const m = mount(el, ui, s, () => {});
    expect(el.children[0].style.background).toBe(FILL.bad);
    m.update(reduceFrame(s, { name: 'state', data: { phase: 'lobby' } }));
    expect(el.children[0].style.background).toBe(FILL.neutral);
  });
});
