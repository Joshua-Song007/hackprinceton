import { describe, expect, it } from 'vitest';
import { flattenScene } from '@pear/runtime';
import { ScriptRuntime } from '@pear/script';
import prelude from '../../../Packages/PearScript/Sources/PearScript/Resources/prelude.js?raw';
import { DebugStore, packetRowKey } from '../src/debug-panel';
import { menuPosition } from '../src/ui';
import { errorRange } from '../src/editor';
import { PreferenceStore, defaultPreferences, motionReduced, parsePreferences } from '../src/preferences';
import { Project, templateSnapshot, walkEntities } from '../src/project';
import { gameSnapshot } from './games';

describe('preferences.ts', () => {
  it('clamps scale and font size, rejects unknown themes, trims the server URL', () => {
    const p = parsePreferences({ uiScale: 500, editorFontSize: 2, theme: 'neon', serverUrl: ' http://x:1/// ', reducedMotion: 'on' });
    expect(p).toMatchObject({ uiScale: 200, editorFontSize: 10, theme: 'dark', serverUrl: 'http://x:1', reducedMotion: 'on' });
    expect(parsePreferences({ uiScale: 90 }).uiScale).toBe(90);
    expect(parsePreferences('junk')).toEqual(defaultPreferences());
  });

  it('reduced motion follows the system only in system mode', () => {
    const d = defaultPreferences();
    expect(motionReduced(d, true)).toBe(true);
    expect(motionReduced({ ...d, reducedMotion: 'off' }, true)).toBe(false);
    expect(motionReduced({ ...d, reducedMotion: 'on' }, false)).toBe(true);
  });
});

describe('project.ts', () => {
  it('loads Quick Draw from Games/QuickDraw as a project', () => {
    const p = new Project(gameSnapshot('QuickDraw'));
    expect(p.name).toBe('Quick Draw');
    expect(Object.keys(p.clientScripts)).toEqual(['player']);
    expect(Object.keys(p.serverScripts)).toEqual(['game']);
    expect(p.clientScripts.player).toContain('onGesture');
    expect(p.description().entities.length).toBeGreaterThan(0);
  });

  it('raw entity ids match flattenScene ids', () => {
    const p = new Project(gameSnapshot('QuickDraw'));
    const ids: string[] = [];
    walkEntities(p.scene, (_e, id) => ids.push(id));
    expect(ids).toEqual(flattenScene(p.description()).map((e) => e.id));
  });

  it('tracks dirty state and keeps scene script lists in sync', () => {
    const p = new Project(gameSnapshot('QuickDraw'));
    expect(p.dirty).toBe(false);
    p.setScript('client', 'player', '// edited');
    expect(p.dirty).toBe(true);
    p.markSaved();
    expect(p.dirty).toBe(false);
    expect(p.addScript('server', 'extra')).toBeUndefined();
    expect(p.addScript('server', 'extra')).toMatch(/already exists/);
    expect(p.addScript('client', 'bad name')).toMatch(/start with a letter/);
    expect(p.renameScript('client', 'player', 'hero')).toBeUndefined();
    expect(p.scene.clientScripts).toEqual(['hero']);
    expect(p.entity('PlayerScriptHost')!.components).toContainEqual({ type: 'script', name: 'hero' });
    p.deleteScript('server', 'extra');
    const v = p.toVersion();
    expect(v.server_scripts).toEqual({ game: p.serverScripts.game });
    expect(v.run_mode).toBe('device');
    expect(Object.keys(v.client_scripts)).toEqual(['hero']);
  });

  it('edits an entity through updateEntity and flags the project dirty', () => {
    const p = new Project(gameSnapshot('QuickDraw'));
    expect(p.updateEntity('PlayerScriptHost', (e) => (e.position = [1, 2, 3]))).toBe(true);
    expect(p.description().entities.find((e) => e.name === 'PlayerScriptHost')!.position).toEqual([1, 2, 3]);
    expect(p.dirty).toBe(true);
    expect(p.updateEntity('Nope', () => {})).toBe(false);
  });
});

describe('blank template', () => {
  it('is a floor and nothing else: no scripts, only the player count declared', () => {
    const p = new Project(templateSnapshot('blank'));
    expect(flattenScene(p.description()).map((e) => e.id)).toEqual(['Floor']);
    expect(p.clientScripts).toEqual({});
    expect(p.serverScripts).toEqual({});
    expect(p.scene.inputs).toEqual({ players: [1, 32] });
    expect(p.description().inputs).toMatchObject({ head: false, position: false, heartRate: false, gestures: [], players: [1, 32] });
  });
});

describe('tap counter template', () => {
  it('has a floor, one cube with a script, and a client script that fires click on tap', () => {
    const p = new Project(templateSnapshot('tapcounter'));
    expect(flattenScene(p.description()).map((e) => e.id)).toEqual(['Floor', 'Cube']);
    expect(Object.keys(p.serverScripts)).toEqual(['counter']);
    expect(p.serverScripts.counter).toContain('ctx.state.clicks');
    const rt = new ScriptRuntime(prelude);
    rt.load('cube', p.clientScripts.cube!);
    const r = rt.call({ script: 'cube', entity: { id: 'Cube', name: 'Cube', position: [0, 1.2, -3] }, handler: 'onGesture', args: [{ type: 'tap' }] });
    expect(r.error).toBeUndefined();
    expect(r.outputs).toContainEqual({ kind: 'remote', name: 'click', data: { by: 'Cube' } });
  });
});

