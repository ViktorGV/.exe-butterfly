// Chalga score (the Chalga Night theme): Balkan pop-folk in the same generative engine. Pure and deterministic like
// pattern.ts: same def + seed -> same score. 32 bars of 4/4 at ~128 bpm (about a minute), in A Hijaz, the "oriental"
// scale with the augmented second (A Bb C# D E F G), then it loops:
// - bars 0-3: a free clarinet run over a drone, the band hits on the last beat;
// - bars 4-19: the kyuchek groove (dum . tek-tek dum . tek .), bouncing synth bass, offbeat accordion stabs and the
//   sung hook on the lead, ornamented with trills and grace notes;
// - bars 20-27: the clarinet solo, fast sixteenth runs up and down the scale;
// - bars 28-31: the hook again, a stop-time break and a darbuka roll back to the top.
import type { MusicDef, NoteEvent, Pattern } from './pattern.ts';
import { degreeToMidi, STEPS_PER_BAR } from './pattern.ts';

export const CHALGA_BARS = 32;
const ROOT = 45; // A2
/** A Hijaz (Phrygian dominant). */
const HIJAZ = [0, 1, 4, 5, 7, 8, 10] as const;
const INTRO_END = 4;
const GROOVE_END = 20;
const SOLO_END = 28;

/** Chord roots (scale degrees), one per bar: A - G - F - A, then A - Dm - Bb - A. */
const PROG = [0, 6, 5, 0, 0, 3, 1, 0];

/** The sung hook, 4 bars: [step, degree, length]. Degrees from the A an octave above the root. */
const HOOK: [number, number, number][][] = [
  [
    [0, 4, 2],
    [2, 5, 2],
    [4, 4, 2],
    [6, 2, 2],
    [8, 1, 4],
    [12, 2, 2],
    [14, 1, 2],
  ],
  [
    [0, 0, 6],
    [6, 1, 2],
    [8, 2, 2],
    [10, 3, 2],
    [12, 4, 4],
  ],
  [
    [0, 7, 2],
    [2, 6, 2],
    [4, 5, 2],
    [6, 4, 2],
    [8, 5, 2],
    [10, 4, 2],
    [12, 2, 2],
    [14, 1, 2],
  ],
  [
    [0, 0, 10],
    [12, 1, 1],
    [13, 0, 1],
    [14, -1, 2],
  ],
];

