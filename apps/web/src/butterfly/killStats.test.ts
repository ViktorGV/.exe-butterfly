import { describe, expect, test } from 'bun:test';
import { createKillStats } from './killStats.ts';

const players = [
  { id: 1, name: 'Ann' },
  { id: 2, name: 'Bo' },
  { id: 3, name: 'Cy' },
];

describe('kill stats', () => {
  test('who killed you the most and who killed the fewest', () => {
    const s = createKillStats();
    s.record(2, 1, 1);
    s.record(2, 1, 1);
    s.record(3, 1, 1);
    s.record(1, 3, 1);
    s.record(3, 2, 1);
    expect(s.titles(players)).toEqual([
      { label: 'Killed you the most', name: 'Bo (2×)' },
      { label: 'You killed', name: 'Cy (1×)' },
      { label: 'Most kills', name: 'Bo (2)' },
      { label: 'Fewest kills', name: 'Ann (1)' },
    ]);
  });

  test('nobody hit you: only the fewest-kills title; reset clears', () => {
    const s = createKillStats();
    s.record(2, 3, 1);
    s.reset();
    expect(s.titles(players)).toEqual([{ label: 'Fewest kills', name: 'Ann (0)' }]);
  });
});
