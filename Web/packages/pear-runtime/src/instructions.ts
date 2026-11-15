// Game instructions: what players read and do in the real world (setup, roles, phases), parsed leniently, plus the lint that
// compares them with the scene. Pure, so Studio, the authoring agent and the tests share one answer.
import { GESTURE_TYPES, type GestureType } from '@pear/core';
import { OWNERSHIP_MODES, PERIPHERAL_KINDS, ownershipOf, type OwnershipMode, type PeripheralKind, type SceneDescription } from './scene';

export class InstructionsError extends Error {
  override name = 'InstructionsError';
}

/** Sizes keep a saved game small: the worst case is about 250 KB, well under the backend's 2 MiB JSON body. */
export const INSTRUCTION_LIMITS = { short: 300, long: 2000, id: 40, setup: 20, roles: 12, phases: 20, steps: 30 } as const;

export type RoleKind = 'player' | 'ref';

export interface InstructionRole {
  id: string;
  name: string;
  /** What this role does and knows, written for the person (or agent) playing it. */
  brief: string;
  /** Which `ctx.player.role` a player with this role runs as. */
  kind: RoleKind;
}

export interface InstructionStep {
  /** A role id; empty means every player. */
  role: string;
  do: string;
}

export interface InstructionPhase {
  id: string;
  title: string;
  text: string;
  steps: InstructionStep[];
}

export interface Instructions {
  title: string;
  summary: string;
  /** The physical space the game needs. */
  space: string;
  setup: string[];
  players: { min: number; max: number };
  /** Gestures the game uses. */
  gestures: GestureType[];
  /** Who holds each device kind; a kind that is missing means each player has their own. */
  devices: Partial<Record<PeripheralKind, OwnershipMode>>;
  roles: InstructionRole[];
  phases: InstructionPhase[];
  win: string;
  /** How a player or the team loses; every game needs one. */
  lose: string;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
/** Cut to the limit, then trim, so parsing the result again changes nothing. */
const text = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max).trim() : '');
const bound = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isInteger(x) ? Math.min(32, Math.max(1, x)) : fallback);

/** `id`, or `id-2`, `id-3`, ... (still within the id limit) when `used` has it. */
function unique(id: string, used: Set<string>): string {
  let out = id;
  for (let n = 2; used.has(out); n++) {
    const suffix = `-${n}`;
    out = id.slice(0, INSTRUCTION_LIMITS.id - suffix.length) + suffix;
  }
  used.add(out);
  return out;
}

/**
 * Reads instructions from untrusted JSON (a project file, cloud metadata or the authoring agent). Only a value that is not an
 * object throws; any wrong-typed field takes its default and any bad list entry is dropped, so the result is always usable.
 */
