import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CUES, CUE_NAMES, cueNotes } from '@pear/runtime';
import { clampPhones, phoneScenario, projectFiles, runCheck } from '../src/checkPanel';
import { ScriptAudio } from '../src/scriptAudio';

const prelude = readFileSync(new URL('../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js', import.meta.url), 'utf8');
const game = (p: string) => readFileSync(new URL(`../../../Games/Manhunt/${p}`, import.meta.url), 'utf8');

describe('check panel', () => {
  it('clamps the phone count', () => {
    expect([clampPhones(0), clampPhones(5), clampPhones(99), clampPhones(NaN)]).toEqual([1, 5, 12, 1]);
    expect(phoneScenario(4).devices[0]).toMatchObject({ count: 4 });
  });
  it('a real game passes with N phones', () => {
    const scene = JSON.parse(game('scene.json'));
    const files: Record<string, string> = { 'scene.json': JSON.stringify(scene) };
    for (const n of scene.serverScripts) files[`scripts/server/${n}.js`] = game(`scripts/${n}.js`);
    const r = runCheck(files, 3, { prelude });
    expect(r.lines.join('\n')).toContain('3 phones');
    expect(r.ok).toBe(true);
  });
  it('a throwing handler fails and names the script', () => {
    const files = { 'scene.json': JSON.stringify({ serverScripts: ['g'] }), 'scripts/server/g.js': 'export default ({ onRemote() { throw new Error("boom"); } });' };
    const r = runCheck(files, 2, { prelude });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toMatch(/scripts\/server\/g\.js.*boom/);
  });
  it('projectFiles lays scripts out like a saved version', () => {
    const f = projectFiles({ scene: { serverScripts: [] } as never, serverScripts: { a: 'x' } });
    expect(Object.keys(f).sort()).toEqual(['scene.json', 'scripts/server/a.js']);
    expect(JSON.parse(f['scene.json']!).serverScripts).toEqual(['a']);
  });
});

describe('cues', () => {
  it('has the six shared cue names', () => expect(CUE_NAMES).toEqual(['tick', 'arming', 'fire', 'win', 'lose', 'fanfare']));
  it('every note is playable and unknown names are not cues', () => {
    for (const notes of Object.values(CUES)) for (const n of notes) expect(n.hz > 0 && n.ms > 0).toBe(true);
    expect(cueNotes('constructor')).toBeUndefined();
  });
  it('ScriptAudio schedules every note of a cue', () => {
    const starts: number[] = [];
    const ctx = {
      currentTime: 1, destination: {}, resume: () => Promise.resolve(),
      createOscillator: () => ({ frequency: { value: 0 }, connect() {}, start: (t: number) => starts.push(t), stop() {}, onended: null }),
      createGain: () => ({ gain: { value: 0 }, connect() {} }),
    } as unknown as AudioContext;
    new ScriptAudio({ createContext: () => ctx, warn: () => {} }).handle({ kind: 'audio', entity: 'E', action: 'play', sound: 'win' });
    expect(starts).toEqual([1, 1.12, 1.24]);
  });
});
