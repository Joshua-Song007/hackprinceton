// Words and rows for the Test view: what stands between the game and a useful test, who is playing, and what each device is.
// Pure, so the panel (DOM only) stays thin and these answers are tested.
import type { Check } from './gamePanel';
import { limitsText } from './project';

export type ReadinessLevel = 'fix' | 'optional' | 'done';

export interface ReadinessRow {
  level: ReadinessLevel;
  label: string;
  hint?: string;
  fix?: Check['fix'];
}

export interface Readiness {
  /** What the game declares it needs ("Needs no input; 1 to 2 players"), null when it declares nothing. */
  needs: string | null;
  rows: ReadinessRow[];
  /** Rows at level `fix`: the only ones that count against "Ready to play". */
  fixes: number;
}

/**
 * Turns the game's checks into the Test view's readiness rows. The last run's state belongs to the header, so it is dropped;
 * a check that is met is hidden, except the declared needs (kept as the summary) and the last publish time.
 */
export function readinessRows(checks: readonly Check[]): Readiness {
  const needs = checks.find((c) => c.ok && c.label.startsWith('Needs '))?.label ?? null;
  const rows: ReadinessRow[] = [];
  for (const c of checks) {
    if (c.kind === 'run') continue;
    if (c.ok) {
      if (c.kind === 'publish' && c.label.startsWith('Last published: ')) rows.push({ level: 'done', label: c.label });
      continue;
    }
    const level: ReadinessLevel = c.optional || c.kind === 'publish' ? 'optional' : 'fix';
    rows.push({ level, label: c.label, ...(c.hint ? { hint: c.hint } : {}), ...(c.fix ? { fix: c.fix } : {}) });
  }
  return { needs, rows, fixes: rows.filter((r) => r.level === 'fix').length };
}

export function readinessSummary(fixes: number): string {
  return fixes === 0 ? 'Ready to play' : fixes === 1 ? '1 thing to fix' : `${fixes} things to fix`;
}

/** One phrasing for the player count, used by the Test panel and the status bar so they cannot disagree. */
export function playingText(count: number, limits: { min: number; max: number }): string {
  return `${count} playing · allows ${limitsText(limits)}`;
}

const SLOT_WORDS: Record<string, string> = { head: 'Worn on the head', hand: 'Held in hand', leftWrist: 'Worn on the left wrist' };

export const slotWords = (slot: string): string => SLOT_WORDS[slot] ?? slot;

const lowerFirst = (s: string): string => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** "Held in hand · each player has their own": where the device is worn and who holds it. */
export function deviceCaption(slot: string, holding: string): string {
  return `${slotWords(slot)} · ${lowerFirst(holding)}`;
}

/** What the Devices list means: set by the game, or the creator's own list remembered in this browser. */
export function devicesSubtitle(listed: boolean, needsInput: boolean): string {
  if (listed) return 'The game lists these devices, so you get exactly them.';
  return needsInput ? 'Remembered in this browser (the game lists none).' : 'The game needs no input. These devices are remembered in this browser.';
}

export function emptyPlayersText(min: number): string {
  return `Nobody is playing yet. Play starts with ${min} player${min === 1 ? '' : 's'}; add more here once it runs.`;
}

/** The header's run sentence: the run status text, or a plain word when it is empty. */
export function runLine(statusText: string, running: boolean): string {
  return statusText.trim() || (running ? 'Running' : 'Stopped');
}
