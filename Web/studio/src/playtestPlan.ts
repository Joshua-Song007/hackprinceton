// What a playtest is made of, in plain words: who plays (a crew of behaviours), how long (a call budget), which role each player
// takes, what is ready before Start, and how an agent's actions and cues read in the play-by-play. Pure: no DOM, no run state.
import type { Action, Cue } from '@pear/runtime';
import type { AgentStatus, Persona } from './agentPlayers';

export type CrewId = 'realistic' | 'careful' | 'first-timers' | 'rule-benders' | 'mix';

export interface Crew {
  id: CrewId;
  label: string;
  personas: readonly Persona[];
}

export const CREWS: readonly Crew[] = [
  { id: 'realistic', label: 'A realistic group', personas: ['follows', 'skims', 'confused'] },
  { id: 'careful', label: 'Everyone careful', personas: ['follows'] },
  { id: 'first-timers', label: 'Everyone a first-timer', personas: ['confused'] },
  { id: 'rule-benders', label: 'Rule-benders and a careful one', personas: ['cheats', 'follows'] },
  { id: 'mix', label: 'One of each', personas: ['follows', 'skims', 'cheats', 'confused'] },
];

export const DEFAULT_CREW: CrewId = 'realistic';

export const PERSONA_LABELS: Record<Persona, string> = {
  follows: 'Careful: reads and follows every step',
  skims: 'Skimmer: remembers the gist, misses details',
  cheats: 'Rule-bender: looks for loopholes',
  confused: 'First-timer: unsure what things mean',
};

/** The behaviour of the n-th player (counting from 0) in a crew. */
export function personaFor(crew: CrewId, n: number): Persona {
  const personas = (CREWS.find((c) => c.id === crew) ?? CREWS[0]!).personas;
  return personas[n % personas.length]!;
}

export interface CallBudget {
  id: 'quick' | 'normal' | 'thorough';
  label: string;
  /** Decisions each agent may make; 60 is the most one player may use. */
  calls: number;
}

export const CALL_BUDGETS: readonly CallBudget[] = [
  { id: 'quick', label: 'Quick (about 20 decisions each)', calls: 20 },
  { id: 'normal', label: 'Normal (about 40 decisions each)', calls: 40 },
  { id: 'thorough', label: 'Thorough (up to 60 decisions each)', calls: 60 },
];

export const DEFAULT_BUDGET = 40;

export const costText = (players: number, calls: number): string => `Up to ${players * calls} Deep Agent calls (${players} ${players === 1 ? 'player' : 'players'} x ${calls} decisions each).`;

/** The role id each player takes: every referee role once, then the player roles in turn; '' for all when the game has no roles. */
export function assignRoles(roles: readonly { id: string; kind: 'player' | 'ref' }[], count: number): string[] {
  const refs = roles.filter((r) => r.kind === 'ref');
  const players = roles.filter((r) => r.kind === 'player');
  const out: string[] = [];
  for (const r of refs) if (out.length < count) out.push(r.id);
  const pool = players.length ? players : refs;
  for (let n = 0; out.length < count; n++) out.push(pool.length ? pool[n % pool.length]!.id : '');
  return out;
}

/** Who each of `count` players is: a behaviour from the crew and a role from the instructions. */
export function seatCrew(count: number, crew: CrewId, roles: readonly { id: string; kind: 'player' | 'ref' }[]): { persona: Persona; role: string }[] {
  const assigned = assignRoles(roles, count);
  return assigned.map((role, n) => ({ persona: personaFor(crew, n), role }));
}

const fixed = (n: number): string => n.toFixed(1);

/** An action as the play-by-play says it: "walks to x 2.0, z 3.0". */
export function describeAction(a: Action): string {
  switch (a.type) {
    case 'walk_to': return `walks to x ${fixed(a.x)}, z ${fixed(a.z)}`;
    case 'look_at': return 'player' in a ? `looks at ${a.player}` : `looks toward x ${fixed(a.x)}, z ${fixed(a.z)}`;
    case 'gesture': return `does a ${a.gesture}`;
    case 'give_device': return `gives the ${a.device} to ${a.to}`;
    case 'say': return `says "${a.text}"`;
    case 'wait': return `waits ${a.seconds} s`;
  }
}

/** Something a player felt or heard, as the play-by-play says it. */
export function describeCue(c: Cue): string {
  switch (c.kind) {
    case 'speech': return `hears ${c.from ?? 'someone'} say "${c.text}"`;
    case 'haptic': return `feels a buzz: ${c.text}`;
    case 'audio': return `hears a sound: ${c.text}`;
    case 'note': return `could not: ${c.text}`;
  }
}

/** A note about the instructions, as the play-by-play says it. */
export function describeUnsure(n: { phase: string; line: string; why: string }): string {
  return `was not sure${n.line ? ` about "${n.line}"` : ''}${n.phase ? ` (phase ${n.phase})` : ''}: ${n.why}`;
}

export interface AgentLogEntry {
  gameTime: number;
  from: string;
  kind: 'did' | 'heard' | 'unsure' | 'problem';
  text: string;
}

/** One play-by-play line: "12 s  player-2 (Referee) says "ready?"". `nameOf` gives how the player is shown. */
export const logLine = (entry: AgentLogEntry, nameOf: (id: string) => string = (id) => id): string => `${Math.round(entry.gameTime)} s  ${nameOf(entry.from)} ${entry.text}`;

export interface ReadinessInput {
  hasInstructions: boolean;
  hasPlugin: boolean;
  limits: { min: number; max: number };
  players: number;
}

export interface ReadinessItem {
  id: 'instructions' | 'plugin' | 'players';
  ok: boolean;
  label: string;
  hint: string;
}

const allowed = (l: { min: number; max: number }): string => (l.min === l.max ? String(l.min) : `${l.min} to ${l.max}`);

/** What must be true before a playtest can start, each with a word on why. */
export function readiness(i: ReadinessInput): ReadinessItem[] {
  const inside = Number.isInteger(i.players) && i.players >= i.limits.min && i.players <= i.limits.max;
  return [
    { id: 'instructions', ok: i.hasInstructions, label: i.hasInstructions ? 'Instructions written' : 'Instructions not written', hint: 'Agents play from the written instructions.' },
    { id: 'plugin', ok: i.hasPlugin, label: i.hasPlugin ? 'Deep Agent plugin installed' : 'Deep Agent plugin not installed', hint: 'The agents run inside the Deep Agent plugin.' },
    { id: 'players', ok: inside, label: inside ? `${i.players} players, inside the limit (the game allows ${allowed(i.limits)})` : `${Number.isFinite(i.players) ? i.players : 'That many'} players is outside the limit (the game allows ${allowed(i.limits)})`, hint: 'The player limit comes from the instructions.' },
  ];
}

/** The first thing that stops a playtest from starting, as a sentence; undefined when it can start. */
export function startProblem(i: ReadinessInput): string | undefined {
  const [instructions, plugin, players] = readiness(i);
  if (!instructions!.ok) return "Write the game's instructions first (the Instructions panel).";
  if (!plugin!.ok) return 'Install the Deep Agent plugin first.';
  if (!players!.ok) return `Choose between ${i.limits.min} and ${i.limits.max} players.`;
  return undefined;
}

/** How an agent's state reads on its card when it is not doing an action. */
export const STATUS_TEXT: Record<AgentStatus, string> = { idle: 'Waiting', thinking: 'Thinking...', acting: 'Acting', limit: 'Out of decisions', stopped: 'Stopped' };
