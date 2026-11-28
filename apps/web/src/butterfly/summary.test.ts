import { describe, expect, it } from 'bun:test';
import { summarize, type ButterflyContext, type ButterflyRow } from './summary.ts';

const ctx = (over: Partial<ButterflyContext> = {}): ButterflyContext => ({
  storm: 0,
  stormMax: 20,
  throwsAtMe: 0,
  hitsOnMe: 0,
  ...over,
});
const row = (id: number, name: string, timeMs: number | null, over: Partial<ButterflyRow> = {}): ButterflyRow => ({
  id,
  name,
  timeMs,
  ...over,
});

describe('your own line', () => {
  it('tells the whole story: saved, pushed, marked, hit', () => {
    const rows = [row(1, 'Ann', 50_000, { saves: 1, pushes: 2, pushFalls: 1, marked: true })];
    const s = summarize(rows, 1, ctx({ throwsAtMe: 3, hitsOnMe: 1 }));
    expect(s.own).toBe("You saved 1 and pushed 2 → you were marked → the villain's throw got you.");
  });

  it('says you dodged when marked and thrown at but never hit', () => {
    const rows = [row(1, 'Ann', 50_000, { pushes: 2, pushFalls: 2, marked: true })];
    expect(summarize(rows, 1, ctx({ throwsAtMe: 4 })).own).toBe(
      'You pushed 2 → you were marked → you dodged every throw.',
    );
  });

  it('counts several hits', () => {
    const rows = [row(1, 'Ann', 50_000, { pushes: 2, pushFalls: 2, marked: true })];
    expect(summarize(rows, 1, ctx({ throwsAtMe: 5, hitsOnMe: 3 })).own).toBe(
      "You pushed 2 → you were marked → the villain's throws got you 3 times.",
    );
  });

  it('a helper who never pushed is not marked and has no villain part', () => {
    const rows = [row(1, 'Ann', 50_000, { saves: 2 })];
    expect(summarize(rows, 1, ctx({ throwsAtMe: 0 })).own).toBe('You saved 2.');
  });

  it("mentions the hero's bridge for a helper who never pushed", () => {
    const rows = [row(1, 'Ann', 50_000, { saves: 2 })];
    expect(summarize(rows, 1, ctx({ heroBridge: true })).own).toBe('You saved 2 → the hero opened a bridge for you.');
  });

  it('is empty when you did nothing, and for a spectator who is not in the results', () => {
    expect(summarize([row(1, 'Ann', 50_000)], 1, ctx()).own).toBeNull();
    expect(summarize([row(1, 'Ann', 50_000, { saves: 1 })], 99, ctx()).own).toBeNull();
    expect(summarize([row(1, 'Ann', 50_000, { saves: 1 })], undefined, ctx()).own).toBeNull();
  });

  it('counts every push, not only the ones that made someone fall', () => {
    const rows = [row(1, 'Ann', 50_000, { pushes: 7, pushFalls: 1 })];
    expect(summarize(rows, 1, ctx()).own).toBe('You pushed 7.');
  });

  it('a player marked by two pushes that made nobody fall still sees how many they pushed', () => {
    const rows = [row(1, 'Ann', 50_000, { pushes: 2, pushFalls: 0, marked: true })];
    expect(summarize(rows, 1, ctx({ throwsAtMe: 2, hitsOnMe: 1 })).own).toBe(
      "You pushed 2 → you were marked → the villain's throw got you.",
    );
  });
});

describe('the lobby line', () => {
  const rows = [
    row(1, 'Ann', 50_000, { pushes: 40, pushFalls: 10, saves: 5 }),
    row(2, 'Bob', 52_000, { pushes: 22, pushFalls: 8, saves: 20 }),
  ];

  it('totals pushes, saves and push falls and reports the storm', () => {
    expect(summarize(rows, 1, ctx({ storm: 18 })).lobby).toBe(
      '62 pushes, 25 saves → 18 push falls → the storm reached 18 of 20 and the villain was nearly at full power.',
    );
  });

  it('describes how awake the villain got', () => {
    const power = (storm: number) => summarize(rows, 1, ctx({ storm })).lobby;
    expect(power(1)).toContain('just stirring');
    expect(power(10)).toContain('getting strong');
    expect(power(19)).toContain('nearly at full power');
    expect(power(20)).toContain('was at full power');
    expect(summarize(rows, 1, ctx({ storm: 0 })).lobby).toContain('never woke');
  });

  it('is empty for a calm lobby where nobody pushed or saved', () => {
    expect(summarize([row(1, 'Ann', 50_000), row(2, 'Bob', null)], 1, ctx()).lobby).toBeNull();
  });
});

describe('titles', () => {
  const rows = [
    row(1, 'Ann', 50_000, { saves: 1, pushFalls: 0 }),
    row(2, 'Bob', 52_000, { saves: 4, pushFalls: 1 }),
    row(3, 'Cy', 55_000, { saves: 4, pushFalls: 5 }),
    row(4, 'Di', null),
  ];

  it('picks Fastest, Kindest and Biggest butterfly', () => {
    const titles = summarize(rows, 1, ctx()).titles;
    expect(titles).toEqual([
      { label: 'Fastest', name: 'Ann' },
      { label: 'Kindest', name: 'Bob' }, // tie on 4 saves goes to the better place
      { label: 'Biggest butterfly', name: 'Cy' },
    ]);
  });

  it('skips a title nobody earned', () => {
    const titles = summarize([row(1, 'Ann', 50_000), row(2, 'Bob', 60_000)], 1, ctx()).titles;
    expect(titles).toEqual([{ label: 'Fastest', name: 'Ann' }]);
  });

  it('Fastest ignores players who did not finish, and is empty when nobody did', () => {
    expect(summarize([row(1, 'Ann', null), row(2, 'Bob', 70_000)], 1, ctx()).titles[0]).toEqual({
      label: 'Fastest',
      name: 'Bob',
    });
    expect(summarize([row(1, 'Ann', null)], 1, ctx()).titles).toEqual([]);
  });
});
