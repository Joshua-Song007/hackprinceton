import { describe, expect, it } from 'vitest';
import { MAP_SIZE, hapticRecent, holdingText, mapHalfExtent, mapToWorld, worldToMap } from '../src/testPanel';
import { HEART_PRESETS, deviceMenuItems } from '../src/deviceMenu';

describe('test panel map', () => {
  it('covers at least 8 m and grows to fit points plus 2 m', () => {
    expect(mapHalfExtent([])).toBe(8);
    expect(mapHalfExtent([{ x: 3, z: -4 }])).toBe(8);
    expect(mapHalfExtent([{ x: Infinity, z: 0 }, { x: NaN, z: 1 }, { x: 9, z: 0 }])).toBe(11);
    expect(mapHalfExtent([{ x: 3, z: -20 }])).toBe(22);
  });
  it('puts the origin at the center, +X right and -Z up', () => {
    expect(worldToMap(0, 0, 8)).toEqual([MAP_SIZE / 2, MAP_SIZE / 2]);
    const [x, y] = worldToMap(4, -4, 8);
    expect(x).toBeGreaterThan(MAP_SIZE / 2);
    expect(y).toBeLessThan(MAP_SIZE / 2);
  });
  it('round-trips world and screen', () => {
    const [px, py] = worldToMap(1.5, -3, 10);
    const [x, z] = mapToWorld(px, py, 10);
    expect(x).toBeCloseTo(1.5);
    expect(z).toBeCloseTo(-3);
  });
  it('flags a haptic under 400 ms old', () => {
    expect(hapticRecent(1000, 1399)).toBe(true);
    expect(hapticRecent(1000, 1400)).toBe(false);
    expect(hapticRecent(0, 5000)).toBe(false);
  });
});

describe('device holding text', () => {
  it('says who has the device in each mode', () => {
    expect(holdingText('player', null)).toBe('Each player has their own');
    expect(holdingText('free', null)).toBe('In the room');
    expect(holdingText('passed', 'Ada')).toBe('Held by Ada');
    expect(holdingText('passed', null)).toBe('Held by nobody');
  });
});

describe('deviceMenuItems', () => {
  const noop = { gesture: () => {}, heartRate: () => {}, give: () => {} };
  const players = [{ id: 'player-1', name: 'Ada' }, { id: 'player-2', name: 'Bo' }];
  const labels = (items: { label?: string; separator?: boolean }[]) => items.filter((i) => !i.separator).map((i) => i.label);
  const inputs = { head: false, position: false, heartRate: false, gestures: ['tap', 'flick'] as ('tap' | 'flick')[], players: [1, 32] as const };

  it('a phone offers the gestures the game declares, all of them when it declares none', () => {
    expect(labels(deviceMenuItems('phone', inputs, players, null, noop))).toEqual(['iPhone', 'Tap', 'Flick']);
    expect(labels(deviceMenuItems('phone', null, players, null, noop))).toEqual(['iPhone', 'Tap', 'Double tap', 'Flick', 'Squeeze', 'Pinch']);
    expect(labels(deviceMenuItems('phone', { ...inputs, gestures: [] }, players, null, noop))).toEqual(['iPhone', 'The game uses no gestures']);
  });
  it('a watch offers the heart-rate presets and runs them', () => {
    const got: number[] = [];
    const items = deviceMenuItems('watch', null, players, null, { ...noop, heartRate: (b) => got.push(b) });
    expect(labels(items)).toEqual(['Apple Watch', ...HEART_PRESETS.map(([n, b]) => `${n} (${b} bpm)`)]);
    items.at(-1)!.run!();
    expect(got).toEqual([180]);
  });
  it('a passed device adds Give to for every other player, and a device nobody holds does not', () => {
    const given: string[] = [];
    const items = deviceMenuItems('phone', inputs, players, 'player-1', { ...noop, give: (id) => given.push(id) });
    expect(labels(items).slice(-2)).toEqual(['Give to', 'Bo']);
    items.at(-1)!.run!();
    expect(given).toEqual(['player-2']);
    expect(labels(deviceMenuItems('phone', inputs, players, null, noop))).not.toContain('Give to');
    expect(labels(deviceMenuItems('phone', inputs, [players[0]!], 'player-1', noop))).not.toContain('Give to');
  });
});