describe('debug-panel.ts DebugStore', () => {
  it('applies a snapshot then streamed events', () => {
    const s = new DebugStore();
    s.handleDebugEvent({ kind: 'snapshot', t: 1, players: ['a'], version: 2, state: { n: 1 }, logs: [{ kind: 'log', t: 1, level: 'warn', msg: 'hi' }] });
    expect([s.players.size, s.serverVersion, s.state]).toEqual([1, 2, { n: 1 }]);
    s.handleDebugEvent({ kind: 'join', t: 2, player: 'b' });
    s.handleDebugEvent({ kind: 'state', t: 3, state: { n: 2 } });
    s.handleDebugEvent({ kind: 'out', t: 4, player: null, name: 'round', data: { state: 'won' } });
    s.handleDebugEvent({ kind: 'leave', t: 5, player: 'a' });
    expect([...s.players]).toEqual(['b']);
    expect(s.state).toEqual({ n: 2 });
    expect(s.server.map((r) => r.kind)).toEqual(['log', 'snapshot', 'join', 'out', 'leave']);
    expect(s.server[0]).toMatchObject({ level: 'warn', detail: 'hi' });
    let seen = '';
    s.onServerError = (m) => (seen = m);
    s.handleDebugEvent({ kind: 'error', t: 6, msg: 'onRemote: Error: x' });
    expect(seen).toBe('onRemote: Error: x');
    s.handleDebugEvent({ kind: 'reload', t: 7, version: 3 });
    expect([s.serverVersion, s.state]).toEqual([3, {}]);
  });
});

describe('editor.ts errorRange', () => {
  it('marks the handler named in the message, else line 1', () => {
    const src = 'export default script({\n  onLookAt(self) {},\n  onGesture(self) {},\n});\n';
    const r = errorRange(src, 'player.onGesture: Error: boom');
    expect(src.slice(r.from, r.to)).toBe('  onGesture(self) {},');
    expect(errorRange(src, 'SyntaxError: nope').from).toBe(0);
  });

  it('marks the reported line when the sandbox gives one', () => {
    const src = 'export default script({\n  onLookAt(self) {},\n  onGesture(self) {},\n});\n';
    const r = errorRange(src, 'player.onLookAt: ReferenceError: x is not defined (line 3)');
    expect(src.slice(r.from, r.to)).toBe('  onGesture(self) {},');
    expect(src.slice(errorRange(src, 'p.onLookAt: E (line 1)').from).startsWith('export')).toBe(true);
  });
});

describe('fix round 1', () => {
  it('Run on server version survives a snapshot that has none', () => {
    const s = new DebugStore();
    s.setServerVersion(5);
    s.handleDebugEvent({ kind: 'snapshot', players: [] });
    expect(s.serverVersion).toBe(5);
    s.handleDebugEvent({ kind: 'snapshot', version: 6 });
    expect(s.serverVersion).toBe(6);
  });

  it('packet rows: arrows move focus, Enter and Space select, ends clamp', () => {
    const ids = [1, 2, 3];
    expect(packetRowKey(ids, 2, 'ArrowDown')).toEqual({ id: 3, select: false });
    expect(packetRowKey(ids, 3, 'ArrowDown')).toBeNull();
    expect(packetRowKey(ids, 2, 'Home')).toEqual({ id: 1, select: false });
    expect(packetRowKey(ids, 2, ' ')).toEqual({ id: 2, select: true });
    expect(packetRowKey(ids, 9, 'Enter')).toBeNull();
  });

  it('menu position is in zoomed units so a scaled menu lands under its anchor', () => {
    expect(menuPosition({ left: 400, bottom: 38 }, 2, 1600)).toEqual({ left: 200, top: 20 });
    expect(menuPosition({ left: 1590, bottom: 0 }, 2, 1600)).toEqual({ left: 560, top: 1 });
  });
});

describe('account.ts publishIfChanged', () => {
  it('publishes once, then joins the same version until the project changes', async () => {
    const { AccountController } = await import('../src/account');
    const acc = new AccountController(new PreferenceStore(null), false, null);
    acc.gameId = 'g1';
    let n = 0;
    (acc as unknown as { client: unknown }).client = { publish: async () => ({ version: ++n, game_id: 'g1' }) };
    const p = new Project(gameSnapshot('QuickDraw'));
    expect(await acc.publishIfChanged(p)).toEqual({ version: 1, published: true });
    expect(await acc.publishIfChanged(p)).toEqual({ version: 1, published: false });
    p.setCloud('g1', 1);
    p.setScript('client', Object.keys(p.clientScripts)[0]!, '// changed');
    expect((await acc.publishIfChanged(p)).published).toBe(true);
  });
});

describe('account.ts deleteGame', () => {
  it('drops the game from the list, clears a matching selection, and keeps the list when the server refuses', async () => {
    const { AccountController } = await import('../src/account');
    const acc = new AccountController(new PreferenceStore(null), false, null);
    const game = (id: string) => ({ id, owner_id: 'me', title: id, created_at: 't', updated_at: 't' });
    acc.games = [game('g1'), game('g2')];
    acc.gameId = 'g1';
    const deleted: string[] = [];
    let refuse = false;
    (acc as unknown as { client: unknown }).client = { deleteGame: async (id: string) => { if (refuse) throw new Error('forbidden'); deleted.push(id); } };
    await acc.deleteGame('g2');
    expect(acc.games.map((g) => g.id)).toEqual(['g1']);
    expect(acc.gameId).toBe('g1');
    refuse = true;
    await expect(acc.deleteGame('g1')).rejects.toThrow('forbidden');
    expect(acc.games.map((g) => g.id)).toEqual(['g1']);
    refuse = false;
    await acc.deleteGame('g1');
    expect(acc.games).toEqual([]);
    expect(acc.gameId).toBeNull();
    expect(deleted).toEqual(['g2', 'g1']);
  });
});
