// One driver per agent player: every so often it asks the Deep Agent runtime what to do (holding the run's clock while the agent
// thinks), then carries out the answer one action at a time through the host. Time here is the pause clock's, in seconds.
import { parseActions, type Action, type Observation } from '@pear/runtime';
import type { AgentTransport, DecideRequest } from './agentTransport';
import type { PauseClock } from './pauseClock';

export const PERSONAS = ['follows', 'skims', 'cheats', 'confused'] as const;
export type Persona = (typeof PERSONAS)[number];

export const AGENT_EVERY_S = 1.5;
export const AGENT_CALL_CAP = 60;
export const AGENT_WALK_TIMEOUT_S = 10;
export const AGENT_BACKOFF_S = 10;

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
}

export class AgentDriver {
  status: AgentStatus = 'idle';
  calls = 0;
  readonly notes: AgentNoteRecord[] = [];
  lastSay = '';
  private queue: Action[] = [];
  private current: { kind: 'wait' | 'walk'; until: number } | null = null;
  private acting = false;
  private nextAt = 0;
  private thinking = false;
  private disposed = false;
  readonly seat: AgentSeat;
  private release: (() => void) | null = null;
  private seen = new Set<string>();
  private every: number;
  private cap: number;
  private walkTimeout: number;
  private backoff: number;

  constructor(private o: AgentDriverOptions) {
    this.seat = o.seat;
    this.every = o.every ?? AGENT_EVERY_S;
    this.cap = o.cap ?? AGENT_CALL_CAP;
    this.walkTimeout = o.walkTimeout ?? AGENT_WALK_TIMEOUT_S;
    this.backoff = o.backoff ?? AGENT_BACKOFF_S;
    this.nextAt = this.seconds();
  }

  private seconds(): number {
    return this.o.clock.now() / 1000;
  }

  /** Called every 100 ms by the run: advances the current plan, or asks for a new one when it is time. */
  tick(): void {
    if (this.disposed || this.thinking || this.status === 'limit') return;
    const now = this.seconds();
    if (this.current) {
      const done = this.current.kind === 'wait' ? now >= this.current.until : !this.o.host.walking() || now >= this.current.until;
      if (!done) return;
      this.current = null;
    }
    while (!this.current && this.queue.length) {
      const action = this.queue.shift()!;
      if (action.type === 'wait') this.current = { kind: 'wait', until: now + action.seconds };
      else {
        if (action.type === 'say') this.lastSay = action.text;
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
    if (now >= this.nextAt) void this.decide();
  }

  private note(entry: Omit<AgentNoteRecord, 'from' | 'gameTime'>, gameTime: number): void {
    const key = `${entry.phase}|${entry.line}|${entry.why}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.notes.push({ from: this.o.id, gameTime, ...entry });
  }

  private async decide(): Promise<void> {
    const observation = this.o.host.observation();
    if (this.calls >= this.cap) {
      this.status = 'limit';
      this.note({ phase: '', line: '', why: `Agent call limit reached (${this.cap}); this player stopped acting.` }, observation.gameTime);
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
    this.release = release;
    this.o.clock.hold();
    try {
      const { role, instructions } = this.o.host.intro();
      const reply = await this.o.transport.decide({
        run: this.o.run, player: this.o.id, persona: this.o.seat.persona, role, instructions, observation, game_time: observation.gameTime,
      });
      if (this.disposed) return;
      for (const n of reply.unsure) this.note(n, observation.gameTime);
      this.queue = parseActions(reply.actions);
      this.acting = true;
      this.nextAt = this.seconds();
    } catch (e) {
      if (this.disposed) return;
      this.note({ phase: '', line: '', why: e instanceof Error ? e.message : String(e) }, observation.gameTime);
      this.queue = [];
      this.acting = false;
      this.nextAt = this.seconds() + this.backoff;
    } finally {
      release();
      this.release = null;
      if (!this.disposed) {
        this.thinking = false;
        this.status = this.queue.length ? 'acting' : 'idle';
      }
    }
  }

  /** Stops the driver: no more requests, an answer still on its way is dropped, and the clock hold it owns is given back. */
  dispose(): void {
    this.disposed = true;
    this.status = 'stopped';
    this.queue = [];
    this.current = null;
    this.release?.();
  }
}
