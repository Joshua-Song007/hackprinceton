import { describe, expect, it } from 'vitest';
import { MAP_SIZE, hapticRecent, mapHalfExtent, mapToWorld, worldToMap } from '../src/testPanel';

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
