// The looks players start with, so a room does not fill up with one character.
import { CORAL_DASH, GRAPE_FIZZ, MINT_ZAP, SUNNY_BEAN, TIDE_POP } from './skins.ts';

/** One built-in skin for each of the five racers (apps/web/src/racers). */
export const STARTER_SKIN_IDS: readonly string[] = [SUNNY_BEAN, MINT_ZAP, GRAPE_FIZZ, CORAL_DASH, TIDE_POP].map(
  (p) => p.id,
);

/** A starter skin for a newcomer: one that the fewest of `taken` wear, picked at random among those. */
export function pickStarterSkin(taken: Iterable<string> = [], random: () => number = Math.random): string {
  const worn = new Map(STARTER_SKIN_IDS.map((id) => [id, 0]));
  for (const id of taken) {
    const n = worn.get(id);
    if (n !== undefined) worn.set(id, n + 1);
  }
  const least = Math.min(...worn.values());
  const free = STARTER_SKIN_IDS.filter((id) => worn.get(id) === least);
  return free[Math.floor(random() * free.length)]!;
}
