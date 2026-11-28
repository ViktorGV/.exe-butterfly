import { describe, expect, it } from 'bun:test';
import { BUTTERFLY } from '../constants.ts';
import { createButterfly, getsHeroHelp, type ButterflyEvent } from './index.ts';

const events: ButterflyEvent[] = [];

describe('marking', () => {
  it('marks a player at their second push, whether or not anyone falls', () => {
    const b = createButterfly();
    expect(BUTTERFLY.MARK_PUSHES).toBe(2);
    expect(b.push(1, 2, 1000, events)).toEqual([]);
    expect(b.isMarked(1)).toBe(false);
    // the second push marks the pusher at once: `id` is the pusher, `by` the player just pushed
    expect(b.push(1, 3, 2000, events)).toEqual([{ type: 'marked', id: 1, by: 3 }]);
    expect(b.isMarked(1)).toBe(true);
    expect(b.tally(1).marked).toBe(true);
    expect(b.tally(1).pushes).toBe(2);
    expect(b.tally(1).pushFalls).toBe(0); // nobody fell
  });

  it('marks only once, however many more pushes follow', () => {
    const b = createButterfly();
    b.push(1, 2, 0, events);
    expect(b.push(1, 2, 100, events).filter((e) => e.type === 'marked')).toHaveLength(1);
    // (pushing the same target again and again also hands them a gun: only the marks matter here)
    for (let i = 0; i < 5; i++) expect(b.push(1, 2, 200 + i, events).filter((e) => e.type === 'marked')).toEqual([]);
    expect(b.tally(1).pushes).toBe(7);
  });

  it('pushing the same player twice counts as two pushes', () => {
    const b = createButterfly();
    b.push(1, 2, 0, events);
    // (the second push on the same player also hands them a gun: only the mark matters here)
    expect(b.push(1, 2, 50, events).filter((e) => e.type === 'marked')).toEqual([{ type: 'marked', id: 1, by: 2 }]);
  });

  it('keeps every player separate: one push each marks nobody', () => {
    const b = createButterfly();
    b.push(1, 3, 0, events);
    b.push(2, 3, 10, events);
    expect(b.isMarked(1)).toBe(false);
    expect(b.isMarked(2)).toBe(false);
  });

  it('saving does not mark and does not count as a push', () => {
    const b = createButterfly();
    b.save(1);
    b.save(1);
    b.save(1);
    expect(b.isMarked(1)).toBe(false);
    expect(b.tally(1).pushes).toBe(0);
    expect(b.tally(1).saves).toBe(3);
  });

  it('a fall no longer marks anyone: it only counts a push fall and raises the storm', () => {
    const b = createButterfly();
    b.push(1, 2, 0, events); // one push: not marked
    const out = b.fell(2, 500, events);
    expect(out.map((e) => e.type)).toEqual(['pushFall', 'storm']);
    expect(b.isMarked(1)).toBe(false);
    expect(b.tally(1).pushFalls).toBe(1);
    expect(b.storm).toBe(1);
  });
});

describe('push falls and the storm', () => {
  it('only a fall within the window of a push counts, and only once', () => {
    const b = createButterfly();
    b.push(1, 2, 0, events);
    expect(b.fell(2, BUTTERFLY.PUSH_FALL_WINDOW_MS + 1, events)).toEqual([]); // too late
    b.push(1, 2, 10_000, events);
    expect(b.fell(2, 11_000, events).map((e) => e.type)).toEqual(['pushFall', 'storm']);
    expect(b.fell(2, 11_500, events)).toEqual([]); // the same push cannot count twice
    expect(b.storm).toBe(1);
  });

  it('a fall on its own counts for nobody', () => {
    const b = createButterfly();
    expect(b.fell(5, 1000, events)).toEqual([]);
    expect(b.storm).toBe(0);
  });

  it('the storm never goes above STORM_MAX', () => {
    const b = createButterfly();
    for (let i = 0; i < BUTTERFLY.STORM_MAX + 5; i++) {
      b.push(1, 2, i * 10_000, events);
      b.fell(2, i * 10_000 + 100, events);
    }
    expect(b.storm).toBe(BUTTERFLY.STORM_MAX);
  });
});

describe('deeds move the storm', () => {
  it('a push raises it, a save or help-up calms it', () => {
    const b = createButterfly();
    expect(b.deed('bad', events)).toEqual([{ type: 'storm', level: 1 }]);
    b.deed('bad', events);
    expect(b.deed('good', events)).toEqual([{ type: 'storm', level: 1 }]);
    expect(b.storm).toBe(1);
  });

  it('stays within 0..STORM_MAX and is silent when it cannot move', () => {
    const b = createButterfly();
    expect(b.deed('good', events)).toEqual([]);
    expect(b.storm).toBe(0);
    for (let i = 0; i < BUTTERFLY.STORM_MAX + 3; i++) b.deed('bad', events);
    expect(b.storm).toBe(BUTTERFLY.STORM_MAX);
    expect(b.deed('bad', events)).toEqual([]);
  });
});

describe('the hero helps players who saved and never pushed', () => {
  it('needs at least one save and no pushes', () => {
    const b = createButterfly();
    b.save(1);
    expect(getsHeroHelp(b.tally(1))).toBe(true);
    b.push(2, 3, 0, events);
    b.save(2);
    expect(getsHeroHelp(b.tally(2))).toBe(false); // pushed once
    expect(getsHeroHelp(b.tally(3))).toBe(false); // never saved
  });
});
