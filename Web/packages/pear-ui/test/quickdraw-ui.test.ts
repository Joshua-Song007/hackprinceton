import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyState, evalExpr, interpolate, pickScreen, reduceFrame, truthy, validate, type Node, type PearUI, type ViewState } from '../src';

const ui = JSON.parse(readFileSync(new URL('../../../../Games/QuickDraw/ui.json', import.meta.url), 'utf8')) as PearUI;

/** jsdom-free "render": the visible text lines, button labels and effect/sensor nodes of a screen for a view state. */
function visible(n: Node, scope: ViewState, out: { text: string[]; buttons: string[]; invisible: string[] }) {
  if (n.if !== undefined && !truthy(evalExpr(scope, n.if))) return out;
  if (n.type === 'text') out.text.push(String(interpolate(scope, n.value)));
  else if (n.type === 'button') out.buttons.push(String(interpolate(scope, n.label)));
  else if (n.type === 'sensor' || n.type === 'effect') out.invisible.push(`${n.type}:${n.event ?? n.haptic}`);
  else if (n.type === 'list') {
    const items = interpolate(scope, `{{${n.items}}}`);
    if (Array.isArray(items)) for (const it of items) visible(n.item!, { ...scope, item: it }, out);
  }
  n.children?.forEach((c) => visible(c, scope, out));
  return out;
}

const players = [
  { id: 'a', name: 'Ada', ready: true, role: 'phone', raised: false, idleKickAt: null, score: 1, queuePos: 0, lastWin: 3 },
  { id: 'b', name: 'Bo', ready: false, role: 'phone', raised: true, idleKickAt: null, score: 0, queuePos: 0, lastWin: 0 },
  { id: 'c', name: 'Cy', ready: false, role: 'queued', raised: false, idleKickAt: null, score: 0, queuePos: 1, lastWin: 0 },
];
function at(kind: 'phone' | 'ipad' | 'watch', who: string, frames: Array<[string, unknown]>): ViewState {
  let s = reduceFrame(emptyState(kind), { name: '_welcome', data: { id: who, name: who, lobby: 'ABCD' } });
  for (const [name, data] of frames) s = reduceFrame(s, { name, data });
  return s;
}
const state = (phase: string, extra = {}) => ['state', { phase, round: 4, matchRound: 2, phones: ['a', 'b'], needs: 'draw!', ...extra }] as [string, unknown];
const view = (extra = {}) => ['view', { players, queueNames: 'Cy', countdownEndsAt: Date.now() + 3000, last: null, match: null, ...extra }] as [string, unknown];
const last = { matchRound: 2, reason: 'fast', winnerId: 'a', winnerName: 'Ada', loserName: 'Bo', results: [
  { id: 'a', name: 'Ada', msText: '180 ms', won: true, tag: '', bar: 0.7 }, { id: 'b', name: 'Bo', msText: '260 ms', won: false, tag: '', bar: 1 }] };
const screenOf = (s: ViewState) => visible(ui.screens[pickScreen(ui, s)!], s, { text: [], buttons: [], invisible: [] });

describe('Quick Draw ui.json', () => {
  it('validates and routes ipad to referee, anything else to gun', () => {
    expect(validate(ui)).toEqual([]);
    expect(pickScreen(ui, at('ipad', 'r', []))).toBe('referee');
    expect(pickScreen(ui, at('phone', 'a', []))).toBe('gun');
    expect(pickScreen(ui, at('watch', 'a', []))).toBe('gun');
  });

  it('gun: lobby shows code, rows, needs, queue place and a Ready button; streams aim at 20 Hz', () => {
    const out = screenOf(at('phone', 'a', [state('lobby'), view()]));
    expect(out.text).toContain('ABCD');
    expect(out.text).toContain('Ada (You)');
    expect(out.text).toContain('Bo');
    expect(out.text).toContain('draw!');
    expect(out.invisible).toContain('sensor:aim');
    expect(out.buttons).toEqual([]); // Ada is already ready
    expect(out.text).toContain('Waiting for the other player');
    expect(screenOf(at('phone', 'b', [state('lobby'), view()])).buttons).toEqual(['Ready']);
    expect(screenOf(at('phone', 'c', [state('lobby'), view()])).text).toContain('A match is on. You are number 1 in line.');
    expect(JSON.stringify(ui)).toContain('"hz":20');
  });

  it('gun: fire shows DRAW, round over headlines per viewer, match over', () => {
    expect(screenOf(at('phone', 'a', [state('fire'), view()])).text).toContain('DRAW!');
    const ro = (who: string) => screenOf(at('phone', who, [state('roundOver'), view({ last })]));
    expect(ro('a').text).toContain('You win the round');
    expect(ro('b').text).toContain('Ada wins the round');
    expect(ro('b').text).toContain('Lower your phone for the next round');
    expect(ro('a').text).toContain('Waiting for the other phone to lower');
    expect(ro('a').text).toContain('180 ms');
    const foul = { ...last, reason: 'foul' };
    expect(screenOf(at('phone', 'b', [state('roundOver'), view({ last: foul })])).text).toContain('Foul: you moved early');
    const mo = screenOf(at('phone', 'a', [state('matchOver'), ['matchOver', { winnerId: 'a' }], view({ match: { winnerName: 'Ada', scoreText: '2 - 0' } })]));
    expect(mo.text).toContain('YOU WON THE MATCH');
    expect(mo.buttons).toEqual([]);
  });

  it('referee: lobby, countdown, round over bars, match over', () => {
    const lobby = screenOf(at('ipad', 'r', [state('lobby', { phones: ['a'] }), view({ players: players.slice(0, 1) })]));
    expect(lobby.text).toContain('Waiting for a phone...');
    expect(lobby.text).toContain('Next up: Cy');
    expect(screenOf(at('ipad', 'r', [state('countdown'), view()])).text).toContain('Round 2: phones down at your sides');
    expect(screenOf(at('ipad', 'r', [state('fire'), view()])).text).toContain('DRAW!');
    const ro = screenOf(at('ipad', 'r', [state('roundOver'), view({ last: { ...last, reason: 'foul', winnerId: 'a' } })]));
    expect(ro.text).toContain('Bo moved early! Ada wins the round');
    expect(ro.text).toContain('Waiting for Bo to lower');
    const mo = screenOf(at('ipad', 'r', [state('matchOver'), view({ match: { winnerName: 'Ada', scoreText: '2 - 0' } })]));
    expect(mo.text).toContain('Ada wins the match!');
    expect(mo.text).toContain('2 - 0');
  });

  it('effects: heavy haptic on fire, success haptic on a won round', () => {
    const out = screenOf(at('phone', 'a', [state('lobby'), view()]));
    expect(out.invisible).toEqual(expect.arrayContaining(['effect:heavy', 'effect:success']));
    const s = at('phone', 'a', [['fire', { round: 5 }]]);
    expect(evalExpr(s, 'ev.fire.round')).toBe(5);
  });
});
