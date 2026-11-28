// Synth patch sets per music instrument (#54). Pure data.
import type { Instrument } from './pattern.ts';

export interface Voicing {
  bass: OscillatorType;
  chord: OscillatorType;
  lead: OscillatorType;
  /** Lowpass cutoff for the music bus, Hz. */
  cutoff: number;
  /** Note decay factor: 1 = full length (sustained), <1 = plucky. */
  decay: number;
  /** Detune between two chord oscillators, cents (0 = single osc). */
  detune: number;
}

export const INSTRUMENTS: Record<Instrument, Voicing> = {
  chiptune: { bass: 'square', chord: 'square', lead: 'square', cutoff: 6000, decay: 0.6, detune: 0 },
  marimba: { bass: 'sine', chord: 'sine', lead: 'sine', cutoff: 4000, decay: 0.3, detune: 0 },
  synthpop: { bass: 'sawtooth', chord: 'sawtooth', lead: 'square', cutoff: 2600, decay: 0.8, detune: 8 },
  brass: { bass: 'sawtooth', chord: 'sawtooth', lead: 'sawtooth', cutoff: 1800, decay: 0.9, detune: 4 },
  strings: { bass: 'triangle', chord: 'sawtooth', lead: 'triangle', cutoff: 1500, decay: 1, detune: 12 },
  steelpan: { bass: 'triangle', chord: 'sine', lead: 'triangle', cutoff: 5000, decay: 0.4, detune: 3 },
  organ: { bass: 'sine', chord: 'square', lead: 'sine', cutoff: 2200, decay: 1, detune: 0 },
  lofi: { bass: 'triangle', chord: 'triangle', lead: 'sine', cutoff: 1100, decay: 0.7, detune: 6 },
  // Cinematic score: dark filtered saws, wide detuned choir-like pads, a low saw lead for the brass motif.
  cinematic: { bass: 'sawtooth', chord: 'sawtooth', lead: 'sawtooth', cutoff: 1500, decay: 1, detune: 18 },
  // Chalga band: a musette-detuned square accordion, a bright reedy clarinet lead, a punchy square synth bass.
  chalga: { bass: 'square', chord: 'square', lead: 'sawtooth', cutoff: 3800, decay: 0.75, detune: 14 },
};

export const DEFAULT_INSTRUMENT: Instrument = 'marimba';
