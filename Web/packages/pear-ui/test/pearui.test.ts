import { describe, expect, it } from 'vitest';
import { emptyState, evalExpr, interpolate, pickScreen, reduceFrame, validate, type PearUI } from '../src';

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
