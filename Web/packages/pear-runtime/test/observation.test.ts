import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GESTURE_TYPES } from '@pear/core';
import { buildObservation, parseActions, type AvatarView, type Cue } from '../src';

const avatar = (id: string, x: number, z: number, yaw = 0): AvatarView => ({ id, position: [x, 1.6, z], yaw, pitch: 0, driven: false, devices: [{ kind: 'phone', shared: false }], hapticAt: 0 });
const me = avatar('p1', 0, 0);

describe('buildObservation', () => {
  it('sees a player in front and in range with distance, bearing and gaze', () => {
    const o = buildObservation(me, [me, avatar('p2', 0, -3, Math.PI)], [], 12.34);
    expect(o.gameTime).toBe(12.3);
    expect(o.others).toEqual([{ id: 'p2', distance: 3, bearing: 0, gaze: 'at you' }]);
    expect(o.you).toEqual({ position: [0, 0], facing: 0, arena: 10, devices: [{ kind: 'phone', shared: false }] });
  });

  it('leaves out players behind, out of range and itself, without counting them', () => {
    const o = buildObservation(me, [me, avatar('behind', 0, 3), avatar('far', 0, -9), avatar('side', 5, -0.1)], [], 0);
    expect(o.others.map((s) => s.id)).toEqual(['side']);
    expect(JSON.stringify(o)).not.toMatch(/behind|far/);
    expect(Object.keys(o)).toEqual(['gameTime', 'you', 'others', 'heard']);
  });

  it('never carries what the viewport shows about a player (name tag, action, speech, walk target, colour)', () => {
    const tagged = { ...avatar('p2', 0, -3, Math.PI), label: 'SECRETNAME', doing: 'SECRETDOING', say: 'SECRETSAY', goal: [7, 7] as const, tint: 2 };
    const o = buildObservation({ ...me, label: 'MYTAG', doing: 'MYDOING' }, [me, tagged], [], 0);
    expect(o.others).toHaveLength(1);
    expect(JSON.stringify(o)).not.toMatch(/SECRET|MYTAG|MYDOING|tint|goal/);
  });

  it('bearing is positive to the left and follows the own yaw', () => {
    expect(buildObservation(me, [avatar('l', -3, -3)], [], 0).others[0]!.bearing).toBe(45);
    expect(buildObservation(me, [avatar('r', 3, -3)], [], 0).others[0]!.bearing).toBe(-45);
    const turned = avatar('t', 0, 0, Math.PI / 2); // faces -X
    expect(buildObservation(turned, [avatar('x', -4, 0)], [], 0).others[0]!.bearing).toBe(0);
    expect(buildObservation(turned, [avatar('y', 4, 0)], [], 0).others).toEqual([]);
  });

  it('gaze is away when the other looks elsewhere, and yaw wraps', () => {
    expect(buildObservation(me, [avatar('p2', 0, -3, 0)], [], 0).others[0]!.gaze).toBe('away');
    expect(buildObservation(me, [avatar('p2', 0, -3, Math.PI + 2 * Math.PI)], [], 0).others[0]!.gaze).toBe('at you');
    expect(buildObservation(avatar('w', 0, 0, 3 * Math.PI), [], [], 0).you.facing).toBe(180);
  });

  it('carries the cues it is given and sorts the others by distance', () => {
    const cues: Cue[] = [{ t: 1, kind: 'speech', text: 'hi', from: 'p2' }];
    const o = buildObservation(me, [avatar('b', 0, -5), avatar('a', 0, -2)], cues, 2);
    expect(o.heard).toEqual(cues);
    expect(o.others.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('parseActions', () => {
  it('keeps valid actions in order and drops the rest without throwing', () => {
    const out = parseActions([
      { type: 'walk_to', x: 1, z: 2 }, { type: 'jump' }, null, 'x', { type: 'walk_to', x: 'a', z: 1 },
      { type: 'look_at', player: 'p2' }, { type: 'look_at', x: 1, z: 1 }, { type: 'look_at' },
      { type: 'gesture', gesture: 'flick' }, { type: 'gesture', gesture: 'wave' },
    ]);
    expect(out).toEqual([
      { type: 'walk_to', x: 1, z: 2 }, { type: 'look_at', player: 'p2' }, { type: 'look_at', x: 1, z: 1 }, { type: 'gesture', gesture: 'flick' },
    ]);
  });

  it('caps at five, clamps walks and waits, trims speech, checks devices', () => {
    expect(parseActions(Array.from({ length: 9 }, () => ({ type: 'wait', seconds: 1 })))).toHaveLength(5);
    expect(parseActions([{ type: 'walk_to', x: 99, z: -99 }])).toEqual([{ type: 'walk_to', x: 10, z: -10 }]);
    expect(parseActions([{ type: 'wait', seconds: 99 }, { type: 'wait', seconds: 0 }])).toEqual([{ type: 'wait', seconds: 10 }, { type: 'wait', seconds: 0.5 }]);
    expect(parseActions([{ type: 'say', text: `  ${'a'.repeat(300)} ` }, { type: 'say', text: '  ' }])).toEqual([{ type: 'say', text: 'a'.repeat(200) }]);
    expect(parseActions([{ type: 'give_device', device: 'phone', to: 'p2' }, { type: 'give_device', device: 'toaster', to: 'p2' }, { type: 'give_device', device: 'watch', to: '' }]))
      .toEqual([{ type: 'give_device', device: 'phone', to: 'p2' }]);
    expect(parseActions([{ type: 'walk_to', x: Infinity, z: 0 }])).toEqual([]);
  });

  it('non-arrays give nothing', () => {
    for (const bad of [undefined, null, 'walk', 3, { type: 'wait', seconds: 1 }]) expect(parseActions(bad)).toEqual([]);
  });
});

describe('players.py agreement', () => {
  const py = readFileSync(new URL('../../../../Plugins/langchain-deepagents/runtime/players.py', import.meta.url), 'utf8');
  const rules = py.slice(py.indexOf('REPLY_RULES'));
  it('names every action type, gesture and device the parser accepts', () => {
    for (const type of ['walk_to', 'look_at', 'gesture', 'give_device', 'say', 'wait']) expect(rules).toContain(`"type": "${type}"`);
    for (const g of GESTURE_TYPES) expect(rules).toContain(`"${g}"`);
    for (const d of ['phone', 'watch', 'airpods']) expect(rules).toContain(`"${d}"`);
  });
  it('uses the same limits', () => {
    expect(py).toContain('MAX_ACTIONS = 5');
    expect(py).toContain('min(10, max(0.5');
    expect(py).toContain('[:200]');
  });
});
