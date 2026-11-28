import { describe, expect, it } from 'bun:test';
import { createThemeVote } from './vote.ts';

describe('theme vote', () => {
  it('tallies votes, lets players change them and picks the most-voted theme', () => {
    const v = createThemeVote(['a', 'b', 'c'], 1000);
    expect(v.winner()).toBe('a'); // no votes: first option
    expect(v.cast(1, 'b')).toBe(true);
    expect(v.cast(2, 'c')).toBe(true);
    expect(v.cast(3, 'c')).toBe(true);
    expect(v.cast(4, 'zzz')).toBe(false);
    expect(v.tallies()).toEqual([0, 1, 2]);
    v.cast(3, 'b');
    expect(v.tallies()).toEqual([0, 2, 1]);
    expect(v.winner()).toBe('b');
    v.drop(1);
    expect(v.winner()).toBe('b'); // tie: first option
  });
});
