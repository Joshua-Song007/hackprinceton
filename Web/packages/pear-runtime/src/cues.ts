// Shared cue library for the web phone page and Studio: the cue names a script passes to `self.audio.play(name)` and the
// notes each one plays. The iOS twin (Packages/PearOutput Cues.swift) must use the same names. Pure data: no Web Audio here.
export interface CueNote {
  /** Oscillator frequency in Hz. */
  hz: number;
  /** Length in ms. */
  ms: number;
  /** Start offset from the cue's start in ms (default 0). */
  at?: number;
  /** Oscillator shape (default sine). */
  wave?: 'sine' | 'square' | 'sawtooth' | 'triangle';
  /** Peak level 0..1 (default 0.2). */
  gain?: number;
}

export const CUES: Readonly<Record<string, readonly CueNote[]>> = {
  tick: [{ hz: 1200, ms: 40, wave: 'square', gain: 0.12 }],
  arming: [{ hz: 110, ms: 1200, wave: 'sawtooth', gain: 0.15 }, { hz: 112, ms: 1200, wave: 'sawtooth', gain: 0.15 }],
  fire: [{ hz: 900, ms: 60, wave: 'square', gain: 0.3 }, { hz: 120, ms: 220, at: 40, wave: 'sawtooth', gain: 0.3 }],
  win: [{ hz: 523, ms: 120 }, { hz: 659, ms: 120, at: 120 }, { hz: 784, ms: 240, at: 240 }],
  lose: [{ hz: 392, ms: 160, wave: 'triangle' }, { hz: 311, ms: 160, at: 160, wave: 'triangle' }, { hz: 233, ms: 320, at: 320, wave: 'triangle' }],
  fanfare: [{ hz: 523, ms: 120 }, { hz: 523, ms: 120, at: 140 }, { hz: 523, ms: 120, at: 280 }, { hz: 659, ms: 300, at: 420 }, { hz: 784, ms: 480, at: 760, wave: 'triangle' }],
};

export const CUE_NAMES: readonly string[] = Object.keys(CUES);

/** The notes for a cue name, or undefined for a name that is not in the library. */
export const cueNotes = (name: string): readonly CueNote[] | undefined => (Object.hasOwn(CUES, name) ? CUES[name] : undefined);
