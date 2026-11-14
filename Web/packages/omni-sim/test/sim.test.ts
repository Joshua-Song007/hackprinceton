import { afterEach, describe, expect, it, vi } from 'vitest';
import { quat, validateUsis, type UsisPacket } from '@omni/core';
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
