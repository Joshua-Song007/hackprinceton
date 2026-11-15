import { describe, expect, it, vi } from 'vitest';
import { parseScene } from '@pear/runtime';
import { SimDevices } from '@pear/sim';
import type { UsisPacket } from '@pear/core';
import type { ScriptSandbox } from '@pear/script';
import { LocalRun, createPlayServer, joinPlay, roomKinds, routeTargets, stepPosition, stepToward } from '../src/run';

describe('stepPosition', () => {
  it('W walks along -Z at 1.5 m/s and keeps y', () => {
    const p = stepPosition([0, 1.6, 0], 0, new Set(['KeyW']), 1);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBe(1.6);
    expect(p[2]).toBeCloseTo(-1.5);
  });
  it('forward follows yaw (90 deg left = -X) and D is right', () => {
    expect(stepPosition([0, 0, 0], Math.PI / 2, new Set(['KeyW']), 1)[0]).toBeCloseTo(-1.5);
    expect(stepPosition([0, 0, 0], 0, new Set(['KeyD']), 1)[0]).toBeCloseTo(1.5);
  });
  it('diagonals are not faster and no keys stand still', () => {
    const p = stepPosition([0, 0, 0], 0, new Set(['KeyW', 'KeyD']), 1);
    expect(Math.hypot(p[0], p[2])).toBeCloseTo(1.5);
    expect(stepPosition([1, 2, 3], 0.3, new Set(), 1)).toEqual([1, 2, 3]);
  });
});

describe('Play wiring', () => {
  it('server fireAll reaches every client, a client remote reaches the server with its player id', () => {
    const got: Record<string, [string, unknown][]> = { a: [], b: [] };
    const clients = new Map();
    const client = (id: string) => ({ deliverRemote: async (n: string, d: unknown) => void got[id]!.push([n, d]) });
    const server = createPlayServer(clients, {});
    server.load([`export default serverScript({
      onRemote(ctx, player, name, data) { if (name === 'punch') ctx.remote.fireAll('hit', { from: player.id }); },
      onPlayerJoin(ctx, player) { ctx.remote.fire(player.id, 'hello', null); },
    });`]);
    joinPlay(server, clients, 'a', 'A', client('a'));
    joinPlay(server, clients, 'b', 'B', client('b'));
    expect(got.a![0]).toEqual(['_welcome', { id: 'a', name: 'A' }]);
    expect(got.a!.filter(([n]) => n === 'hello')).toHaveLength(1);
    server.remote('b', 'punch', {});
    expect(got.a!.at(-1)).toEqual(['hit', { from: 'b' }]);
    expect(got.b!.at(-1)).toEqual(['hit', { from: 'b' }]);
  });
});

import { rigWarning } from '../src/run';
describe('rigWarning', () => {
  it('flags a tier the rig cannot meet', () => {
    expect(rigWarning(1, [])).toBeNull();
    expect(rigWarning(2, ['phone'])).toMatch(/AirPods/);
    expect(rigWarning(3, ['airpods', 'phone'])).toMatch(/Watch/);
    expect(rigWarning(3, ['airpods', 'watch'])).toBeNull();
  });
});

describe('routeTargets and roomKinds', () => {
  const ids = ['player-1', 'player-2', 'player-3'];
  it('a free device reaches everyone, a passed one only its holder, a player one nobody', () => {
    expect(routeTargets('free', ids, null)).toEqual(ids);
    expect(routeTargets('passed', ids, 'player-2')).toEqual(['player-2']);
    expect(routeTargets('passed', ids, 'gone')).toEqual([]);
    expect(routeTargets('passed', ids, null)).toEqual([]);
    expect(routeTargets('player', ids, 'player-1')).toEqual([]);
  });
  it('only free and passed kinds in the rig live in the room; a free AirPods stays with each player', () => {
    const own = { phone: { mode: 'free' as const, at: [0, 1, -2] as const }, watch: { mode: 'passed' as const }, airpods: { mode: 'free' as const } };
    expect(roomKinds(['airpods', 'phone', 'watch'], own as never)).toEqual(['phone', 'watch']);
    expect(roomKinds(['airpods'], own as never)).toEqual([]);
    expect(roomKinds(['airpods', 'phone', 'watch'], {})).toEqual([]);
  });
});

