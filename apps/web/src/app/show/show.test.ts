import { describe, expect, it } from 'bun:test';
import type { MatchConfig } from '@wobble/shared/types';
import { createShowTracker, outcomeLine } from './index.ts';

const cfg = (n: number, q: number): MatchConfig => ({
  t: 'matchConfig',
  courseId: 'c',
  themeId: 't',
  qualifyCount: q,
  players: Array.from({ length: n }, (_, i) => ({ id: i + 1, slot: i, skinId: 's', name: `p${i}` })),
});
const res = (ids: number[]) => ids.map((id, i) => ({ id, place: i + 1, timeMs: 1000 + i, checkpoint: 3 }));

describe('show tracker', () => {
  it('ignores single races', () => {
    const s = createShowTracker();
    s.onMatchConfig(cfg(4, 2));
    expect(s.round).toBe(0);
    expect(s.label()).toBeNull();
    expect(s.onRaceEnd(res([1, 2, 3, 4]), 4)).toBeNull();
  });

  it('counts rounds after a vote and reports outcomes', () => {
    const s = createShowTracker();
    s.onVoteResult();
    s.onMatchConfig(cfg(5, 3));
    expect(s.label()).toBe('Round 1: top 3 qualify');
    expect(s.onRaceEnd(res([1, 2, 3, 4, 5]), 2)).toBe('qualified');
    expect(s.onRaceEnd(res([1, 2, 3, 4, 5]), 5)).toBe('eliminated');
    s.onMatchConfig(cfg(2, 1));
    expect(s.round).toBe(2);
    expect(s.final).toBe(true);
    expect(s.onRaceEnd(res([1, 2]), 1)).toBe('winner');
    expect(outcomeLine('eliminated', 2)).toContain('round 2');
    s.reset();
    expect(s.round).toBe(0);
  });
});
