import { describe, expect, it } from 'vitest';
import { createPlayServer, joinPlay, stepPosition } from '../src/run';

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
