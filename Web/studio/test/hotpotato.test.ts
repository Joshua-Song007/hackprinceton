import { describe, expect, it } from 'vitest';
import gameSource from '../../../Games/HotPotato/scripts/game.js?raw';
import playerSource from '../../../Games/HotPotato/scripts/player.js?raw';
import prelude from '../../../Packages/OmniScript/Sources/OmniScript/Resources/prelude.js?raw';
import { ScriptRuntime, rewriteExportDefault } from '../../packages/omni-script/src';

// Tiny fake of the server host: ctx.now() from a mutable clock, after/cancel store timers advance() fires.
function harness() {
  const scope: Record<string, unknown> = { console: { log() {}, warn() {}, error() {} } };
  const def = new Function(`with (this) {\n${prelude}\n${rewriteExportDefault(gameSource)}\n}\nreturn this.__omniTakeDefault();`).call(scope) as any;
  let clock = 1000;
  let next = 1;
  const timers = new Map<number, { at: number; tag: string; data: unknown }>();
  const sent: { to: string; name: string; data: any }[] = [];
  const ctx = {
    state: {} as any,
    remote: { fire: (to: string, name: string, data: any) => sent.push({ to, name, data }), fireAll: (name: string, data: any) => sent.push({ to: '*', name, data }) },
    now: () => clock,
    after: (ms: number, tag: string, data: unknown) => { timers.set(next, { at: clock + ms, tag, data }); return next++; },
    cancel: (id: number) => void timers.delete(id),
  };
  const P = (id: string) => ({ id, name: id.toUpperCase() });
  return {
    ctx, sent, timers,
    join: (...ids: string[]) => ids.forEach((id) => def.onPlayerJoin(ctx, P(id))),
    leave: (id: string) => def.onPlayerLeave(ctx, P(id)),
    send: (id: string, name: string, data: unknown = {}) => def.onRemote(ctx, P(id), name, data),
    pos: (id: string, x: number, z: number, acc = 0) => def.onRemote(ctx, P(id), 'pos', { x, z, acc }),
    advance(ms: number) {
      clock += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (t.at <= clock && timers.delete(id)) def.onTimer(ctx, t.tag, t.data);
    },
    events: (name: string) => sent.filter((e) => e.name === name).map((e) => e.data),
  };
}