export function generateChalga(def: MusicDef, seed: number): Pattern {
  const tempo = Math.max(112, Math.min(140, def.tempo || 128));
  const stepSec = 60 / tempo / 4;
  const events: NoteEvent[] = [];
  const add = (e: NoteEvent) => events.push(e);
  let r = seed >>> 0;
  const rnd = () => (r = (Math.imul(r ^ (r >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296;
  const note = (deg: number, base: number) => degreeToMidi(HIJAZ, deg, base);
  const lead = (step: number, deg: number, len: number, vel: number) => {
    // A grace note from the scale step above, then the note; long notes end in a trill (the clarinet's ornament).
    if (len >= 2 && rnd() < 0.45) add({ step, part: 'lead', midi: note(deg + 1, ROOT + 24), len: 1, vel: vel * 0.6 });
    const s = len >= 2 && rnd() < 0.45 ? 1 : 0;
    if (len >= 4) {
      add({ step: step + s, part: 'lead', midi: note(deg, ROOT + 24), len: len - 2 - s, vel });
      add({ step: step + len - 2, part: 'lead', midi: note(deg + 1, ROOT + 24), len: 1, vel: vel * 0.7 });
      add({ step: step + len - 1, part: 'lead', midi: note(deg, ROOT + 24), len: 1, vel: vel * 0.8 });
    } else add({ step: step + s, part: 'lead', midi: note(deg, ROOT + 24), len: len - s, vel });
  };

  for (let bar = 0; bar < CHALGA_BARS; bar++) {
    const b = bar * STEPS_PER_BAR;
    const intro = bar < INTRO_END;
    const solo = bar >= GROOVE_END && bar < SOLO_END;
    const last = bar === CHALGA_BARS - 1;
    const chord = PROG[bar % 8];

    if (intro) {
      // Drone on A and E, and a free clarinet run that climbs, turns and falls.
      add({ step: b, part: 'chord', midi: note(0, ROOT + 12), len: 15, vel: 0.18 });
      add({ step: b, part: 'chord', midi: note(4, ROOT + 12), len: 15, vel: 0.14 });
      add({ step: b, part: 'bass', midi: note(0, ROOT - 12), len: 15, vel: 0.4 });
      const start = [0, 3, 5, 2][bar];
      for (let s = 0; s < STEPS_PER_BAR; s += bar === 3 ? 1 : 2) {
        const up = bar < 2 ? s / 2 : 7 - s / 2;
        const deg = start + Math.round(up) + (rnd() < 0.2 ? 1 : 0);
        add({
          step: b + s,
          part: 'lead',
          midi: note(deg, ROOT + 24),
          len: bar === 3 ? 1 : 2,
          vel: 0.35 + rnd() * 0.15,
        });
      }
      if (bar === 3)
        for (const s of [12, 14]) {
          add({ step: b + s, part: 'kick', midi: 0, len: 1, vel: 0.9 });
          add({ step: b + s, part: 'snare', midi: 0, len: 1, vel: 0.7 });
        }
      continue;
    }

    const breakBar = bar === CHALGA_BARS - 2;
    // --- the kyuchek groove: dum on 1 and the "and" of 2, tek-tek, a darbuka roll on the hats ---------------
    if (!breakBar) {
      for (const s of [0, 6, 8]) add({ step: b + s, part: 'kick', midi: 0, len: 1, vel: s === 0 ? 1 : 0.8 });
      for (const s of [4, 12]) add({ step: b + s, part: 'snare', midi: 0, len: 1, vel: 0.75 });
      for (const s of [10, 14]) add({ step: b + s, part: 'snare', midi: 0, len: 1, vel: 0.35 });
      for (let s = 0; s < STEPS_PER_BAR; s++)
        if (s % 2 === 1 || rnd() < 0.3)
          add({ step: b + s, part: 'hat', midi: 0, len: 1, vel: s % 4 === 3 ? 0.4 : 0.22 });
    } else {
      // stop-time: the band hits on 1 and the "and" of 2, then silence for the singer
      for (const s of [0, 6]) {
        add({ step: b + s, part: 'kick', midi: 0, len: 1, vel: 1 });
        add({ step: b + s, part: 'snare', midi: 0, len: 1, vel: 0.8 });
      }
    }
    if (last)
      for (let s = 8; s < STEPS_PER_BAR; s++)
        add({ step: b + s, part: 'snare', midi: 0, len: 1, vel: 0.3 + (s - 8) * 0.07 });

    // --- bouncing synth bass: root and octave, a pickup into the next bar -----------------------------------
    if (!breakBar) {
      for (const [s, o] of [
        [0, 0],
        [3, 12],
        [6, 0],
        [8, 0],
        [11, 12],
        [14, 7],
      ] as const)
        add({ step: b + s, part: 'bass', midi: note(chord, ROOT) + (o === 7 ? 7 : o), len: 2, vel: 0.6 });
    }

    // --- accordion stabs on the offbeats, a triad of the chord ----------------------------------------------
    if (!breakBar)
      for (const s of [2, 6, 10, 14])
        for (const off of [0, 2, 4])
          add({ step: b + s, part: 'chord', midi: note(chord + off, ROOT + 12), len: 1, vel: 0.22 });

    // --- the hook or the solo on the lead -------------------------------------------------------------------
    if (solo) {
      // Clarinet solo: sixteenth runs, each bar a different shape, peaking in the middle of the section.
      const peak = 1 - Math.abs(bar - (GROOVE_END + 4)) / 4;
      for (let s = 0; s < STEPS_PER_BAR; s++) {
        const shape = bar % 2 ? Math.round(4 + 3 * Math.sin((s / 16) * Math.PI * 2)) : s < 8 ? s : 15 - s;
        const deg = chord + shape + Math.round(peak * 3);
        add({ step: b + s, part: 'lead', midi: note(deg, ROOT + 24), len: 1, vel: 0.32 + peak * 0.12 });
      }
    } else if (!breakBar) {
      for (const [s, deg, len] of HOOK[(bar - INTRO_END) % 4]) lead(b + s, deg, len, 0.5);
      // second time round, an accordion echo of the hook an octave down
      if (bar >= 12 && bar < GROOVE_END)
        for (const [s, deg, len] of HOOK[(bar - INTRO_END) % 4])
          add({ step: b + s, part: 'chord', midi: note(deg, ROOT + 12), len, vel: 0.16 });
    } else {
      // the singer's pickup in the break
      for (const [s, deg] of [
        [10, 4],
        [12, 5],
        [14, 7],
      ])
        add({ step: b + s, part: 'lead', midi: note(deg, ROOT + 24), len: 2, vel: 0.55 });
    }
  }
  events.sort((a, z) => a.step - z.step);
  return { steps: CHALGA_BARS * STEPS_PER_BAR, stepSec, swingSec: 0, events };
}
