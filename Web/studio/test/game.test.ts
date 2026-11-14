import { describe, expect, it } from 'vitest';
import { checkGame, gestureControls } from '../src/gamePanel';
import { Project, templateSnapshot } from '../src/project';

describe('checkGame', () => {
  it('hot potato template has attached scripts and a server script', () => {
    const p = new Project(templateSnapshot('hotpotato'));
    const { checks, attached } = checkGame(p, 'Stopped');
    expect(attached).toEqual([{ entity: 'Arena', script: 'player' }]);
    expect(checks.map((c) => c.ok)).toEqual([true, true, true, true, true, false, false]);
  });
  it('flags an unattached script', () => {
    const { checks } = checkGame({ scene: { entities: [{ name: 'A' }] }, clientScripts: { s: '' }, serverScripts: {}, version: 3 }, 'Playing locally');
    expect(checks.map((c) => c.ok)).toEqual([true, false, false, false, true, true]);
  });
  it('lists the gestures hot potato uses, with the line that handles each', () => {
    const c = gestureControls(new Project(templateSnapshot('hotpotato')).clientScripts);
    expect(c.map((x) => x.label)).toEqual(['Tap (T)', 'Double tap (G)', 'Flick (F)']);
    expect(c[1]!.line).toContain('ctx.remote.fire("start"');
    expect(c[1]!.where).toMatch(/^player:\d+$/);
  });
});
