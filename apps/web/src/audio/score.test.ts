import { describe, expect, it } from 'bun:test';
import { generatePattern, STEPS_PER_BAR } from './pattern.ts';
import { SCORE_BARS } from './score.ts';

const def = {
  tempo: 128,
  scale: 'minor' as const,
  energy: 3 as const,
  instrument: 'cinematic' as const,
  style: 'cinematic' as const,
};

describe('cinematic sci-fi score', () => {
  it('is an 8-bar loop with every section playing', () => {
    const p = generatePattern(def, 7);
    expect(p.steps).toBe(SCORE_BARS * STEPS_PER_BAR);
    const parts = new Set(p.events.map((e) => e.part));
    for (const part of ['bass', 'chord', 'lead', 'kick', 'snare', 'hat']) expect(parts.has(part as never)).toBe(true);
    expect(p.events.every((e) => e.step >= 0 && e.step < p.steps)).toBe(true);
  });

  it('is deterministic and different from the default generator', () => {
    expect(generatePattern(def, 7)).toEqual(generatePattern(def, 7));
    const plain = generatePattern({ ...def, style: undefined }, 7);
    expect(plain.steps).not.toBe(SCORE_BARS * STEPS_PER_BAR);
  });
});