describe('a shared device reaches the players it should', () => {
  const sandbox = { loadScript: async () => {}, call: async () => ({ outputs: [] }), dispose: () => {} } as unknown as ScriptSandbox;

  /** Two players with no phone of their own, and one room phone routed the way RunController does it. */
  function setup(mode: 'free' | 'passed') {
    const reported: UsisPacket[] = [];
    const holder = { id: 'a' };
    const runs = new Map(['a', 'b'].map((id) => [id, new LocalRun({
      scene: parseScene({}), sandbox, clientScripts: {}, devices: { kinds: ['airpods'], now: () => 0 }, onPacket: (p) => reported.push(p),
    })]));
    const ingests = new Map([...runs].map(([id, r]) => [id, vi.spyOn(r, 'ingest')]));
    const room = new SimDevices((packet) => {
      routeTargets(mode, [...runs.keys()], holder.id).forEach((id, i) => runs.get(id)!.ingest(packet, i === 0));
    }, { kinds: ['phone'], idPrefix: 'room', now: () => 0 });
    for (const [id, r] of runs) r.devices.redirect('phone', room, mode === 'passed' ? () => holder.id === id : undefined);
    return { runs, holder, ingests, reported };
  }

  it('free: any player\'s tap is one room packet that every player ingests and the debug panel sees once', () => {
    const { runs, ingests, reported } = setup('free');
    runs.get('b')!.devices.gesture('tap');
    expect(ingests.get('a')).toHaveBeenCalledTimes(1);
    expect(ingests.get('b')).toHaveBeenCalledTimes(1);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ deviceId: 'room-phone', kind: 'phone' });
  });

  it('passed: only the holder\'s tap fires, it reaches only the holder, and handing it over moves it', () => {
    const { runs, holder, ingests } = setup('passed');
    runs.get('b')!.devices.gesture('tap'); // b does not hold it
    expect(ingests.get('a')).not.toHaveBeenCalled();
    expect(ingests.get('b')).not.toHaveBeenCalled();
    runs.get('a')!.devices.gesture('tap');
    expect(ingests.get('a')).toHaveBeenCalledTimes(1);
    expect(ingests.get('b')).not.toHaveBeenCalled();
    holder.id = 'b';
    runs.get('a')!.devices.gesture('tap'); // a gave it away
    runs.get('b')!.devices.gesture('tap');
    expect(ingests.get('a')).toHaveBeenCalledTimes(1);
    expect(ingests.get('b')).toHaveBeenCalledTimes(1);
  });
});

describe('stepToward', () => {
  it('walks straight at the given speed and stops on the goal', () => {
    const a = stepToward([0, 0], [3, 4], 1.5, 1);
    expect(a.done).toBe(false);
    expect(a.pos[0]).toBeCloseTo(0.9);
    expect(a.pos[1]).toBeCloseTo(1.2);
    expect(Math.hypot(...a.pos)).toBeCloseTo(1.5);
    expect(stepToward([0, 0], [1, 0], 1.5, 1)).toEqual({ pos: [1, 0], done: true }); // would overshoot: lands on it
  });
  it('is done within 5 cm and does not move when already there', () => {
    expect(stepToward([2, 2], [2.03, 2], 1.5, 0.05)).toEqual({ pos: [2.03, 2], done: true });
    expect(stepToward([5, 5], [5, 5], 1.5, 1).done).toBe(true);
  });
  it('reaches a distant goal in the expected number of 50 ms steps', () => {
    let pos: [number, number] = [0, 0];
    let steps = 0;
    for (let r = stepToward(pos, [3, 0], 1.5, 0.05); ; r = stepToward(pos, [3, 0], 1.5, 0.05)) {
      pos = r.pos;
      steps++;
      if (r.done || steps > 100) break;
    }
    expect(steps).toBe(40); // 3 m at 1.5 m/s
    expect(pos[0]).toBeCloseTo(3);
  });
});
