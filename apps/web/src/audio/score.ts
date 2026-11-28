// Cinematic sci-fi score (event themes such as Fallen Galaxy): a dark, mysterious battle cue in the same
// generative engine. Pure and deterministic like pattern.ts: same def + seed -> same score.
// 8 bars in A Phrygian (the flat second gives the dread) at a slow, heavy half-time feel:
// - bars 1-4, the omen: a low drone, a pulsing 8th-note string ostinato, a sparse eerie motif in long notes;
// - bars 5-8, the battle: syncopated war drums (taiko-style low hits), a heavy hit on 3, staccato stabs and a
//   low brass motif, and a drum roll crashing into the next loop.
import type { MusicDef, NoteEvent, Pattern } from './pattern.ts';
import { degreeToMidi, STEPS_PER_BAR } from './pattern.ts';

export const SCORE_BARS = 8;
const ROOT = 45; // A2
/** A Phrygian: minor with a flat second. */
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10] as const;

/** Bar chords as scale degrees: i, bII, i, bVII, i, bVI, bII, iv. Brooding, never resolving upward. */
const PROGRESSION = [0, 1, 0, 6, 0, 5, 1, 3];

/** The omen motif (bars 1-4): [step, degree above the root, length]; long, high, far apart. */
const OMEN: [number, number, number][][] = [
  [[0, 11, 12]],
  [
    [4, 12, 6],
    [12, 11, 4],
  ],
  [
    [0, 10, 10],
    [10, 8, 6],
  ],
  [[2, 7, 14]],
];

/** The battle motif (bars 5-8), low brass: quarter notes and a held note at the end of each bar. */
const BATTLE: [number, number, number][][] = [
  [
    [0, 7, 3],
    [4, 8, 3],
    [8, 7, 7],
  ],
  [
    [0, 5, 3],
    [4, 7, 3],
    [8, 8, 7],
  ],
  [
    [0, 7, 3],
    [4, 8, 3],
    [8, 10, 3],
    [12, 8, 3],
  ],
  [[0, 7, 15]],
];

export function generateCinematic(def: MusicDef, seed: number): Pattern {
  const scale = PHRYGIAN;
  const tempo = Math.max(80, Math.min(120, def.tempo || 96));
  const stepSec = 60 / tempo / 4;
  const events: NoteEvent[] = [];
  let r = seed >>> 0;
  const rnd = () => (r = (Math.imul(r ^ (r >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296;

  for (let bar = 0; bar < SCORE_BARS; bar++) {
    const chord = PROGRESSION[bar];
    const b = bar * STEPS_PER_BAR;
    const battle = bar >= 4;

    // Drone: the root two octaves down, held across the bar.
    events.push({ step: b, part: 'bass', midi: degreeToMidi(scale, chord, ROOT - 12), len: 15, vel: 0.55 });
    // String ostinato: 8th notes in the low register, root and fifth, swelling in the battle.
    for (let s = 0; s < STEPS_PER_BAR; s += 2) {
      const deg = s % 8 === 4 ? chord + 4 : chord;
      events.push({
        step: b + s,
        part: 'bass',
        midi: degreeToMidi(scale, deg, ROOT),
        len: 1,
        vel: (battle ? 0.55 : 0.35) + (s % 4 === 0 ? 0.1 : 0),
      });
    }

    // Choir pad: root, fifth and octave (open, no third: hollow and ominous), held across the bar.
    for (const off of [0, 4, 7]) {
      events.push({ step: b, part: 'chord', midi: degreeToMidi(scale, chord + off, ROOT + 12), len: 15, vel: 0.2 });
    }

    if (!battle) {
      for (const [s, deg, len] of OMEN[bar]) {
        events.push({ step: b + s, part: 'lead', midi: degreeToMidi(scale, chord + deg, ROOT), len, vel: 0.3 });
      }
      // A single distant drum hit every other bar, like something approaching.
      if (bar % 2 === 1) events.push({ step: b + 8, part: 'kick', midi: 0, len: 1, vel: 0.55 });
    } else {
      for (const [s, deg, len] of BATTLE[bar - 4]) {
        events.push({ step: b + s, part: 'lead', midi: degreeToMidi(scale, chord + deg, ROOT - 12), len, vel: 0.55 });
      }
      // Staccato stabs on the syncopations.
      for (const s of [3, 7, 10]) {
        for (const off of [0, 4]) {
          events.push({
            step: b + s,
            part: 'chord',
            midi: degreeToMidi(scale, chord + off, ROOT + 12),
            len: 1,
            vel: 0.32,
          });
        }
      }
      // War drums: syncopated low hits, a heavy hit on 3 (half-time), quiet 8th ticks.
      for (const [s, v] of [
        [0, 0.95],
        [3, 0.6],
        [6, 0.7],
        [10, 0.8],
        [11, 0.55],
      ] as const) {
        events.push({ step: b + s, part: 'kick', midi: 0, len: 1, vel: v });
      }
      if (rnd() < 0.5) events.push({ step: b + 14, part: 'kick', midi: 0, len: 1, vel: 0.6 });
      events.push({ step: b + 8, part: 'snare', midi: 0, len: 1, vel: 0.75 });
      for (let s = 2; s < STEPS_PER_BAR; s += 4) events.push({ step: b + s, part: 'hat', midi: 0, len: 1, vel: 0.12 });
    }

    // The last bar: a drum roll crashing into the loop.
    if (bar === SCORE_BARS - 1) {
      for (let s = 8; s < STEPS_PER_BAR; s++) {
        events.push({ step: b + s, part: s % 2 ? 'snare' : 'kick', midi: 0, len: 1, vel: 0.35 + ((s - 8) / 8) * 0.6 });
      }
    }
  }
  events.sort((a, z) => a.step - z.step);
  return { steps: SCORE_BARS * STEPS_PER_BAR, stepSec, swingSec: 0, events };
}
