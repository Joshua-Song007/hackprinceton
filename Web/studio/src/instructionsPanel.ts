// The Instructions panel: the game's written instructions as a form the creator edits directly (each commit is one undo step), the
// scene check (what in scene.json disagrees with them), an agent's proposal as a list of changes with Accept and Reject, and the
// playtest report. The pure helpers are exported for the tests; the panel itself is plain DOM.
import { GESTURE_TYPES } from '@pear/core';
import { INSTRUCTION_LIMITS, PERIPHERAL_KINDS, lintInstructions, parseInstructions, type InstructionStep, type Instructions, type OwnershipMode, type SceneDescription } from '@pear/runtime';
import type { PanelView } from './layout';
import type { PlaytestReport } from './playtestReport';
import { renderPlaytest } from './playtestView';
import type { Project } from './project';
import type { RunController } from './run';
import { announce, button, el } from './ui';

export const blankInstructions = (): Instructions => parseInstructions({});

/** The instructions with some fields replaced, cleaned by the same parse every other source goes through. */
export const editInstructions = (current: Instructions, patch: Partial<Instructions>): Instructions => parseInstructions({ ...current, ...patch });

const lowestFree = (prefix: string, used: Set<string>): string => {
  for (let n = 1; ; n++) if (!used.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
};

/** A new role, or the same instructions at the role limit. */
export function addRole(i: Instructions): Instructions {
  if (i.roles.length >= INSTRUCTION_LIMITS.roles) return i;
  const id = lowestFree('role', new Set(i.roles.map((r) => r.id)));
  return editInstructions(i, { roles: [...i.roles, { id, name: 'New role', brief: '', kind: 'player' }] });
}

export const removeRole = (i: Instructions, id: string): Instructions => editInstructions(i, { roles: i.roles.filter((r) => r.id !== id) });

/** A new phase, or the same instructions at the phase limit. */
export function addPhase(i: Instructions): Instructions {
  if (i.phases.length >= INSTRUCTION_LIMITS.phases) return i;
  const id = lowestFree('phase', new Set(i.phases.map((p) => p.id)));
  return editInstructions(i, { phases: [...i.phases, { id, title: 'New phase', text: '', steps: [] }] });
}

export const removePhase = (i: Instructions, id: string): Instructions => editInstructions(i, { phases: i.phases.filter((p) => p.id !== id) });

/** One step per line, `role | do`; an empty role (every player) gives `| do`. */
export const stepsText = (steps: readonly InstructionStep[]): string => steps.map((s) => `${s.role} | ${s.do}`.trim()).join('\n');

/** The inverse of `stepsText`; a line without `|` is a step for every player, and blank lines are dropped. */
export function parseStepsText(text: string): InstructionStep[] {
  const out: InstructionStep[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const bar = line.indexOf('|');
    out.push(bar < 0 ? { role: '', do: line } : { role: line.slice(0, bar).trim(), do: line.slice(bar + 1).trim() });
  }
  return out;
}

const CUT = 60;
const quoted = (s: string): string => `"${s.length > CUT ? `${s.slice(0, CUT - 3)}...` : s}"`;
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
const range = (p: { min: number; max: number }): string => (p.min === p.max ? String(p.min) : `${p.min} to ${p.max}`);
const MODE_TEXT: Record<OwnershipMode, string> = { player: "each player's own", free: 'free in the room', passed: 'passed between players' };

/** What a proposal would change, in sentences. `current` null means the game has no instructions yet. */
export function instructionsDiff(current: Instructions | null, proposed: Instructions): string[] {
  if (!current) return [`New instructions: ${quoted(proposed.title)}, ${plural(proposed.roles.length, 'role')}, ${plural(proposed.phases.length, 'phase')}.`];
  const out: string[] = [];
  const scalars = [['Title', 'title'], ['Summary', 'summary'], ['Space', 'space'], ['Win condition', 'win'], ['Lose condition', 'lose']] as const;
  for (const [label, key] of scalars) {
    const [a, b] = [current[key], proposed[key]];
    if (a === b) continue;
    out.push(!b ? `${label} cleared.` : !a ? `${label} set to ${quoted(b)}.` : `${label} changed from ${quoted(a)} to ${quoted(b)}.`);
  }
  if (range(current.players) !== range(proposed.players)) out.push(`Players changed from ${range(current.players)} to ${range(proposed.players)}.`);
  for (const line of current.setup) if (!proposed.setup.includes(line)) out.push(`Setup line removed: ${quoted(line)}.`);
  for (const line of proposed.setup) if (!current.setup.includes(line)) out.push(`Setup line added: ${quoted(line)}.`);
  for (const g of current.gestures) if (!proposed.gestures.includes(g)) out.push(`Gesture removed: ${g}.`);
  for (const g of proposed.gestures) if (!current.gestures.includes(g)) out.push(`Gesture added: ${g}.`);
  for (const kind of PERIPHERAL_KINDS) {
    const [a, b] = [current.devices[kind] ?? 'player', proposed.devices[kind] ?? 'player'];
    if (a !== b) out.push(`The ${kind} changes from ${MODE_TEXT[a]} to ${MODE_TEXT[b]}.`);
  }
  for (const r of proposed.roles) {
    const was = current.roles.find((x) => x.id === r.id);
    if (!was) out.push(`Role added: ${r.name} (${r.kind}).`);
    else {
      const changed = (['name', 'kind', 'brief'] as const).filter((k) => was[k] !== r[k]);
      if (changed.length) out.push(`Role ${quoted(r.name)} changed: ${changed.join(', ')}.`);
    }
  }
  for (const r of current.roles) if (!proposed.roles.some((x) => x.id === r.id)) out.push(`Role removed: ${r.name}.`);
  for (const p of proposed.phases) {
    const was = current.phases.find((x) => x.id === p.id);
    if (!was) out.push(`Phase added: ${p.title || p.id} (${plural(p.steps.length, 'step')}).`);
    else {
      const changed: string[] = [];
      if (was.title !== p.title) changed.push('title');
      if (was.text !== p.text) changed.push('text');
      if (JSON.stringify(was.steps) !== JSON.stringify(p.steps)) changed.push(was.steps.length === p.steps.length ? 'steps' : `steps (${was.steps.length} to ${p.steps.length})`);
      if (changed.length) out.push(`Phase ${quoted(p.title || p.id)} changed: ${changed.join(', ')}.`);
    }
  }
  for (const p of current.phases) if (!proposed.phases.some((x) => x.id === p.id)) out.push(`Phase removed: ${p.title || p.id}.`);
  return out.length ? out : ['No changes.'];
}

/** The lint messages for the instructions against the current scene; a scene that does not parse is one line. */
export function lintMessages(instructions: Instructions, describe: () => SceneDescription): string[] {
  let scene: SceneDescription;
  try {
    scene = describe();
  } catch (e) {
    return [`Scene is invalid: ${e instanceof Error ? e.message : String(e)}`];
  }
  return lintInstructions(instructions, scene).map((w) => w.message);
}

/** True when the scene declares a player count other than the instructions' (a file or cloud version made elsewhere): Studio never writes that, but it can open one. */
export function playersMismatch(instructions: Instructions, describe: () => SceneDescription): boolean {
  try {
    const inputs = describe().inputs;
    return !!inputs && (inputs.players[0] !== instructions.players.min || inputs.players[1] !== instructions.players.max);
  } catch {
    return false;
  }
}

const PAD = 'padding:4px 12px';

export function createInstructionsPanel(project: Project, run: RunController, sendToChat: (text: string) => string | undefined): PanelView {
  const root = el('div', { class: 'pn', role: 'region', 'aria-label': 'Instructions', tabindex: -1 });
  const proposalBox = el('div');
  const lintBox = el('div');
  const formBox = el('div');
  const reportBox = el('div');
  root.append(proposalBox, lintBox, formBox, reportBox);
  const group = (t: string) => el('div', { class: 'pn-group' }, [t]);
  const items = (label: string, lines: string[]) => el('ul', { class: 'om-list', 'aria-label': label }, lines.map((t) => el('li', { class: 'om-sub' }, [t])));

  /** True while this panel's own edit is being applied: the form keeps its focus instead of being rebuilt. */
  let committing = false;
  const commit = (next: Instructions, rebuild: boolean): void => {
    committing = true;
    try {
      project.setInstructions(next);
    } finally {
      committing = false;
    }
    if (rebuild) buildForm();
  };
  const edit = (patch: (c: Instructions) => Partial<Instructions>, rebuild = false): void => {
    const c = project.instructions;
    if (c) commit(editInstructions(c, patch(c)), rebuild);
  };

  const field = (label: string, control: HTMLElement, name: string): HTMLElement => {
    control.setAttribute('aria-label', name);
    return el('label', { style: `display:grid;gap:2px;${PAD}` }, [label, control]);
  };
  const textInput = (value: string, onChange: (v: string) => void, placeholder: string): HTMLInputElement => {
    const input = el('input', { type: 'text', placeholder });
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    return input;
  };
  const textArea = (value: string, rows: number, onChange: (v: string) => void, placeholder: string): HTMLTextAreaElement => {
    const area = el('textarea', { rows, placeholder });
    area.value = value;
    area.addEventListener('change', () => onChange(area.value));
    return area;
  };
  const numberInput = (value: number, placeholder: string): HTMLInputElement => {
    const input = el('input', { type: 'number', min: 1, max: 32, placeholder });
    input.value = String(value);
    return input;
  };
  const selectOf = (options: readonly (readonly [string, string])[], value: string, onChange: (v: string) => void): HTMLSelectElement => {
    const select = el('select', {}, options.map(([v, label]) => el('option', { value: v }, [label])));
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    return select;
  };

  const rolesSection = (i: Instructions): Node[] => [
    group(`Roles (${i.roles.length})`),
    ...i.roles.flatMap((r) => [
      el('div', { class: 'om-sub', style: PAD }, [`Role ${r.id}`]),
      field('Name', textInput(r.name, (v) => edit((c) => ({ roles: c.roles.map((x) => (x.id === r.id ? { ...x, name: v } : x)) })), 'What players call this role, e.g. Referee'), `Name of role ${r.id}`),
      field('Kind', selectOf([['player', 'Player'], ['ref', 'Referee']], r.kind, (v) => edit((c) => ({ roles: c.roles.map((x) => (x.id === r.id ? { ...x, kind: v === 'ref' ? 'ref' : 'player' } : x)) }))), `Kind of role ${r.id}`),
      field('Brief', textArea(r.brief, 3, (v) => edit((c) => ({ roles: c.roles.map((x) => (x.id === r.id ? { ...x, brief: v } : x)) })), 'What this role does and knows, e.g. Starts each round and calls the winner'), `Brief of role ${r.id}`),
      el('div', { style: PAD }, [button('Remove', () => { const c = project.instructions; if (c) commit(removeRole(c, r.id), true); }, { variant: 'small', ariaLabel: `Remove role ${r.id}` })]),
    ]),
    el('div', { style: PAD }, [(() => {
      const add = button('Add role', () => { const c = project.instructions; if (c) commit(addRole(c), true); }, { variant: 'small' });
      add.disabled = i.roles.length >= INSTRUCTION_LIMITS.roles;
      return add;
    })()]),
  ];

  const phasesSection = (i: Instructions): Node[] => [
    group(`Phases (${i.phases.length})`),
    ...i.phases.flatMap((ph) => [
      el('div', { class: 'om-sub', style: PAD }, [`Phase ${ph.id}`]),
      field('Title', textInput(ph.title, (v) => edit((c) => ({ phases: c.phases.map((x) => (x.id === ph.id ? { ...x, title: v } : x)) })), 'e.g. Warm up'), `Title of phase ${ph.id}`),
      field('Text', textArea(ph.text, 3, (v) => edit((c) => ({ phases: c.phases.map((x) => (x.id === ph.id ? { ...x, text: v } : x)) })), 'What happens in this phase, in a sentence or two'), `Text of phase ${ph.id}`),
      field('Steps (one per line: role | what they do)', textArea(stepsText(ph.steps), 4, (v) => edit((c) => ({ phases: c.phases.map((x) => (x.id === ph.id ? { ...x, steps: parseStepsText(v) } : x)) })), 'One per line: role | what they do, e.g. runner | Pass the baton'), `Steps of phase ${ph.id}`),
      el('div', { style: PAD }, [button('Remove', () => { const c = project.instructions; if (c) commit(removePhase(c, ph.id), true); }, { variant: 'small', ariaLabel: `Remove phase ${ph.id}` })]),
    ]),
    el('div', { style: PAD }, [(() => {
      const add = button('Add phase', () => { const c = project.instructions; if (c) commit(addPhase(c), true); }, { variant: 'small' });
      add.disabled = i.phases.length >= INSTRUCTION_LIMITS.phases;
      return add;
    })()]),
  ];

  const buildForm = (): void => {
    const i = project.instructions;
    if (!i) {
      formBox.replaceChildren(
        el('p', { class: 'pn-empty' }, ['This game has no written instructions. Ask the Deep Agent in Instructions mode to write them, or start a blank set here.']),
        el('div', { style: PAD }, [button('Create instructions', () => project.setInstructions(blankInstructions()), { variant: 'small' })]),
      );
      return;
    }
    const min = numberInput(i.players.min, '2');
    const max = numberInput(i.players.max, '4');
    const players = () => {
      const problem = project.setPlayers(Math.round(Number(min.value)), Math.round(Number(max.value)));
      if (problem) announce(problem);
      buildForm();
    };
    min.addEventListener('change', players);
    max.addEventListener('change', players);
    min.setAttribute('aria-label', 'Fewest players');
    max.setAttribute('aria-label', 'Most players');
    const boxes = GESTURE_TYPES.map((g) => {
      const box = el('input', { type: 'checkbox', 'aria-label': `Gesture ${g}` });
      box.checked = i.gestures.includes(g);
      box.addEventListener('change', () => edit(() => ({ gestures: GESTURE_TYPES.filter((_, n) => boxes[n]!.checked) })));
      return box;
    });
    const modes = [['player', "Each player's own"], ['free', 'Free in the room'], ['passed', 'Passed between players']] as const;
    formBox.replaceChildren(
      group('Game'),
      field('Title', textInput(i.title, (v) => edit(() => ({ title: v })), 'The name players see, e.g. Relay Race'), 'Title'),
      field('Summary', textArea(i.summary, 3, (v) => edit(() => ({ summary: v })), 'What the game is, in a few sentences'), 'Summary'),
      field('Space', textArea(i.space, 2, (v) => edit(() => ({ space: v })), 'Where it is played, e.g. a clear 5 m by 5 m floor'), 'Space'),
      el('div', { style: `display:flex;gap:8px;align-items:center;${PAD}` }, ['Players', min, 'to', max]),
      field('Setup (one line each)', textArea(i.setup.join('\n'), 4, (v) => edit(() => ({ setup: v.split(/\r?\n/) })), 'One line each, e.g. Everyone stands in a line'), 'Setup'),
      el('div', { role: 'group', 'aria-label': 'Gestures', style: `display:flex;gap:12px;flex-wrap:wrap;${PAD}` }, GESTURE_TYPES.map((g, n) => el('label', {}, [boxes[n]!, ` ${g}`]))),
      ...PERIPHERAL_KINDS.map((kind) => field(`Device: ${kind}`, selectOf(modes, i.devices[kind] ?? 'player', (v) => edit((c) => ({ devices: { ...c.devices, [kind]: v as OwnershipMode } }))), `Who holds the ${kind}`)),
      ...rolesSection(i),
      ...phasesSection(i),
      group('Win'),
      field('How the game is won', textArea(i.win, 2, (v) => edit(() => ({ win: v })), 'e.g. The first team across the line wins'), 'Win condition'),
      group('Lose'),
      field('How the game is lost', textArea(i.lose, 2, (v) => edit(() => ({ lose: v })), 'e.g. Drop the baton and you are out'), 'Lose condition'),
    );
  };

  const refreshLint = (): void => {
    const i = project.instructions;
    if (!i) return lintBox.replaceChildren();
    const messages = lintMessages(i, () => project.description());
    const match = playersMismatch(i, () => project.description())
      ? [el('div', { style: PAD }, [button('Match the scene to the instructions', () => { const c = project.instructions; if (c) project.setPlayers(c.players.min, c.players.max); }, { variant: 'small' })])]
      : [];
    lintBox.replaceChildren(group('Scene check'), messages.length ? items('Scene check', messages) : el('p', { class: 'om-sub', role: 'status', style: PAD }, ['The scene agrees with the instructions.']), ...match);
  };

  const refreshProposal = (): void => {
    const p = project.proposal;
    if (!p) return proposalBox.replaceChildren();
    proposalBox.replaceChildren(
      group('Proposed instructions'),
      items('Proposed changes', instructionsDiff(project.instructions, p)),
      el('div', { style: `display:flex;gap:8px;${PAD}` }, [button('Accept', () => project.acceptProposal(), { variant: 'small' }), button('Reject', () => project.rejectProposal(), { variant: 'small' })]),
    );
  };

  let shown: PlaytestReport | null | undefined;
  const refreshReport = (): void => {
    if (shown === run.report) return;
    shown = run.report;
    reportBox.replaceChildren(group('Playtest report'), run.report ? renderPlaytest(run.report, sendToChat) : el('p', { class: 'pn-empty' }, ['Start a playtest in the Playtest panel to see what agents found unclear.']));
  };

  const offProject = project.onChange((c) => {
    if (c === 'open') {
      buildForm();
      refreshLint();
      refreshProposal();
    } else if (c === 'instructions') {
      if (!committing) buildForm();
      refreshLint();
      refreshProposal();
    } else if (c === 'scene') refreshLint();
    else if (c === 'proposal') refreshProposal();
  });
  const offRun = run.onChange(refreshReport);
  buildForm();
  refreshLint();
  refreshProposal();
  refreshReport();
  return {
    element: root,
    focus: () => (root.querySelector<HTMLElement>('input, textarea, select, button:not(:disabled)') ?? root).focus(),
    dispose: () => { offProject(); offRun(); },
  };
}
