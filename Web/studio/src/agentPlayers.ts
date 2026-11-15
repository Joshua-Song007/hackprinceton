// One driver per agent player: every so often it asks the Deep Agent runtime what to do (holding the run's clock while the agent
// thinks), then carries out the answer one action at a time through the host. Time here is the pause clock's, in seconds.
import { parseActions, type Action, type Observation } from '@pear/runtime';
import type { AgentTransport, DecideRequest } from './agentTransport';
import type { PauseClock } from './pauseClock';
import { describeAction, describeCue, describeUnsure, type AgentLogEntry } from './playtestPlan';

export const PERSONAS = ['follows', 'skims', 'cheats', 'confused'] as const;
export type Persona = (typeof PERSONAS)[number];

export const AGENT_EVERY_S = 1.5;
export const AGENT_CALL_CAP = 60;
export const AGENT_WALK_TIMEOUT_S = 10;
export const AGENT_BACKOFF_S = 10;
/** Failed decides in a row after which an agent gives up: a plugin with no key would otherwise spend the whole budget failing. */
export const AGENT_MAX_FAILURES = 3;
const LOG_LIMIT = 200;

/** Who an agent player is: its persona and the instructions role it plays ('' for none). */
export interface AgentSeat {
  persona: Persona;
  role: string;
}

export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'limit' | 'stopped';

/** A note from an agent about instructions that were unclear, missing or wrong for it (or a failed call), for the playtest report. */
export interface AgentNoteRecord {
  from: string;
  gameTime: number;
  phase: string;
  line: string;
  why: string;
  /** 'unsure' is about the instructions; 'run' is about the run itself (a failed call, the call limit, a failed look back). */
  kind: 'unsure' | 'run';
}

/** What a driver needs from the run it plays in. */
export interface AgentHost {
  observation(): Observation;
  /** Carries out one action (instant ones, or the start of a walk). The host adds a note cue itself for what cannot be done. */
  apply(action: Action): void;
  /** True while the player is still walking to a goal. */
  walking(): boolean;
  /** The role and instructions this player was handed. */
  intro(): { role: DecideRequest['role']; instructions: unknown };
  /** Game seconds since the run began, for the play-by-play. */
  gameTime(): number;
}

export interface AgentDriverOptions {
  id: string;
  run: string;
  seat: AgentSeat;
  clock: Pick<PauseClock, 'now' | 'hold' | 'release'>;
  transport: AgentTransport;
  host: AgentHost;
  every?: number;
  cap?: number;
  walkTimeout?: number;
  backoff?: number;
  /** The call cap is a playtest budget the creator chose, so reaching it is not a problem to report. */
  quiet?: boolean;
}

export class AgentDriver {
  status: AgentStatus = 'idle';
  calls = 0;
  readonly notes: AgentNoteRecord[] = [];
  lastSay = '';
  summary = '';
  looked = false;
  lastGameTime = 0;
  /** What this agent did, heard and was unsure about, oldest first (the play-by-play). */
  readonly log: AgentLogEntry[] = [];
  private failures = 0;
  private failed = false;
  private currentText = '';
  private queue: Action[] = [];
  private current: { kind: 'wait' | 'walk'; until: number } | null = null;
  private acting = false;
  private nextAt = 0;
  private thinking = false;
  private disposed = false;
  readonly seat: AgentSeat;
  readonly id: string;
  private releases = new Set<() => void>();
  private seen = new Set<string>();
  private every: number;
  private cap: number;
  private walkTimeout: number;
  private backoff: number;

  constructor(private o: AgentDriverOptions) {
    this.seat = o.seat;
    this.id = o.id;
    this.every = o.every ?? AGENT_EVERY_S;
    this.cap = o.cap ?? AGENT_CALL_CAP;
    this.walkTimeout = o.walkTimeout ?? AGENT_WALK_TIMEOUT_S;
    this.backoff = o.backoff ?? AGENT_BACKOFF_S;
    this.nextAt = this.seconds();
  }

  private seconds(): number {
    return this.o.clock.now() / 1000;
  }

  private addLog(kind: AgentLogEntry['kind'], text: string, gameTime = this.o.host.gameTime()): void {
    this.log.push({ gameTime, from: this.o.id, kind, text });
    if (this.log.length > LOG_LIMIT) this.log.shift();
  }

  /** How many decisions this agent may make. */
  get callLimit(): number {
    return this.cap;
  }

  /** What the agent is doing right now, in words, for its card. */
  get doing(): string {
    if (this.looked) return this.disposed ? 'Done' : 'Looking back...';
    if (this.disposed) return 'Stopped';
    if (this.failed) return 'Stopped: the Deep Agent reported errors';
    if (this.status === 'limit') return 'Out of decisions';
    if (this.thinking) return 'Thinking...';
    return this.currentText || 'Waiting';
  }

  /** True once the agent will do nothing more: its decisions are used up (or it gave up after errors) and nothing is in flight or queued. */
  get exhausted(): boolean {
    return (this.calls >= this.cap || this.failed) && !this.thinking && !this.current && this.queue.length === 0;
  }

