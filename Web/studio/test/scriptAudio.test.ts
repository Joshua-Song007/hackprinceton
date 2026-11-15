import { describe, expect, it } from 'vitest';
import { quat, type Quat } from '@pear/core';
import { parseScene } from '@pear/runtime';
import type { CallResult, HandlerCall, ScriptSandbox } from '@pear/script';
import { LocalRun, type EffectOutput } from '../src/run';
import { ScriptAudio } from '../src/scriptAudio';

const fakeContext = () => {
  const log: string[] = [];
  const osc = () => ({
    frequency: { value: 0 }, onended: null as null | (() => void),
    connect: () => {}, start: () => log.push('start'), stop: () => log.push('stop'),
  });
  const ctx = {
    currentTime: 1, destination: {}, resume: () => Promise.resolve(),
    createOscillator: () => (log.push('osc'), osc()),
    createGain: () => ({ gain: { value: 0 }, connect: () => {} }),
  };
  return { ctx: ctx as unknown as AudioContext, log };
};

describe('ScriptAudio', () => {
  it('beep plays an oscillator; stop stops it and cancels speech', () => {
    const { ctx, log } = fakeContext();
    const spoken: string[] = [];
    const speech = { speak: (u: { text: string }) => spoken.push(u.text), cancel: () => spoken.push('cancel') } as unknown as SpeechSynthesis;
    const audio = new ScriptAudio({ createContext: () => ctx, speech, makeUtterance: (text) => ({ text }) as SpeechSynthesisUtterance, warn: () => {} });
    audio.handle({ kind: 'audio', entity: 'E', action: 'play', sound: 'beep' });
    expect(log).toEqual(['osc', 'start', 'stop']); // started, scheduled to end
    audio.handle({ kind: 'audio', entity: 'E', action: 'stop' });
    expect(log.at(-1)).toBe('stop');
    audio.handle({ kind: 'audio', entity: 'E', action: 'speak', text: 'hands up' });
    expect(spoken).toEqual(['cancel', 'hands up']);
  });

  it('dispose stops sounds and closes the AudioContext; the next sound makes a new one', () => {
    const { ctx, log } = fakeContext();
    let closed = 0;
    (ctx as unknown as { close: () => Promise<void> }).close = async () => void closed++;
    let made = 0;
    const audio = new ScriptAudio({ createContext: () => (made++, ctx), warn: () => {} });
    audio.handle({ kind: 'audio', entity: 'E', action: 'play', sound: 'beep' });
    audio.dispose();
    expect(closed).toBe(1);
    expect(log.at(-1)).toBe('stop');
    audio.handle({ kind: 'audio', entity: 'E', action: 'play', sound: 'beep' });
    expect(made).toBe(2);
  });

  it('unknown sounds and missing Web Audio or speech warn without throwing', () => {
    const warnings: string[] = [];
    const audio = new ScriptAudio({ createContext: undefined, speech: undefined, makeUtterance: undefined, warn: (m) => warnings.push(m) });
    expect(() => {
      audio.handle({ kind: 'audio', entity: 'E', action: 'play', sound: 'growl' });
      audio.handle({ kind: 'audio', entity: 'E', action: 'play', sound: 'beep' });
      audio.handle({ kind: 'audio', entity: 'E', action: 'speak', text: 'x' });
      audio.handle({ kind: 'audio', entity: 'E', action: 'stop' });
    }).not.toThrow();
    expect(warnings).toEqual([expect.stringContaining("unknown sound 'growl'"), expect.stringContaining('Web Audio'), expect.stringContaining('speech')]);
  });
});

describe('LocalRun routes script outputs', () => {
  it('audio goes to the audio player and onOutput; calibrate re-baselines the raise rest pose', async () => {
    const scene = parseScene({ gestures: { raise: {} }, entities: [{ name: 'E', components: [{ type: 'script', name: 's' }] }] });
    const calls: { handler: string; args: unknown[] }[] = [];
    let reply: CallResult['outputs'] = [];
    const sandbox = {
      loadScript: async () => {},
      call: async (c: HandlerCall): Promise<CallResult> => (calls.push({ handler: c.handler, args: c.args }), { outputs: reply }),
      dispose: () => {},
    } as unknown as ScriptSandbox;
    const played: unknown[] = [];
    const seen: EffectOutput[] = [];
    let now = 0;
    const run = new LocalRun({ scene, clientScripts: {}, sandbox, now: () => now, audio: { handle: (o) => played.push(o) }, onOutput: (o) => seen.push(o) });
    run.devices.removeDevice('phone'); // this test feeds its own phone packets
    const pose = (q: Quat) => {
      now += 20;
      run.ingest({ v: 1, deviceId: 'p', kind: 'phone', slot: 'hand', source: 'sim', t: now, seq: now, ch: { orientation: q } });
    };
    const gestures = () => calls.filter((c) => c.handler === 'onGesture').map((c) => c.args[0]);

    pose(quat.identity);
    await run.step();
    reply = [{ kind: 'audio', entity: 'E', action: 'play', sound: 'beep' }, { kind: 'calibrate' }];
    pose(quat.fromAxisAngle([1, 0, 0], Math.PI / 2)); // raise (t = 40); the handler then calibrates here
    await run.step();
    expect(gestures()).toEqual([{ type: 'raise', t: 40 }]);
    expect(played).toEqual([{ kind: 'audio', entity: 'E', action: 'play', sound: 'beep' }]);
    expect(seen).toEqual(played); // calibrate is consumed by LocalRun
    reply = [];
    pose(quat.fromAxisAngle([1, 0, 0], Math.PI / 2)); // same pose is now rest: angle 0 lowers
    await run.step();
    expect(gestures()).toEqual([{ type: 'raise', t: 40 }, { type: 'lower', t: 60 }]);
  });
});
