// Words for the Explorer's rows: which scripts an object holds and which objects use a script.
// Pure, so the panel (DOM only) stays thin and these answers are tested.
import { walkEntities, type RawEntity, type SceneJson } from './project';

/** What an entity row shows on the right: its script files ("tap.js") and the other component types ("trigger"), in order. */
export function entityScripts(components: readonly Record<string, unknown>[] | undefined): string {
  return (components ?? []).map((c) => (c.type === 'script' && typeof c.name === 'string' && c.name ? `${c.name}.js` : String(c.type))).join(', ');
}

/** The names of the entities (children included) that hold the client script `scriptName`, in scene order. */
export function usedBy(scene: SceneJson, scriptName: string): string[] {
  const names: string[] = [];
  walkEntities(scene, (e: RawEntity) => {
    if ((e.components ?? []).some((c) => c.type === 'script' && c.name === scriptName)) names.push(typeof e.name === 'string' ? e.name : '');
  });
  return names;
}

/** "used by iPhone", "used by iPhone, iPhone 2", "used by A, B +1"; '' when nothing uses it. */
export function usedByText(names: readonly string[]): string {
  if (!names.length) return '';
  const shown = names.slice(0, 2).join(', ');
  return `used by ${shown}${names.length > 2 ? ` +${names.length - 2}` : ''}`;
}
