import { expect, it } from 'vitest';
import { companionSqueeze } from '../src/livePreview/physical';

const packet = { v: 1, deviceId: 'ipad', kind: 'tablet', slot: 'hand', source: 'live', t: 100, seq: 7, ch: { gesture: { type: 'squeeze' } } };
it('forwards the native USIS squeeze without requiring orientation', () => {
  expect(companionSqueeze('ipad', packet)).toEqual({ deviceId: 'ipad', seq: 7 });
});
it('rejects other devices, simulation, malformed packets and non-squeeze input', () => {
  expect(companionSqueeze('other', packet)).toBeNull();
  for (const input of [null, {}, {...packet, source:'sim'}, {...packet, seq:-1}, {...packet, t:NaN}, {...packet, ch:{gesture:{type:'doubleTap'}}}, {...packet, ch:{touch:{phase:'began'}}}, {pointerType:'pen',phase:'down'}]) {
    expect(companionSqueeze('ipad', input)).toBeNull();
  }
});