  /** Called every 100 ms by the run: advances the current plan, or asks for a new one when it is time. */
  tick(): void {
    if (this.disposed || this.looked || this.thinking || this.status === 'limit') return;
    const now = this.seconds();
    if (this.current) {
      const done = this.current.kind === 'wait' ? now >= this.current.until : !this.o.host.walking() || now >= this.current.until;
      if (!done) return;
      this.current = null;
    }
    while (!this.current && this.queue.length) {
      const action = this.queue.shift()!;
      this.currentText = describeAction(action);
      if (action.type === 'wait') this.current = { kind: 'wait', until: now + action.seconds };
      else {
        if (action.type === 'say') this.lastSay = action.text;
        this.addLog('did', this.currentText);
        this.o.host.apply(action);
        if (action.type === 'walk_to' && this.o.host.walking()) this.current = { kind: 'walk', until: now + this.walkTimeout };
      }
    }
    if (this.current || this.queue.length) {
      this.status = 'acting';
      return;
    }
    if (this.acting) {
      this.acting = false;
      this.nextAt = now + this.every;
    }
    this.status = 'idle';
    this.currentText = '';
    if (now >= this.nextAt) void this.decide();
  }

  private note(entry: Omit<AgentNoteRecord, 'from' | 'gameTime'>, gameTime: number): void {
    const key = `${entry.kind}|${entry.phase}|${entry.line}|${entry.why}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.notes.push({ from: this.o.id, gameTime, ...entry });
    this.addLog(entry.kind === 'unsure' ? 'unsure' : 'problem', entry.kind === 'unsure' ? describeUnsure(entry) : entry.why, gameTime);
  }

  private async decide(): Promise<void> {
    const observation = this.o.host.observation();
    this.lastGameTime = observation.gameTime;
    for (const c of observation.heard) this.addLog(c.kind === 'note' ? 'problem' : 'heard', describeCue(c), observation.gameTime);
    if (this.calls >= this.cap) {
      this.status = 'limit';
      if (!this.o.quiet) this.note({ phase: '', line: '', why: `Agent call limit reached (${this.cap}); this player stopped acting.`, kind: 'run' }, observation.gameTime);
      return;
    }
    this.calls++;
    this.thinking = true;
    this.status = 'thinking';
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.o.clock.release();
    };
    this.releases.add(release);
    this.o.clock.hold();
    try {
      const { role, instructions } = this.o.host.intro();
      const reply = await this.o.transport.decide({
        run: this.o.run, player: this.o.id, persona: this.o.seat.persona, role, instructions, observation, game_time: observation.gameTime,
      });
      if (this.disposed || this.looked) return;
      for (const n of reply.unsure) this.note({ ...n, kind: 'unsure' }, observation.gameTime);
      this.queue = parseActions(reply.actions);
      this.failures = 0;
      this.acting = true;
      this.nextAt = this.seconds();
    } catch (e) {
      if (this.disposed || this.looked) return;
      this.note({ phase: '', line: '', why: e instanceof Error ? e.message : String(e), kind: 'run' }, observation.gameTime);
      this.queue = [];
      this.acting = false;
      this.nextAt = this.seconds() + this.backoff;
      if (++this.failures >= AGENT_MAX_FAILURES) {
        this.failed = true;
        this.addLog('problem', `stopped after ${AGENT_MAX_FAILURES} failed calls in a row`, observation.gameTime);
      }
    } finally {
      release();
      this.releases.delete(release);
      if (!this.disposed && !this.looked) {
        this.thinking = false;
        this.status = this.failed ? 'limit' : this.queue.length ? 'acting' : 'idle';
      }
    }
  }

  /** The end-of-run look back: no more decisions, one `report` call (holding the clock), its notes and summary kept, then the driver stops. */
  async lookBack(): Promise<void> {
    if (this.disposed || this.looked) return;
    this.looked = true;
    this.status = 'thinking';
    this.queue = [];
    this.current = null;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.o.clock.release();
    };
    this.releases.add(release);
    this.o.clock.hold();
    try {
      const reply = await this.o.transport.report({ run: this.o.run, player: this.o.id });
      if (this.disposed) return;
      for (const n of reply.unsure) this.note({ ...n, kind: 'unsure' }, this.lastGameTime);
      this.summary = reply.summary;
    } catch (e) {
      if (this.disposed) return;
      this.note({ phase: '', line: '', why: `Look back failed: ${e instanceof Error ? e.message : String(e)}`, kind: 'run' }, this.lastGameTime);
    } finally {
      release();
      this.releases.delete(release);
      this.dispose();
    }
  }

  /** Stops the driver: no more requests, an answer still on its way is dropped, and the clock hold it owns is given back. */
  dispose(): void {
    this.disposed = true;
    this.status = 'stopped';
    this.queue = [];
    this.current = null;
    for (const r of [...this.releases]) r();
  }
}
