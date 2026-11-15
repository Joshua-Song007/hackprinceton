// Game panel: a checklist of what the open game still needs, plus who runs which script. Pure `checkGame` so it is testable.
import { parseInputs, type SceneInputs } from '@pear/runtime';
import type { SceneJson } from './project';
import { walkEntities } from './project';
import { readLastPublished } from './account';
import { describeInputs, inferInputs, missingInputs } from './needs';

/** `fix` is a one-click repair: `Project.setSceneSetting(setting, value)`. */
export interface Check { ok: boolean; label: string; hint?: string; fix?: { label: string; setting: string; value: unknown } }

/** Declared needs vs what the scripts use, and the location permission position needs. */
function inputChecks(scene: SceneJson, clientScripts: Record<string, string>): Check[] {
  const used = inferInputs(clientScripts);
  let declared: SceneInputs | null = null;
  try {
    if (scene.inputs !== undefined && scene.inputs !== null) declared = parseInputs(scene.inputs);
  } catch (e) {
    return [{ ok: false, label: 'Inputs are invalid', hint: e instanceof Error ? e.message : String(e), fix: { label: 'Replace with what scripts use', setting: 'inputs', value: used } }];
  }
  const checks: Check[] = [];
  if (!declared) checks.push({ ok: false, label: 'Inputs not declared', hint: `Scripts use ${describeInputs(used)}`, fix: { label: 'Declare these', setting: 'inputs', value: used } });
  else {
    const gap = missingInputs(declared, used);
    checks.push(gap
      ? { ok: false, label: `Scripts use ${gap.names.join(', ')}, not declared`, fix: { label: 'Add', setting: 'inputs', value: gap.merged } }
      : { ok: true, label: `Needs ${describeInputs(declared)}` });
  }
  const position = declared?.position ?? used.position;
  const allowed = (scene.permissions as { location?: unknown } | undefined)?.location === true;
  if (position) checks.push(allowed ? { ok: true, label: 'Location permission on' } : { ok: false, label: 'Position needs the location permission', hint: 'ctx.position is null without it', fix: { label: 'Turn on', setting: 'permissions.location', value: true } });
  for (const name of Object.keys((scene.gestures as object | undefined) ?? {})) {
    if (name === 'raise') { // not a motion gesture: it is the phone's tilt, read through onGesture
      if (!Object.values(clientScripts).some((s) => /["']raise["']|["']lower["']/.test(s))) checks.push({ ok: true, label: 'Motion gesture raise is not used', hint: 'No client script mentions "raise" or "lower"' });
      continue;
    }
    if (!Object.values(clientScripts).some((s) => new RegExp(`["']${name}["']`).test(s))) checks.push({ ok: true, label: `Motion gesture ${name} is not used`, hint: `No client script mentions "${name}"` });
  }
  return checks;
}

export function checkGame(p: { scene: SceneJson; clientScripts: Record<string, string>; serverScripts: Record<string, string>; version: number | null; gameId?: string | null }, runText: string, lastPublishedAt: number | null = readLastPublished(p.gameId)): { checks: Check[]; attached: { entity: string; script: string }[] } {
  const attached: { entity: string; script: string }[] = [];
  let entities = 0;
  walkEntities(p.scene, (e, id) => {
    entities++;
    for (const c of (e.components as { type?: string; name?: string }[] | undefined) ?? []) if (c.type === 'script' && typeof c.name === 'string') attached.push({ entity: id, script: c.name });
  });
  const clientNames = Object.keys(p.clientScripts);
  const unattached = clientNames.filter((n) => !attached.some((a) => a.script === n));
  const missing = attached.filter((a) => !(a.script in p.clientScripts)).map((a) => a.script);
  const checks: Check[] = [
    { ok: entities > 0, label: `Scene has ${entities} entit${entities === 1 ? 'y' : 'ies'}`, hint: 'Explorer > Add entity' },
    { ok: clientNames.length > 0 && unattached.length === 0 && missing.length === 0, label: `${attached.length} script attachment${attached.length === 1 ? '' : 's'}`,
      hint: missing.length ? `Missing script: ${missing[0]}` : unattached.length ? `Not attached to an entity: ${unattached.join(', ')}` : 'Create a client script and attach it in the Inspector' },
    { ok: Object.keys(p.serverScripts).length > 0, label: `${Object.keys(p.serverScripts).length} server script${Object.keys(p.serverScripts).length === 1 ? '' : 's'}`, hint: 'Optional; needed for shared state and multiplayer' },
    ...inputChecks(p.scene, p.clientScripts),
    { ok: /^Playing|^Running/.test(runText), label: `Last run: ${runText}`, hint: 'Press F5 to Play' },
    { ok: p.version !== null, label: p.version === null ? 'Not published' : `Published as version ${p.version}`, hint: 'File > Publish' },
    ...(lastPublishedAt === null ? [] : [{ ok: true, label: `Last published: ${new Date(lastPublishedAt).toLocaleString()}` }]),
  ];
  return { checks, attached };
}

const GESTURES = [['tap', 'Tap', 'T'], ['doubleTap', 'Double tap', 'G'], ['flick', 'Flick', 'F'], ['pinch', 'Pinch', 'P'], ['squeeze', 'Squeeze', 'H']] as const;

/** For each gesture a client script mentions as a quoted literal, its key and the first line that uses it, so a creator sees what each input does. */
export function gestureControls(clientScripts: Record<string, string>): { label: string; where: string; line: string }[] {
  const out: { label: string; where: string; line: string }[] = [];
  for (const [type, name, key] of GESTURES) {
    const quoted = new RegExp(`["']${type}["']`);
    found: for (const [script, source] of Object.entries(clientScripts)) {
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!quoted.test(lines[i]!)) continue;
        out.push({ label: `${name} (${key})`, where: `${script}:${i + 1}`, line: lines[i]!.trim() });
        break found;
      }
    }
  }
  return out;
}