export function parseInstructions(raw: unknown): Instructions {
  if (!isObj(raw)) throw new InstructionsError('instructions: expected object');
  const L = INSTRUCTION_LIMITS;
  const p = Array.isArray(raw.players) ? { min: raw.players[0], max: raw.players[1] } : isObj(raw.players) ? raw.players : {};
  let [min, max] = [bound(p.min, 1), bound(p.max, 32)];
  if (min > max) [min, max] = [max, min];
  const gestures = new Set(arr(raw.gestures));
  const devices: Instructions['devices'] = {};
  const given = isObj(raw.devices) ? raw.devices : {};
  for (const kind of PERIPHERAL_KINDS) {
    const mode = given[kind];
    if ((OWNERSHIP_MODES as readonly unknown[]).includes(mode) && mode !== 'player') devices[kind] = mode as OwnershipMode;
  }
  const roleIds = new Set<string>();
  const roles: InstructionRole[] = [];
  for (const r of arr(raw.roles)) {
    if (!isObj(r)) continue;
    const id = text(r.id, L.id);
    if (!id || roleIds.has(id)) continue;
    roleIds.add(id);
    roles.push({ id, name: text(r.name, L.short) || id, brief: text(r.brief, L.long), kind: r.kind === 'ref' ? 'ref' : 'player' });
  }
  const phaseIds = new Set<string>();
  const phases: InstructionPhase[] = [];
  for (const ph of arr(raw.phases)) {
    if (!isObj(ph) || phases.length >= L.phases) continue;
    const steps: InstructionStep[] = [];
    for (const s of arr(ph.steps)) {
      if (!isObj(s) || typeof s.role !== 'string') continue;
      const todo = text(s.do, L.short);
      if (todo) steps.push({ role: text(s.role, L.id), do: todo });
    }
    phases.push({
      id: unique(text(ph.id, L.id) || `phase-${phases.length + 1}`, phaseIds),
      title: text(ph.title, L.short),
      text: text(ph.text, L.long),
      steps: steps.slice(0, L.steps),
    });
  }
  return {
    title: text(raw.title, L.short),
    summary: text(raw.summary, L.long),
    space: text(raw.space, L.long),
    setup: arr(raw.setup).map((s) => text(s, L.short)).filter(Boolean).slice(0, L.setup),
    players: { min, max },
    gestures: GESTURE_TYPES.filter((g) => gestures.has(g)),
    devices,
    roles: roles.slice(0, L.roles),
    phases,
    win: text(raw.win, L.long),
    lose: text(raw.lose, L.long),
  };
}

export type InstructionsWarningCode = 'players' | 'gesture-missing' | 'gesture-unused' | 'device' | 'step-role' | 'phase-empty' | 'win-missing' | 'lose-missing';

export interface InstructionsWarning {
  code: InstructionsWarningCode;
  message: string;
}

const range = (min: number, max: number): string => (min === max ? String(min) : `${min} to ${max}`);
const MODE_LABEL: Record<OwnershipMode, string> = { player: "each player's own", free: 'a free-floating room device', passed: 'passed between players' };

/**
 * What in the scene disagrees with the instructions. The instructions win: every message says what each side says so the
 * creator can fix `scene.json`. The players and gesture checks need the scene's `inputs` and are skipped without it.
 */
export function lintInstructions(instructions: Instructions, scene: SceneDescription): InstructionsWarning[] {
  const out: InstructionsWarning[] = [];
  const warn = (code: InstructionsWarningCode, message: string) => out.push({ code, message });
  if (!instructions.win) warn('win-missing', 'The instructions say nothing about how the game is won.');
  if (!instructions.lose) warn('lose-missing', 'The instructions say nothing about how the game is lost.');
  const inputs = scene.inputs;
  if (inputs) {
    const [min, max] = inputs.players;
    if (instructions.players.min !== min || instructions.players.max !== max) {
      warn('players', `The instructions say ${range(instructions.players.min, instructions.players.max)} players; scene.json says ${range(min, max)}.`);
    }
    for (const g of instructions.gestures) if (!inputs.gestures.includes(g)) warn('gesture-missing', `The instructions use the ${g} gesture; scene.json does not declare it.`);
    for (const g of inputs.gestures) if (!instructions.gestures.includes(g)) warn('gesture-unused', `scene.json declares the ${g} gesture; the instructions never use it.`);
  }
  for (const kind of PERIPHERAL_KINDS) {
    const said = instructions.devices[kind] ?? 'player';
    const actual = ownershipOf(scene.ownership, kind).mode;
    if (said !== actual) warn('device', `The instructions say the ${kind} is ${MODE_LABEL[said]}; scene.json says ${MODE_LABEL[actual]}.`);
  }
  const roleIds = new Set(instructions.roles.map((r) => r.id));
  for (const phase of instructions.phases) {
    if (!phase.steps.length) warn('phase-empty', `Phase '${phase.id}' has no steps.`);
    if (!roleIds.size) continue;
    for (const role of new Set(phase.steps.map((s) => s.role))) {
      if (role && !roleIds.has(role)) warn('step-role', `Phase '${phase.id}' has a step for the role '${role}', which is not declared.`);
    }
  }
  return out;
}
