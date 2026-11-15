// Fixtures: a shipped game folder (Games/<name>) as a Studio ProjectSnapshot, so tests that need a real game use Quick Draw or Manhunt.
import type { ProjectSnapshot, SceneJson } from '../src/project';
import quickDrawScene from '../../../Games/QuickDraw/scene.json';
import manhuntScene from '../../../Games/Manhunt/scene.json';

const files = import.meta.glob('../../../Games/{QuickDraw,Manhunt}/scripts/*.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export type GameName = 'QuickDraw' | 'Manhunt';

export function gameSnapshot(name: GameName): ProjectSnapshot {
  const scene = structuredClone(name === 'QuickDraw' ? quickDrawScene : manhuntScene) as SceneJson;
  const pick = (names: unknown) => Object.fromEntries(((names as string[] | undefined) ?? []).map((n) => [n, files[`../../../Games/${name}/scripts/${n}.js`] ?? '']));
  return { scene, clientScripts: pick(scene.clientScripts), serverScripts: pick(scene.serverScripts), gameId: null, version: null };
}
