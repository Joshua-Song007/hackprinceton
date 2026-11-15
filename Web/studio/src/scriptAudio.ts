// Plays what client scripts ask for with `self.audio` (Web Audio for built-in sounds, speechSynthesis for speak).
// Only the creator's own player gets one; server scripts have no `self`, so they cannot reach it.
import type { ScriptOutput } from '@pear/script';

/** Built-in sounds by name: oscillator frequency in Hz and length in ms. Add a row for a new one. */
const SOUNDS: Record<string, { hz: number; ms: number }> = { beep: { hz: 880, ms: 200 } };

export type AudioOutput = Extract<ScriptOutput, { kind: 'audio' }>;

export interface ScriptAudioEnv {
  /** Called once, on the first sound. Undefined when Web Audio is unavailable (Node tests). */
  createContext?: () => AudioContext;
  speech?: SpeechSynthesis;
  makeUtterance?: (text: string) => SpeechSynthesisUtterance;
  warn?: (message: string) => void;
}

export class ScriptAudio {
  private ctx: AudioContext | undefined;
  private playing = new Set<OscillatorNode>();
  private env: ScriptAudioEnv;

  constructor(env: ScriptAudioEnv = {}) {
    const g = globalThis as { AudioContext?: typeof AudioContext; speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance };
    this.env = {
      createContext: g.AudioContext ? () => new g.AudioContext!() : undefined,
      speech: g.speechSynthesis,
      makeUtterance: g.SpeechSynthesisUtterance ? (t) => new g.SpeechSynthesisUtterance!(t) : undefined,
      warn: (m) => console.warn(m),
      ...env,
    };
  }

  handle(o: AudioOutput): void {
    if (o.action === 'play') this.play(o.sound ?? '');
    else if (o.action === 'speak') this.speak(o.text ?? '');
    else this.stop();
  }

  private play(name: string): void {
    const sound = Object.hasOwn(SOUNDS, name) ? SOUNDS[name] : undefined;
    if (!sound) return this.env.warn?.(`audio: unknown sound '${name}' (built-in: ${Object.keys(SOUNDS).join(', ')})`);
    if (!this.env.createContext) return this.env.warn?.('audio: Web Audio is not available here');
    this.ctx ??= this.env.createContext();
    const ctx = this.ctx;
    void ctx.resume?.();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = sound.hz;
    gain.gain.value = 0.2;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => this.playing.delete(osc);
    this.playing.add(osc);
    osc.start();
    osc.stop(ctx.currentTime + sound.ms / 1000);
  }

  private speak(text: string): void {
    if (!this.env.speech || !this.env.makeUtterance) return this.env.warn?.('audio: speech is not available here');
    this.env.speech.speak(this.env.makeUtterance(text));
  }

  /** Stops every playing built-in sound and any speech. */
  stop(): void {
    for (const osc of this.playing) osc.stop();
    this.playing.clear();
    this.env.speech?.cancel();
  }
}
