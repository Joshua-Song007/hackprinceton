import { describe, expect, it } from 'vitest';
import { GAZE_LENGTH, rigKey, rigLayout, type AvatarView, type RigView } from '../src/rig';

const near = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5));

describe('rigLayout', () => {
  it('at yaw 0 the player faces -Z, the right hand is +X, the feet are on the ground below the head', () => {
    const l = rigLayout({ position: [1, 1.6, 2], yaw: 0, pitch: 0 });
    near(l.forward, [0, 0, -1]);
    near(l.gazeTip, [1, 1.6, 2 - GAZE_LENGTH]);
    near(l.feet, [1, 0, 2]);
    expect(l.rightEar[0]).toBeGreaterThan(l.leftEar[0]);
    expect(l.hand[0]).toBeGreaterThan(l.head[0]);
    expect(l.leftWrist[0]).toBeLessThan(l.head[0]);
    expect(l.hand[2]).toBeLessThan(2); // held in front
    expect(l.hand[1]).toBeLessThan(1.6);
  });

  it('turning left 90 degrees faces -X and swings the hand with it', () => {
    const l = rigLayout({ position: [0, 1.6, 0], yaw: Math.PI / 2, pitch: 0 });
    near(l.forward, [-1, 0, 0]);
    expect(l.hand[0]).toBeLessThan(0); // in front
    expect(l.hand[2]).toBeLessThan(0); // facing -X, the right hand side is -Z (the same right D walks to)
  });

  it('pitch tilts the gaze but leaves the body where it is', () => {
    const flat = rigLayout({ position: [0, 1.6, 0], yaw: 0, pitch: 0 });
    const up = rigLayout({ position: [0, 1.6, 0], yaw: 0, pitch: Math.PI / 4 });
    expect(up.gazeTip[1]).toBeGreaterThan(flat.gazeTip[1]);
    near(up.hand, flat.hand);
    near(up.leftWrist, flat.leftWrist);
    expect(Math.hypot(...up.forward)).toBeCloseTo(1, 5);
  });
});

describe('rigKey', () => {
  const avatar = (over: Partial<AvatarView> = {}): AvatarView => ({
    id: 'player-1', position: [0, 1.6, 0], yaw: 0, pitch: 0, driven: true, devices: [{ kind: 'phone', shared: false }], hapticAt: 0, ...over,
  });
  const view = (a: AvatarView): RigView => ({ avatars: [a], free: [] });

  it('is empty without a view and stable for the same picture', () => {
    expect(rigKey(null, 0)).toBe('');
    expect(rigKey(view(avatar()), 1000)).toBe(rigKey(view(avatar()), 5000));
  });

  it('changes when a player moves a few centimeters, turns, changes devices or becomes the driven one', () => {
    const base = rigKey(view(avatar()), 0);
    expect(rigKey(view(avatar({ position: [0.02, 1.6, 0] })), 0)).not.toBe(base);
    expect(rigKey(view(avatar({ yaw: 0.1 })), 0)).not.toBe(base);
    expect(rigKey(view(avatar({ devices: [{ kind: 'phone', shared: true }] })), 0)).not.toBe(base);
    expect(rigKey(view(avatar({ driven: false })), 0)).not.toBe(base);
    expect(rigKey(view(avatar()), 0)).toBe(base);
  });

  it('a free device moving changes it, and a haptic pulse changes it as it ages then settles', () => {
    expect(rigKey({ avatars: [], free: [{ kind: 'phone', at: [0, 1, -2] }] }, 0)).not.toBe(rigKey({ avatars: [], free: [{ kind: 'phone', at: [1, 1, -2] }] }, 0));
    const buzzed = avatar({ hapticAt: 1000 });
    const idle = rigKey(view(avatar()), 1000);
    expect(rigKey(view(buzzed), 1000)).not.toBe(idle);
    expect(rigKey(view(buzzed), 1000)).not.toBe(rigKey(view(buzzed), 1100));
    expect(rigKey(view(buzzed), 1500)).toBe(idle); // after 400 ms the ring is gone
  });
});
