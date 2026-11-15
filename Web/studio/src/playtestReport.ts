// The playtest report: what the agent players noted about the instructions (grouped by phase) and about the run itself, plus the
// text the report view shows and the prompt that carries the notes to the Deep Agent chat. Pure: no DOM, no run state.
import type { AgentNoteRecord, AgentStatus, Persona } from './agentPlayers';

export const PROMPT_LIMIT = 4000;
export const NO_PHASE_TITLE = 'Not tied to a phase';
export const EMPTY_TEXT = 'The agents flagged nothing.';

export interface PlaytestPlayer {
  id: string;
  persona: Persona;
  /** The instructions role's name, or '' when the player had none. */
  role: string;
  calls: number;
  status: AgentStatus;
  summary: string;
}

export interface PlaytestItem {
  line: string;
  why: string;
  from: string[];
  gameTime: number;
}

export interface PlaytestGroup {
  phase: string;
  title: string;
  items: PlaytestItem[];
}

export interface PlaytestReport {
  title: string;
  gameTime: number;
  lookedBack: boolean;
  players: PlaytestPlayer[];
  calls: number;
  groups: PlaytestGroup[];
  problems: { from: string; why: string }[];
}

export interface PlaytestInput {
  title: string;
  phases: { id: string; title: string }[];
  gameTime: number;
  players: PlaytestPlayer[];
  notes: readonly AgentNoteRecord[];
  lookedBack: boolean;
}

/** Notes about the instructions are grouped by phase (the instructions' order, then ids it does not know, then no phase) and the same note from several players is one item; notes about the run go to `problems`. */
export function buildPlaytestReport(input: PlaytestInput): PlaytestReport {
  const items = new Map<string, Map<string, PlaytestItem>>();
  const problems: { from: string; why: string }[] = [];
  const seenProblems = new Set<string>();
  for (const n of input.notes) {
    if (n.kind === 'run') {
      const key = `${n.from}|${n.why}`;
      if (seenProblems.has(key)) continue;
      seenProblems.add(key);
      problems.push({ from: n.from, why: n.why });
      continue;
    }
    const group = items.get(n.phase) ?? new Map<string, PlaytestItem>();
    items.set(n.phase, group);
    const key = `${n.line}|${n.why}`;
    const item = group.get(key);
    if (!item) group.set(key, { line: n.line, why: n.why, from: [n.from], gameTime: n.gameTime });
    else {
      if (!item.from.includes(n.from)) item.from.push(n.from);
      item.gameTime = Math.min(item.gameTime, n.gameTime);
    }
  }
  const titles = new Map(input.phases.map((p) => [p.id, p.title]));
  const known = input.phases.map((p) => p.id).filter((id) => items.has(id));
  const unknown = [...items.keys()].filter((id) => id !== '' && !titles.has(id));
  const order = [...known, ...unknown, ...(items.has('') ? [''] : [])];
  const groups = order.map((phase) => ({
    phase,
    title: phase === '' ? NO_PHASE_TITLE : titles.get(phase) || phase,
    items: [...items.get(phase)!.values()].sort((a, b) => a.gameTime - b.gameTime),
  }));
  return {
    title: input.title,
    gameTime: input.gameTime,
    lookedBack: input.lookedBack,
    players: input.players,
    calls: input.players.reduce((sum, p) => sum + p.calls, 0),
    groups,
    problems,
  };
}

const seconds = (t: number) => `${Math.round(t)} s`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The revise prompt for the Deep Agent chat: the notes by phase, cut to PROMPT_LIMIT characters by dropping whole items. '' when no player noted anything about the instructions. */
export function playtestPrompt(report: PlaytestReport): string {
  if (!report.groups.length) return '';
  const head = `Playtest of "${report.title || 'the game'}": ${plural(report.players.length, 'agent player')}, ${seconds(report.gameTime)} of game time. They flagged these parts of the instructions:`;
  const tail = 'Revise the instructions to fix these. Keep everything else.';
  const lines: string[] = [];
  for (const g of report.groups) {
    lines.push(g.phase === '' ? `${NO_PHASE_TITLE}:` : `Phase "${g.title}":`);
    for (const i of g.items) lines.push(`- ${i.line ? `"${i.line}" ` : ''}(${i.from.join(', ')}): ${i.why}`);
  }
  const build = (body: string[]) => [head, ...body, tail].join('\n');
  if (build(lines).length <= PROMPT_LIMIT) return build(lines);
  const reserve = '… and 99999 more'.length + 1;
  const kept: string[] = [];
  for (const l of lines) {
    if (build([...kept, l]).length + reserve > PROMPT_LIMIT) break;
    kept.push(l);
  }
  while (kept.length && !kept[kept.length - 1]!.startsWith('- ')) kept.pop();
  const dropped = lines.filter((l) => l.startsWith('- ')).length - kept.filter((l) => l.startsWith('- ')).length;
  return build([...kept, `… and ${dropped} more`]);
}

export interface PlaytestLines {
  summary: string;
  players: string[];
  groups: { title: string; items: string[] }[];
  problems: string[];
  /** Shown when nothing was flagged ('' otherwise). */
  empty: string;
}

/** Everything the report view shows, as text. */
export function playtestLines(report: PlaytestReport): PlaytestLines {
  return {
    summary: `${plural(report.players.length, 'agent player')}, ${plural(report.calls, 'call')}, ${seconds(report.gameTime)} of game time. ${report.lookedBack ? 'Look back done.' : 'Stopped before the look back.'}`,
    players: report.players.map((p) => `${p.id}: ${p.persona}${p.role ? `, ${p.role}` : ''}, ${plural(p.calls, 'call')}${p.summary ? `. ${p.summary}` : ''}`),
    groups: report.groups.map((g) => ({ title: g.title, items: g.items.map((i) => `${i.line ? `"${i.line}" ` : ''}(${i.from.join(', ')}, ${seconds(i.gameTime)}): ${i.why}`) })),
    problems: report.problems.map((p) => `${p.from}: ${p.why}`),
    empty: report.groups.length || report.problems.length ? '' : EMPTY_TEXT,
  };
}

/** Sends the report's prompt to the chat. '' when it went; otherwise a sentence for the creator. */
export function sendReport(report: PlaytestReport, sendToChat: (text: string) => string | undefined): string {
  const text = playtestPrompt(report);
  if (!text) return 'Nothing to send.';
  return sendToChat(text) ?? '';
}