describe('HotPotato server script', () => {
  it('start needs 2 players', () => {
    const h = harness();
    h.join('a');
    h.send('a', 'start');
    expect(h.ctx.state.phase).toBe('lobby');
    h.join('b');
    h.send('a', 'start');
    expect(h.ctx.state.phase).toBe('play');
    expect(['a', 'b']).toContain(h.ctx.state.holder);
    expect(h.timers.size).toBe(1);
  });

  it('tag: out of range rejected, in range passes, non-holder rejected', () => {
    const h = harness();
    h.join('a', 'b', 'c');
    h.send('a', 'start');
    const holder = h.ctx.state.holder as string;
    const [other, far] = ['a', 'b', 'c'].filter((i) => i !== holder);
    h.pos(holder, 0, 0); h.pos(other!, 5, 0); h.pos(far!, 30, 0);
    h.send(holder, 'tag');
    expect(h.ctx.state.holder).toBe(holder); // 5 m > 1.5 m
    expect(h.sent.at(-1)).toEqual({ to: holder, name: 'tagMissed', data: { reason: `nearest player ${other!.toUpperCase()} is 5.0 m away, range 1.5 m` } });
    h.send(other!, 'tag'); // not the holder
    expect(h.ctx.state.holder).toBe(holder);
    h.pos(other!, 1, 0);
    h.send(holder, 'tag');
    expect(h.ctx.state.holder).toBe(other);
    expect(h.events('holder').at(-1)).toMatchObject({ id: other, from: holder });
    h.send(holder, 'tag'); // no longer the holder
    expect(h.ctx.state.holder).toBe(other);
  });

  it('stale positions do not count', () => {
    const h = harness();
    h.join('a', 'b');
    h.send('a', 'start');
    const holder = h.ctx.state.holder as string;
    const other = holder === 'a' ? 'b' : 'a';
    h.pos(holder, 0, 0); h.pos(other, 1, 0);
    h.advance(3500); // fuse is >= 10 s, so the round is still on
    h.send(holder, 'tag');
    expect(h.ctx.state.holder).toBe(holder);
    expect(h.events('tagMissed').at(-1)).toEqual({ reason: 'your position is older than 3 s' });
  });

  it('boom eliminates the holder; last player wins; start after a winner resets', () => {
    const h = harness();
    h.join('a', 'b');
    h.send('a', 'start');
    const holder = h.ctx.state.holder as string;
    h.advance(25001);
    expect(h.events('eliminated')).toEqual([{ id: holder, name: holder.toUpperCase(), round: 1 }]);
    expect(h.events('winner')).toHaveLength(1);
    expect(h.ctx.state.phase).toBe('over');
    expect(h.timers.size).toBe(0);
    h.send(holder, 'start'); // eliminated players are ignored
    expect(h.ctx.state.phase).toBe('over');
    h.send(holder === 'a' ? 'b' : 'a', 'start');
    expect(h.ctx.state.phase).toBe('play');
    expect(h.ctx.state.round).toBe(2);
    expect(Object.values(h.ctx.state.players).every((p: any) => p.alive)).toBe(true);
  });

  it('boom with 3 players keeps playing with a new holder and fuse', () => {
    const h = harness();
    h.join('a', 'b', 'c');
    h.send('a', 'start');
    const first = h.ctx.state.holder;
    h.advance(25001);
    expect(h.ctx.state.phase).toBe('play');
    expect(h.ctx.state.holder).not.toBe(first);
    expect(h.timers.size).toBe(1);
  });

  it('holder leaving mid-round reassigns; one left wins', () => {
    const h = harness();
    h.join('a', 'b', 'c');
    h.send('a', 'start');
    const holder = h.ctx.state.holder as string;
    h.leave(holder);
    expect(h.ctx.state.holder).not.toBe(holder);
    expect(h.ctx.state.holder).toBeTruthy();
    h.leave(h.ctx.state.holder);
    expect(h.events('winner')).toHaveLength(1);
    expect(h.timers.size).toBe(0);
  });
});

describe('HotPotato client script', () => {
  it('sends pos only when a position exists; tags only as the holder', () => {
    const rt = new ScriptRuntime(prelude);
    rt.load('player', playerSource);
    const e = { id: 'Arena', name: 'Arena', position: [0, 0, 0] as [number, number, number] };
    const call = (handler: string, args: unknown[] = [], extra: object = {}) => rt.call({ script: 'player', entity: e, handler, args, ...extra });
    expect(call('onTick', [0.2]).outputs).toEqual([]);
    const r = call('onTick', [0.2], { position: [3, 0, -4] });
    expect(r.error).toBeUndefined();
    expect(r.outputs).toEqual([{ kind: 'remote', name: 'pos', data: { x: 3, z: -4, acc: 2 } }]);
    expect(call('onGesture', [{ type: 'flick' }], { playerId: 'me' }).outputs).toEqual([]); // not the holder yet
    expect(call('onRemote', ['holder', { id: 'me', name: 'Me' }], { playerId: 'me' }).outputs).toContainEqual({ kind: 'haptic', pattern: 'thud', intensity: 0.8 });
    expect(call('onGesture', [{ type: 'flick' }], { playerId: 'me' }).outputs).toEqual([{ kind: 'remote', name: 'tag', data: {} }]);
    expect(call('onRemote', ['holder', { id: 'me', name: 'Me' }]).outputs.some((o) => o.kind === 'haptic')).toBe(false); // id unknown: no haptic
  });
});
