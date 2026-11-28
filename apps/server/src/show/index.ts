// Elimination show (#35): rounds on the event themes; the top ~60% of each round qualify, the final crowns one winner.
// Pure rules; the room (room/room.ts) drives them between races.
import type { RaceResult } from '@wobble/shared/types';

/** Share of a round's players who qualify for the next round. */
export const SHOW_KEEP = 0.6;

export interface Show {
  /** 0-based round index. */
  round: number;
  /** Theme per round: the vote winner first, then the other vote themes, never repeating. */
  readonly themes: readonly string[];
  /** Player ids still in the show. */
  alive: Set<number>;
}

/** Distinct theme ids, `first` leading. */
export function themeOrder(first: string, options: readonly string[]): string[] {
  const out = [first];
  for (const id of options) if (!out.includes(id)) out.push(id);
  return out;
}

export function createShow(firstTheme: string, options: readonly string[], players: Iterable<number>): Show {
  return { round: 0, themes: themeOrder(firstTheme, options), alive: new Set(players) };
}

/** The last round: two or fewer players left, or no theme left for another round. */
export function isFinalRound(show: Show, players: number): boolean {
  return players <= 2 || show.round >= show.themes.length - 1;
}

/** How many of `players` qualify this round: 1 in the final, else ~60% (at least 1, fewer than everyone). */
export function showQualifyCount(show: Show, players: number): number {
  if (isFinalRound(show, players)) return 1;
  return Math.max(1, Math.min(players - 1, Math.round(players * SHOW_KEEP)));
}

/** Ids of the top `count` places. */
export function qualifiers(results: readonly RaceResult[], count: number): number[] {
  return [...results]
    .sort((a, b) => a.place - b.place)
    .slice(0, count)
    .map((r) => r.id);
}
