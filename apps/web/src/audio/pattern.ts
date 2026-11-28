// Deterministic generative music patterns. Pure: same musicDef + seed -> same pattern.
import { generateCinematic } from './score.ts';
import { createRng } from './rng.ts';

export type Scale = 'major' | 'minor' | 'pentatonic' | 'lydian';
export type Instrument =
  | 'chiptune'
  | 'marimba'
  | 'synthpop'
  | 'brass'
  | 'strings'
  | 'steelpan'
  | 'organ'
  | 'lofi'
  /** Web only: the cinematic score's synth section (see score.ts). */
  | 'cinematic';

/** ThemeDef.music, plus the optional v2 (#54) fields. */
export interface MusicDef {
  tempo: number;
  scale: Scale;
  energy: 1 | 2 | 3;
  instrument?: Instrument;
  swing?: number;
  /** Web only: 'cinematic' plays the sci-fi score (score.ts) instead of the default generator. */
  style?: 'default' | 'cinematic';
}

export const SCALES: Record<Scale, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

export type Part = 'bass' | 'chord' | 'lead' | 'kick' | 'hat' | 'snare';

export interface NoteEvent {
  /** Step index in the loop (16th notes). */
  step: number;
  part: Part;
  /** MIDI note (0 for percussion). */
  midi: number;
  /** Length in steps. */
  len: number;
  vel: number;
}

export interface Pattern {
  steps: number;
  stepSec: number;
  /** Delay applied to odd 16ths. */
  swingSec: number;
  events: NoteEvent[];
}

export const LOOP_BARS = 4;
export const STEPS_PER_BAR = 16;
const ROOT = 48; // C3

const PROGRESSIONS = [
  [0, 4, 5, 3],
  [0, 5, 3, 4],
  [0, 3, 4, 4],
  [0, 5, 1, 4],
];

export function degreeToMidi(scale: readonly number[], degree: number, base: number): number {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  return base + oct * 12 + scale[((degree % n) + n) % n];
}

export function generatePattern(def: MusicDef, seed: number): Pattern {
  if (def.style === 'cinematic') return generateCinematic(def, seed);
  const rng = createRng(seed);
  const scale = SCALES[def.scale] ?? SCALES.major;
  const n = scale.length;
  const tempo = Math.max(60, Math.min(200, def.tempo || 120));
  const stepSec = 60 / tempo / 4;
  const swing = Math.max(0, Math.min(1, def.swing ?? 0));
  const events: NoteEvent[] = [];
  const prog = PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)];

  for (let bar = 0; bar < LOOP_BARS; bar++) {
    const chord = prog[bar] % n;
    const b = bar * STEPS_PER_BAR;
    for (let s = 0; s < STEPS_PER_BAR; s += 4) {
      const deg = s === 8 && rng() < 0.5 ? chord + Math.min(4, n - 1) : chord;
      events.push({ step: b + s, part: 'bass', midi: degreeToMidi(scale, deg, ROOT - 12), len: 3, vel: 0.8 });
    }
    for (const off of [0, 2, 4]) {
      events.push({ step: b, part: 'chord', midi: degreeToMidi(scale, chord + off, ROOT), len: 15, vel: 0.3 });
    }
    events.push({ step: b, part: 'kick', midi: 0, len: 1, vel: 0.9 });
    events.push({ step: b + 8, part: 'kick', midi: 0, len: 1, vel: 0.7 });
    if (def.energy >= 2) {
      for (let s = 2; s < STEPS_PER_BAR; s += 4) events.push({ step: b + s, part: 'hat', midi: 0, len: 1, vel: 0.4 });
      let deg = chord + n;
      for (let s = 0; s < STEPS_PER_BAR; s += 2) {
        if (rng() < 0.45) continue;
        deg = Math.max(n - 2, Math.min(n * 2 + 2, deg + Math.floor(rng() * 5) - 2));
        const len = rng() < 0.3 ? 4 : 2;
        events.push({ step: b + s, part: 'lead', midi: degreeToMidi(scale, deg, ROOT), len, vel: 0.45 });
      }
    }
    if (def.energy >= 3) {
      events.push({ step: b + 4, part: 'snare', midi: 0, len: 1, vel: 0.6 });
      events.push({ step: b + 12, part: 'snare', midi: 0, len: 1, vel: 0.6 });
    }
  }
  events.sort((a, b) => a.step - b.step);
  return { steps: LOOP_BARS * STEPS_PER_BAR, stepSec, swingSec: swing * stepSec * 0.5, events };
}

/** Seed derived from a musicDef so the same theme always plays the same tune. */
export function seedFor(def: MusicDef): number {
  let h = 2166136261;
  const s = `${def.tempo}|${def.scale}|${def.energy}|${def.instrument ?? ''}|${def.style ?? ''}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
