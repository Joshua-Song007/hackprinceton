import { describe, expect, it } from 'vitest';
import { checkGame, gestureControls } from '../src/gamePanel';
import { Project } from '../src/project';
import { gameSnapshot } from './games';

describe('checkGame', () => {
  it('Quick Draw has attached scripts and a server script', () => {
    const p = new Project(gameSnapshot('QuickDraw'));
    const { checks, attached } = checkGame(p, 'Stopped');
    expect(attached).toEqual([{ entity: 'PlayerScriptHost', script: 'player' }]);
    expect(checks.map((c) => c.ok)).toEqual([true, true, true, true, false, false]);
  });
  it('flags an unattached script', () => {
    const { checks } = checkGame({ scene: { entities: [{ name: 'A' }] }, clientScripts: { s: '' }, serverScripts: {}, version: 3 }, 'Playing locally');
    expect(checks.map((c) => c.ok)).toEqual([true, false, false, false, true, true]);
  });
  it('lists the gestures Quick Draw uses, with the line that handles each', () => {
    const c = gestureControls(new Project(gameSnapshot('QuickDraw')).clientScripts);
    expect(c.map((x) => x.label)).toEqual(['Tap (T)']);
    expect(c[0]!.line).toContain('g.type === "tap"');
    expect(c[0]!.where).toMatch(/^player:\d+$/);
  });
});
