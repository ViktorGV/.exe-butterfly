// Cinematic sci-fi score (event themes such as Fallen Galaxy): a dark, mysterious, epic 2-minute cue in the same
// generative engine. Pure and deterministic like pattern.ts: same def + seed -> same score.
// 48 bars at 96 bpm (2.5 s a bar) = 2:00, in A Phrygian, then it loops:
// - 0:00-0:30 intro (bars 0-11): eerie pads, a deep pulsing bass, sparse echoing metallic hits, sonar pings;
// - 0:30-1:15 build (bars 12-29): tense string ostinato, rising arpeggios, drums layering in, a roll into the drop;
// - 1:15-1:45 climax (bars 30-41): a wall of sound, low brass, a wide dark "choir", thunderous drums, a synth lead;
// - 1:45-2:00 outro (bars 42-47): stripped back to a haunting drone and one final deep hit before the loop.
import type { MusicDef, NoteEvent, Pattern } from './pattern.ts';
import { degreeToMidi, STEPS_PER_BAR } from './pattern.ts';

export const SCORE_BARS = 48;
const ROOT = 45; // A2
/** A Phrygian: minor with a flat second, for the dread. */
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10] as const;

const INTRO_END = 12;
const BUILD_END = 30;
const CLIMAX_END = 42;

/** Chords as scale degrees, 4 bars at a time. Brooding in the intro and build, heavier in the climax. */
const DARK = [0, 1, 0, 6];
const RISE = [0, 5, 6, 1];
const EPIC = [0, 5, 6, 4];

