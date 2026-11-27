// Sound-effect patches as data. Each patch is a few short synth layers; all original.

export type SoundName =
  | 'jump'
  | 'land'
  | 'dive'
  | 'bounce'
  | 'hit'
  | 'fall'
  | 'respawn'
  | 'checkpoint'
  | 'countdown'
  | 'go'
  | 'finish'
  | 'qualified'
  | 'uiClick'
  | 'uiError'
  // Butterfly effect (#84)
  | 'push'
  | 'save'
  | 'helpUp'
  | 'butterfly'
  | 'stormStep';

export interface Layer {
  /** 'noise' plays filtered white noise; others are oscillator types. */
  type: OscillatorType | 'noise';
  /** Start / end frequency in Hz (filter centre for noise). */
  f0: number;
  f1: number;
  /** Offset from sound start, seconds. */
  at: number;
  dur: number;
  gain: number;
  attack?: number;
}

export interface Patch {
  layers: Layer[];
  /** Random pitch variation, as a fraction (0.05 = +-5%). */
  jitter: number;
  /** Minimum seconds between two starts (rate limit). */
  minInterval: number;
  /** Ducks music while playing (stingers). */
  duck?: boolean;
}

const L = (
  type: Layer['type'],
  f0: number,
  f1: number,
  at: number,
  dur: number,
  gain: number,
  attack?: number,
): Layer => ({
  type,
  f0,
  f1,
  at,
  dur,
  gain,
  attack,
});

// Arpeggio helper: notes in Hz, one every `step` seconds.
const arp = (type: OscillatorType, notes: number[], step: number, dur: number, gain: number): Layer[] =>
  notes.map((f, i) => L(type, f, f, i * step, dur, gain));

export const PATCHES: Record<SoundName, Patch> = {
  jump: {
    layers: [L('triangle', 320, 720, 0, 0.16, 0.5), L('sine', 640, 1200, 0, 0.1, 0.15)],
    jitter: 0.08,
    minInterval: 0.06,
  },
  land: {
    layers: [L('sine', 160, 70, 0, 0.12, 0.6), L('noise', 600, 300, 0, 0.06, 0.2)],
    jitter: 0.1,
    minInterval: 0.06,
  },
  dive: {
    layers: [L('triangle', 700, 250, 0, 0.22, 0.45), L('noise', 2000, 800, 0, 0.18, 0.12)],
    jitter: 0.06,
    minInterval: 0.1,
  },
  bounce: {
    layers: [L('sine', 200, 900, 0, 0.25, 0.55), L('triangle', 400, 1500, 0.02, 0.18, 0.15)],
    jitter: 0.08,
    minInterval: 0.06,
  },
  hit: {
    layers: [L('square', 220, 90, 0, 0.12, 0.25), L('noise', 1200, 400, 0, 0.1, 0.35)],
    jitter: 0.1,
    minInterval: 0.05,
  },
  fall: {
    layers: [L('triangle', 800, 120, 0, 0.9, 0.4, 0.02), L('sine', 400, 60, 0.1, 0.8, 0.2)],
    jitter: 0.04,
    minInterval: 0.3,
  },
  respawn: { layers: arp('triangle', [523, 659, 784, 1047], 0.05, 0.14, 0.35), jitter: 0.02, minInterval: 0.2 },
  checkpoint: { layers: arp('square', [784, 988, 1175], 0.07, 0.16, 0.18), jitter: 0, minInterval: 0.2 },
  countdown: {
    layers: [L('square', 523, 523, 0, 0.18, 0.22), L('sine', 1046, 1046, 0, 0.18, 0.2)],
    jitter: 0,
    minInterval: 0.3,
    duck: true,
  },
  go: {
    layers: [
      L('square', 1046, 1046, 0, 0.45, 0.22),
      L('sine', 784, 784, 0, 0.45, 0.25),
      L('triangle', 523, 523, 0, 0.45, 0.25),
    ],
    jitter: 0,
    minInterval: 0.5,
    duck: true,
  },
  finish: {
    layers: [...arp('square', [523, 659, 784, 1047, 1319], 0.09, 0.3, 0.16), L('triangle', 262, 262, 0, 0.8, 0.3)],
    jitter: 0,
    minInterval: 1,
    duck: true,
  },
  qualified: { layers: arp('triangle', [659, 784, 988, 1319], 0.08, 0.35, 0.3), jitter: 0, minInterval: 1, duck: true },
  uiClick: { layers: [L('sine', 1400, 900, 0, 0.04, 0.3, 0.002)], jitter: 0.05, minInterval: 0.03 },
  uiError: {
    layers: [L('square', 220, 200, 0, 0.12, 0.18), L('square', 180, 160, 0.13, 0.16, 0.18)],
    jitter: 0,
    minInterval: 0.2,
  },
  push: {
    layers: [L('noise', 900, 500, 0, 0.1, 0.3), L('triangle', 300, 180, 0, 0.1, 0.35)],
    jitter: 0.1,
    minInterval: 0.08,
  },
  save: { layers: arp('sine', [392, 587, 784], 0.06, 0.2, 0.35), jitter: 0.03, minInterval: 0.3 },
  helpUp: {
    layers: [L('triangle', 300, 600, 0, 0.3, 0.35, 0.03), L('sine', 450, 900, 0.08, 0.25, 0.2)],
    jitter: 0.04,
    minInterval: 0.3,
  },
  butterfly: {
    layers: [...arp('sine', [1568, 1319, 1760, 1480], 0.05, 0.25, 0.18), L('triangle', 880, 1320, 0, 0.4, 0.12, 0.05)],
    jitter: 0.02,
    minInterval: 0.5,
  },
  stormStep: {
    layers: [L('sawtooth', 110, 55, 0, 0.5, 0.18, 0.01), L('noise', 300, 150, 0, 0.5, 0.25, 0.02)],
    jitter: 0,
    minInterval: 0.4,
  },
};

export const SOUND_NAMES = Object.keys(PATCHES) as SoundName[];

export function patchLength(p: Patch): number {
  let end = 0;
  for (const l of p.layers) end = Math.max(end, l.at + l.dur);
  return end;
}
