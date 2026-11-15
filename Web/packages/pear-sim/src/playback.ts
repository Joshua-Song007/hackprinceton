// .usis.jsonl playback on the device clock (t of each packet, ms from the start of the recording).
import { validateUsis, type UsisPacket } from '@pear/core';

/** One JSON packet per line; blank lines skipped. Throws on the first invalid line with its 1-based number. */
export function parseUsisJsonl(text: string): UsisPacket[] {
  const packets: UsisPacket[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`line ${i + 1}: not JSON`);
    }
    const result = validateUsis(json);
    if (!result.ok) throw new Error(`line ${i + 1}: ${result.errors.join('; ')}`);
    packets.push(result.packet);
  });
  return packets.sort((a, b) => a.t - b.t);
}

export interface PlaybackOptions {
  loop?: boolean;
  /** Host clock in ms. Defaults to performance.now. */
  now?: () => number;
  /** Called after the last packet when not looping. */
  onEnd?: () => void;
  /** Poll interval of the timer in ms. */
  pollMs?: number;
}

export class UsisPlayer {
  private packets: UsisPacket[];
  private emit: (packet: UsisPacket) => void;
  private options: PlaybackOptions;
  private now: () => number;
  private next = 0;
  private startedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(packets: UsisPacket[], emit: (packet: UsisPacket) => void, options: PlaybackOptions = {}) {
    this.packets = packets;
    this.emit = emit;
    this.options = options;
    this.now = options.now ?? (() => performance.now());
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.next = 0;
    this.startedAt = this.now();
    this.timer = setInterval(() => this.advance(this.now() - this.startedAt), this.options.pollMs ?? 10);
    this.advance(0);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Emits every packet due at `elapsedMs` of the recording. Public so tests can drive the clock. */
  advance(elapsedMs: number): void {
    while (this.next < this.packets.length && this.packets[this.next]!.t <= elapsedMs) this.emit(this.packets[this.next++]!);
    if (this.next < this.packets.length) return;
    if (this.options.loop && this.packets.length > 0) {
      this.next = 0;
      this.startedAt = this.now();
    } else {
      this.stop();
      this.options.onEnd?.();
    }
  }
}