/** The climax brass motif: [step, degree above the chord root, length] per bar of a 4-bar phrase. */
const BRASS: [number, number, number][][] = [
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

/** The climax synth lead, an octave up and more restless. */
const LEAD: [number, number, number][][] = [
  [
    [0, 14, 1],
    [2, 15, 1],
    [4, 14, 2],
    [8, 12, 3],
    [12, 11, 3],
  ],
  [
    [0, 12, 2],
    [4, 14, 2],
    [8, 15, 6],
  ],
  [
    [0, 14, 1],
    [2, 15, 1],
    [4, 17, 2],
    [8, 15, 2],
    [12, 14, 3],
  ],
  [[0, 12, 11]],
];

export function generateCinematic(def: MusicDef, seed: number): Pattern {
  const scale = PHRYGIAN;
  const tempo = Math.max(80, Math.min(120, def.tempo || 96));
  const stepSec = 60 / tempo / 4;
  const events: NoteEvent[] = [];
  const add = (e: NoteEvent) => events.push(e);
  let r = seed >>> 0;
  const rnd = () => (r = (Math.imul(r ^ (r >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296;
  const note = (deg: number, base: number) => degreeToMidi(scale, deg, base);

  for (let bar = 0; bar < SCORE_BARS; bar++) {
    const b = bar * STEPS_PER_BAR;
    const intro = bar < INTRO_END;
    const build = bar >= INTRO_END && bar < BUILD_END;
    const climax = bar >= BUILD_END && bar < CLIMAX_END;
    const outro = bar >= CLIMAX_END;
    const prog = climax ? EPIC : build ? RISE : DARK;
    const chord = prog[bar % 4];
    /** 0..1 through the build, for the swell. */
    const buildT = build ? (bar - INTRO_END) / (BUILD_END - INTRO_END) : 0;

    // --- the drone: root two octaves down, always there --------------------------------------------------
    add({ step: b, part: 'bass', midi: note(outro ? 0 : chord, ROOT - 12), len: 15, vel: outro ? 0.6 : 0.5 });

    // --- pads ---------------------------------------------------------------------------------------------
    // Intro/outro: hollow open fifths. Climax: a wide dark "choir" in four voices across two octaves.
    const padVoices = climax ? [0, 4, 7, 11] : [0, 4, 7];
    const padVel = intro ? 0.16 : outro ? 0.12 * (1 - (bar - CLIMAX_END) / 6) + 0.04 : climax ? 0.3 : 0.2;
    for (const off of padVoices)
      add({ step: b, part: 'chord', midi: note(chord + off, ROOT + 12), len: 15, vel: padVel });

    if (intro) {
      // Deep pulsing bass: slow 8ths, quiet, the heartbeat of something huge.
      for (let s = 0; s < STEPS_PER_BAR; s += 4)
        add({ step: b + s, part: 'bass', midi: note(chord, ROOT), len: 2, vel: 0.32 });
      // Sparse metallic percussion with an echo (the same hit, quieter, a beat later).
      if (bar % 2 === 0) {
        const s = 6 + Math.floor(rnd() * 4);
        add({ step: b + s, part: 'hat', midi: 0, len: 1, vel: 0.35 });
        if (s + 4 < STEPS_PER_BAR) add({ step: b + s + 4, part: 'hat', midi: 0, len: 1, vel: 0.15 });
      }
      // Sonar pings: one high short note every other bar, with a faint return.
      if (bar % 2 === 1) {
        add({ step: b, part: 'lead', midi: note(14, ROOT + 12), len: 1, vel: 0.28 });
        add({ step: b + 6, part: 'lead', midi: note(14, ROOT + 12), len: 1, vel: 0.1 });
      }
      // A distant boom now and then.
      if (bar === 7 || bar === 11) add({ step: b + 8, part: 'kick', midi: 0, len: 1, vel: 0.5 });
    }

    if (build || climax) {
      // Tense string ostinato: 16ths, root and fifth, swelling through the build.
      for (let s = 0; s < STEPS_PER_BAR; s++) {
        const deg = s % 8 >= 4 ? chord + 4 : chord;
        add({
          step: b + s,
          part: 'bass',
          midi: note(deg, ROOT),
          len: 1,
          vel: (climax ? 0.6 : 0.3 + buildT * 0.3) + (s % 4 === 0 ? 0.1 : 0),
        });
      }
    }

    if (build) {
      // Rising arpeggio: up through the chord in 16ths, climbing an octave every 6 bars.
      const lift = Math.floor((bar - INTRO_END) / 6) * 7;
      const shape = [0, 2, 4, 7, 4, 7, 9, 11];
      if (bar >= INTRO_END + 2) {
        for (let s = 0; s < STEPS_PER_BAR; s++) {
          add({
            step: b + s,
            part: 'lead',
            midi: note(chord + shape[s % 8] + lift, ROOT),
            len: 1,
            vel: 0.14 + buildT * 0.18,
          });
        }
      }
      // Drums layer in: quarter-note pulse, then taiko syncopation, then the snare.
      if (bar >= INTRO_END + 4)
        for (let s = 0; s < STEPS_PER_BAR; s += 4)
          add({ step: b + s, part: 'kick', midi: 0, len: 1, vel: 0.5 + buildT * 0.3 });
      if (bar >= INTRO_END + 10)
        for (const s of [3, 10, 11]) add({ step: b + s, part: 'kick', midi: 0, len: 1, vel: 0.5 });
      if (bar >= INTRO_END + 14) add({ step: b + 8, part: 'snare', midi: 0, len: 1, vel: 0.55 });
      // The last two bars: a roll that swells into the drop.
      if (bar >= BUILD_END - 2) {
        const from = bar === BUILD_END - 1 ? 0 : 8;
        for (let s = from; s < STEPS_PER_BAR; s++) {
          const k = (bar - (BUILD_END - 2)) * 16 + s - 8;
          add({ step: b + s, part: 'snare', midi: 0, len: 1, vel: Math.min(0.95, 0.3 + k * 0.03) });
        }
      }
    }

    if (climax) {
      const phrase = (bar - BUILD_END) % 4;
      // Low brass motif, two octaves down, doubled an octave up for weight.
      for (const [s, deg, len] of BRASS[phrase]) {
        add({ step: b + s, part: 'lead', midi: note(chord + deg, ROOT - 12), len, vel: 0.6 });
        add({ step: b + s, part: 'lead', midi: note(chord + deg, ROOT), len, vel: 0.35 });
      }
      // Aggressive synth lead from the second phrase on.
      if (bar >= BUILD_END + 4)
        for (const [s, deg, len] of LEAD[phrase])
          add({ step: b + s, part: 'lead', midi: note(chord + deg, ROOT), len, vel: 0.4 });
      // Thunderous drums: syncopated taiko hits, a heavy hit on 3, 8th hats, a crash on each phrase.
      for (const [s, v] of [
        [0, 1],
        [3, 0.65],
        [6, 0.75],
        [8, 0.8],
        [10, 0.85],
        [11, 0.6],
        [14, 0.7],
      ] as const) {
        add({ step: b + s, part: 'kick', midi: 0, len: 1, vel: v });
      }
      add({ step: b + 8, part: 'snare', midi: 0, len: 1, vel: 0.85 });
      for (let s = 2; s < STEPS_PER_BAR; s += 2) add({ step: b + s, part: 'hat', midi: 0, len: 1, vel: 0.2 });
      if (phrase === 0) add({ step: b, part: 'snare', midi: 0, len: 1, vel: 0.9 });
    }

    if (outro) {
      // Stripped back: the drone and fading pads, a sonar ping, and one final deep hit before the loop.
      if (bar % 2 === 0) add({ step: b + 4, part: 'lead', midi: note(14, ROOT + 12), len: 1, vel: 0.15 });
      if (bar === SCORE_BARS - 2) {
        add({ step: b, part: 'kick', midi: 0, len: 1, vel: 1 });
        add({ step: b, part: 'bass', midi: note(0, ROOT - 24), len: 31, vel: 0.9 });
      }
    }
  }
  events.sort((a, z) => a.step - z.step);
  return { steps: SCORE_BARS * STEPS_PER_BAR, stepSec, swingSec: 0, events };
}
