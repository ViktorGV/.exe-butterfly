// Cinematic sci-fi score (event themes such as Fallen Galaxy): a space-opera chase in the same generative engine.
// Pure and deterministic like pattern.ts: same def + seed -> same score.
// 8 bars in a minor key over i - VI - III - VII:
// - bass: a pumping 16th-note ostinato (root and octave, accents on the beat);
// - chords: wide sustained pads plus off-beat stabs in the second half;
// - lead: a pulsing arpeggio in bars 1-4, then a heroic fanfare motif in bars 5-8;
// - drums: kick on the beats, snare on 2 and 4, 16th hats, and a snare-roll build into the loop.
import type { MusicDef, NoteEvent, Pattern } from './pattern.ts';
import { degreeToMidi, SCALES, STEPS_PER_BAR } from './pattern.ts';

export const SCORE_BARS = 8;
const ROOT = 45; // A2: darker and heavier than the default C3

/** Scale degrees of each bar's chord: i, VI, III, VII, then i, VI, VII, (V) for a lift into the loop. */
const PROGRESSION = [0, 5, 2, 6, 0, 5, 6, 4];

/** The fanfare, as scale degrees above the chord root per beat (bars 5-8); -1 = rest. */
const FANFARE = [
  [7, -1, 9, 10],
  [9, -1, -1, 7],
  [7, 9, 10, 12],
  [11, -1, 9, -1],
];

export function generateCinematic(def: MusicDef, seed: number): Pattern {
  const scale = SCALES.minor;
  const n = scale.length;
  const tempo = Math.max(100, Math.min(160, def.tempo || 128));
  const stepSec = 60 / tempo / 4;
  const events: NoteEvent[] = [];
  let r = seed >>> 0;
  const rnd = () => (r = (Math.imul(r ^ (r >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296;

  for (let bar = 0; bar < SCORE_BARS; bar++) {
    const chord = PROGRESSION[bar] % n;
    const b = bar * STEPS_PER_BAR;
    const second = bar >= 4;

    // Bass ostinato: 16ths, octave jumps on the off-beats, accents on the beat.
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      const up = s % 4 === 2;
      events.push({
        step: b + s,
        part: 'bass',
        midi: degreeToMidi(scale, chord, ROOT - 12) + (up ? 12 : 0),
        len: 1,
        vel: s % 4 === 0 ? 0.85 : 0.5,
      });
    }

    // Pads: root, third, fifth and the octave above, held across the bar.
    for (const off of [0, 2, 4, 7]) {
      events.push({ step: b, part: 'chord', midi: degreeToMidi(scale, chord + off, ROOT + 12), len: 15, vel: 0.22 });
    }
    // Stabs on the off-beats in the second half: the brass-section push.
    if (second) {
      for (const s of [3, 6, 11, 14]) {
        for (const off of [0, 4]) {
          events.push({
            step: b + s,
            part: 'chord',
            midi: degreeToMidi(scale, chord + off, ROOT + 24),
            len: 1,
            vel: 0.35,
          });
        }
      }
    }

    if (!second) {
      // Arpeggio: up-down through the chord in 16ths, an octave above the pads.
      const shape = [0, 2, 4, 7, 9, 7, 4, 2];
      for (let s = 0; s < STEPS_PER_BAR; s++) {
        events.push({
          step: b + s,
          part: 'lead',
          midi: degreeToMidi(scale, chord + shape[s % shape.length], ROOT + 24),
          len: 1,
          vel: s % 4 === 0 ? 0.32 : 0.22,
        });
      }
    } else {
      // Fanfare: quarter notes over the chord, held into rests.
      const line = FANFARE[bar - 4];
      for (let beat = 0; beat < 4; beat++) {
        const deg = line[beat];
        if (deg < 0) continue;
        let len = 4;
        while (beat + len / 4 < 4 && line[beat + len / 4] === -1) len += 4;
        events.push({
          step: b + beat * 4,
          part: 'lead',
          midi: degreeToMidi(scale, deg, ROOT + 12),
          len: len - 1,
          vel: 0.55,
        });
      }
    }

    // Drums.
    for (let s = 0; s < STEPS_PER_BAR; s += 4) events.push({ step: b + s, part: 'kick', midi: 0, len: 1, vel: 0.9 });
    if (rnd() < 0.5) events.push({ step: b + 10, part: 'kick', midi: 0, len: 1, vel: 0.6 });
    events.push({ step: b + 4, part: 'snare', midi: 0, len: 1, vel: 0.65 });
    events.push({ step: b + 12, part: 'snare', midi: 0, len: 1, vel: 0.65 });
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      if (s % 4 === 0) continue;
      events.push({ step: b + s, part: 'hat', midi: 0, len: 1, vel: s % 2 ? 0.18 : 0.3 });
    }
    // Snare roll building into the next loop.
    if (bar === SCORE_BARS - 1) {
      for (let s = 8; s < STEPS_PER_BAR; s++) {
        events.push({ step: b + s, part: 'snare', midi: 0, len: 1, vel: 0.3 + ((s - 8) / 8) * 0.5 });
      }
    }
  }
  events.sort((a, z) => a.step - z.step);
  return { steps: SCORE_BARS * STEPS_PER_BAR, stepSec, swingSec: 0, events };
}
