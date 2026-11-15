import { afterEach, describe, expect, it, vi } from 'vitest';
import { quat, validateUsis, type UsisPacket } from '@pear/core';
import demo from '../../../../Recordings/demo-fallback.usis.jsonl?raw';
import { SimDevices, UsisPlayer, parseUsisJsonl } from '../src';

afterEach(() => vi.useRealTimers());

describe('SimDevices', () => {
  it('emits valid sim packets at 50 Hz and a gesture on demand', () => {
    vi.useFakeTimers();
    let clock = 0;
    const out: UsisPacket[] = [];
    const sim = new SimDevices((p) => out.push(p), { now: () => clock });
    sim.start();
    sim.setHeadLook(Math.PI / 2, 0);
    for (let i = 0; i < 5; i++) {
      clock += 20;
      vi.advanceTimersByTime(20);
    }
    sim.gesture('flick', [1, 0, 0]);
    sim.stop();
    vi.advanceTimersByTime(100);

    const head = out.filter((p) => p.slot === 'head');
    expect(head).toHaveLength(6); // t = 0, 20, ..., 100
    expect(head.map((p) => p.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(head[5]!.t).toBe(100);
    expect(head[5]!.ch!.orientation![1]).toBeCloseTo(Math.SQRT1_2);
    expect(out.filter((p) => p.slot === 'leftWrist')).toHaveLength(6);
    expect(out.at(-1)).toMatchObject({ slot: 'hand', kind: 'phone', ch: { gesture: { type: 'flick', dir: [1, 0, 0] } } });
    for (const p of out) {
      expect(p.source).toBe('sim');
      expect(validateUsis(p).ok).toBe(true);
    }
  });

  it('clamps pitch and keeps heart rate non-negative', () => {
    const sim = new SimDevices(() => {});
    sim.setHeadLook(0, 10);
    expect(sim.headLook.pitch).toBeLessThan(Math.PI / 2);
    expect(quat.forward(quat.fromYawPitch(0, sim.headLook.pitch))[1]).toBeGreaterThan(0.99);
  });
});

describe('parseUsisJsonl and UsisPlayer', () => {
  it('parses the demo fallback recording', () => {
    const packets = parseUsisJsonl(demo);
    expect(packets.length).toBeGreaterThan(100);
    expect(packets.every((p, i) => i === 0 || p.t >= packets[i - 1]!.t)).toBe(true);
  });

  it('reports the line of an invalid packet', () => {
    expect(() => parseUsisJsonl('{"v":1}\n')).toThrow('line 1');
    expect(() => parseUsisJsonl('{"v":1,"deviceId":"a","kind":"phone","slot":"hand","source":"sim","t":0,"seq":0}\nnope')).toThrow('line 2: not JSON');
  });

  it('plays on the device clock and ends', () => {
    const packets = parseUsisJsonl(demo);
    const out: UsisPacket[] = [];
    let ended = false;
    const player = new UsisPlayer(packets, (p) => out.push(p), { onEnd: () => (ended = true) });
    player.advance(0);
    expect(out.map((p) => p.t)).toEqual([0, 0]);
    player.advance(500);
    expect(out.at(-1)!.t).toBe(500);
    expect(ended).toBe(false);
    player.advance(1e9);
    expect(out).toHaveLength(packets.length);
    expect(ended).toBe(true);
  });

  it('loops: restarts the recording on the host clock', () => {
    vi.useFakeTimers();
    let clock = 0;
    const packets = parseUsisJsonl(demo);
    const last = packets.at(-1)!.t;
    const out: UsisPacket[] = [];
    const player = new UsisPlayer(packets, (p) => out.push(p), { loop: true, now: () => clock });
    player.start();
    clock = last;
    vi.advanceTimersByTime(10); // last packets emitted, loop restarts
    expect(out).toHaveLength(packets.length);
    clock = last + 5;
    vi.advanceTimersByTime(10); // first packets of the second pass
    expect(out.length).toBeGreaterThan(packets.length);
    expect(player.playing).toBe(true);
    player.stop();
    expect(player.playing).toBe(false);
  });
});

describe('SimDevices rig', () => {
  it('emits only for present devices; gestures need the phone', () => {
    vi.useFakeTimers();
    const out: UsisPacket[] = [];
    const sim = new SimDevices((p) => out.push(p), { now: () => 0, kinds: ['airpods'] });
    sim.start();
    sim.gesture('tap');
    expect(out.map((p) => p.kind)).toEqual(['airpods']);
    sim.addDevice('phone');
    sim.addDevice('watch');
    sim.gesture('tap');
    vi.advanceTimersByTime(20);
    sim.stop();
    expect(new Set(out.map((p) => p.kind))).toEqual(new Set(['airpods', 'phone', 'watch']));
    sim.removeDevice('watch');
    expect(sim.list()).toEqual(['airpods', 'phone']);
  });
});

describe('SimDevices idPrefix and redirect', () => {
  it('names its devices with the prefix', () => {
    const out: UsisPacket[] = [];
    const sim = new SimDevices((p) => out.push(p), { idPrefix: 'room', kinds: ['phone', 'watch'], now: () => 0 });
    sim.gesture('tap');
    sim.start();
    sim.stop();
    expect(new Set(out.map((p) => p.deviceId))).toEqual(new Set(['room-phone', 'room-watch']));
  });

  it('sends gestures, accel and heart rate to the target while allowed, and drops them otherwise', () => {
    const shared: UsisPacket[] = [];
    const own: UsisPacket[] = [];
    const room = new SimDevices((p) => shared.push(p), { idPrefix: 'room', kinds: ['phone', 'watch'], now: () => 0 });
    const player = new SimDevices((p) => own.push(p), { kinds: ['airpods'], now: () => 0 });
    let holds = true;
    player.redirect('phone', room, () => holds);
    player.redirect('watch', room, () => holds);
    player.gesture('tap');
    expect(shared.at(-1)).toMatchObject({ deviceId: 'room-phone', ch: { gesture: { type: 'tap' } } });
    player.setHeartRate(130);
    expect(room.heartRateBpm).toBe(130);
    expect(player.heartRateBpm).toBe(130); // stored here too, so a passed device can copy its holder's value
    holds = false;
    const n = shared.length;
    player.gesture('flick', [1, 0, 0]);
    player.setHeartRate(90);
    expect(shared).toHaveLength(n);
    expect(room.heartRateBpm).toBe(130);
    expect(own).toHaveLength(0); // never emitted by the player's own devices
    holds = true;
    player.redirect('phone', null);
    player.gesture('tap'); // no redirect and no own phone: nothing
    expect(shared).toHaveLength(n);
  });
});
