import { describe, expect, it } from 'vitest';
import type { SceneInputs } from '@pear/runtime';
import { describeInputs, inferInputs, missingInputs, rigFor } from '../src/needs';
import { gameSnapshot } from './games';

const none: SceneInputs = { head: false, position: false, heartRate: false, gestures: [], players: [1, 32] };

describe('inferInputs', () => {
  it('reads the Quick Draw scripts', () => {
    const i = inferInputs(gameSnapshot('QuickDraw').clientScripts);
    expect(i.gestures).toEqual(expect.arrayContaining(['tap']));
    expect(i.players).toEqual([1, 32]);
  });
  it('reads head, position, heart rate and gestures from the script source', () => {
    const i = inferInputs({ s: 'export default script({ onLookAt() {}, onHeartRate() {}, onTick(self, ctx) { ctx.position; }, onGesture(self, ctx, g) { if (g.type === "flick") {} } });' });
    expect(i).toMatchObject({ head: true, position: true, heartRate: true, gestures: ['flick'] });
  });
  it('finds nothing in empty scripts', () => {
    expect(inferInputs({})).toEqual(none);
  });
});

describe('rigFor', () => {
  it('maps inputs to devices', () => {
    expect(rigFor(none)).toEqual([]);
    expect(rigFor({ ...none, position: true })).toEqual(['phone']); // position = phone GPS; AirPods have none
    expect(rigFor({ ...none, head: true, heartRate: true, gestures: ['tap'] })).toEqual(['airpods', 'phone', 'watch']);
  });
});

describe('missingInputs', () => {
  it('is null when everything used is declared', () => {
    expect(missingInputs({ ...none, head: true }, { ...none, head: true })).toBeNull();
  });
  it('names and merges what is missing', () => {
    const r = missingInputs({ ...none, gestures: ['tap'], players: [2, 4] }, { ...none, head: true, heartRate: true, gestures: ['tap', 'flick'] })!;
    expect(r.names).toEqual(['head', 'heart rate', 'flick']);
    expect(r.merged).toEqual({ head: true, position: false, heartRate: true, gestures: ['tap', 'flick'], players: [2, 4] });
  });
});

describe('describeInputs', () => {
  it('writes one line', () => {
    expect(describeInputs({ ...none, head: true, gestures: ['doubleTap'], players: [2, 32] })).toBe('head, double tap; 2 to 32 players');
    expect(describeInputs({ ...none, players: [1, 1] })).toBe('no input; 1 player');
    expect(describeInputs({ ...none, players: [3, 3] })).toBe('no input; 3 players');
  });
});
