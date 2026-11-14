import { describe, expect, it } from 'vitest';
import { DEFAULT_ORBIT, MAX_DISTANCE, MIN_DISTANCE, frameBox, moveBy, orbitBy, orbitPosition, panBy, zoomBy } from '../src/orbit';

describe('editor camera', () => {
  it('default view sits above and behind the target on +Z', () => {
    const [x, y, z] = orbitPosition(DEFAULT_ORBIT);
    expect(x).toBeCloseTo(0);
    expect(y).toBeGreaterThan(DEFAULT_ORBIT.target[1]);
    expect(z).toBeGreaterThan(0);
  });

  it('orbit keeps the distance and clamps pitch short of the poles', () => {
    const s = orbitBy(DEFAULT_ORBIT, 120, 100000);
    expect(s.pitch).toBeLessThan(Math.PI / 2);
    const p = orbitPosition(s);
    const d = Math.hypot(p[0] - s.target[0], p[1] - s.target[1], p[2] - s.target[2]);
    expect(d).toBeCloseTo(s.distance);
  });

  it('pan moves the target, not the distance, and scales with distance', () => {
    const near = panBy({ ...DEFAULT_ORBIT, distance: 2 }, 100, 0);
    const far = panBy({ ...DEFAULT_ORBIT, distance: 20 }, 100, 0);
    expect(near.distance).toBe(2);
    expect(Math.abs(far.target[0] - DEFAULT_ORBIT.target[0])).toBeCloseTo(10 * Math.abs(near.target[0] - DEFAULT_ORBIT.target[0]));
    expect(near.target[0]).toBeLessThan(DEFAULT_ORBIT.target[0]); // drag right, scene follows right, so the target moves left
  });

  it('zoom is clamped both ways', () => {
    expect(zoomBy(DEFAULT_ORBIT, 1e6).distance).toBe(MAX_DISTANCE);
    expect(zoomBy(DEFAULT_ORBIT, -1e6).distance).toBe(MIN_DISTANCE);
  });

  it('fly forward goes toward the target side, diagonals are not faster, orbit distance is kept', () => {
    const s = { ...DEFAULT_ORBIT, pitch: 0 };
    const fwd = moveBy(s, 1, 0, 0, 2);
    expect(fwd.target[2]).toBeCloseTo(s.target[2] - 2); // yaw 0 looks toward -Z
    const diag = moveBy(s, 1, 1, 0, 2);
    expect(Math.hypot(diag.target[0] - s.target[0], diag.target[2] - s.target[2])).toBeCloseTo(2);
    expect(moveBy(s, 0, 0, 1, 1).target[1]).toBeCloseTo(s.target[1] + 1);
    expect(fwd.distance).toBe(s.distance);
  });

  it('frameBox centers on the box', () => {
    const s = frameBox(DEFAULT_ORBIT, [4, 1, -3], [2, 2, 2]);
    expect(s.target).toEqual([4, 1, -3]);
    expect(s.distance).toBeGreaterThan(2);
  });
});

import { rayPlaneY } from '../src/orbit';
describe('rayPlaneY', () => {
  it('hits the plane ahead, misses behind or parallel', () => {
    expect(rayPlaneY([0, 2, 0], [1, -1, 0], 0)).toEqual([2, 0, 0]);
    expect(rayPlaneY([0, 2, 0], [1, 1, 0], 0)).toBeNull();
    expect(rayPlaneY([0, 2, 0], [1, 0, 0], 0)).toBeNull();
  });
});
