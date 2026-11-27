// Stage 4 rules, enforced in code: no shared primary setting, and average palettes far enough apart. Owned by #56.

export const PICK_COUNT = 5;
/** Minimum distance between two picks' average palette colours, in OKLab (0.08 ≈ clearly different tints). */
export const MIN_PALETTE_DISTANCE = 0.08;

export type Lab = [number, number, number];

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** #rrggbb -> OKLab. */
export function hexToOklab(hex: string): Lab {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = linear(((n >> 16) & 255) / 255);
  const g = linear(((n >> 8) & 255) / 255);
  const b = linear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** The mean colour of a palette. */
export function averageColor(palette: readonly string[]): Lab {
  const sum: Lab = [0, 0, 0];
  for (const hex of palette) hexToOklab(hex).forEach((v, i) => (sum[i] += v));
  const n = Math.max(1, palette.length);
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

export const paletteDistance = (a: readonly string[], b: readonly string[]) => {
  const x = averageColor(a);
  const y = averageColor(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

const SYNONYMS: Readonly<Record<string, string>> = {
  sea: 'ocean',
  underwater: 'ocean',
  'deep sea': 'ocean',
  reef: 'ocean',
  galaxy: 'space',
  'outer space': 'space',
  cosmos: 'space',
  ice: 'snow',
  winter: 'snow',
  arctic: 'snow',
  woods: 'forest',
  rainforest: 'jungle',
  town: 'city',
  sweets: 'candy',
  bakery: 'candy',
  clouds: 'sky',
};

/** Comparable form of a setting tag: lower-case, punctuation to spaces, common synonyms and plurals folded. */
export function normalizeSetting(tag: string): string {
  let t = tag
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  t = SYNONYMS[t] ?? t;
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  return SYNONYMS[t] ?? t;
}

export interface Look {
  settingTags: readonly string[];
  paletteHint: readonly string[];
}

export interface Rules {
  distinctSettings: boolean;
  minPaletteDistance: number;
}

export function compatible(a: Look, b: Look, rules: Rules): boolean {
  if (rules.distinctSettings && normalizeSetting(a.settingTags[0]) === normalizeSetting(b.settingTags[0])) return false;
  return paletteDistance(a.paletteHint, b.paletteHint) >= rules.minPaletteDistance - 1e-9;
}

/**
 * The first `count` mutually compatible items in preference order: it keeps each higher-preference item
 * whenever a full set can still be completed with it. Returns null if no such set exists.
 */
export function findSet<T>(items: readonly T[], look: (item: T) => Look, rules: Rules, count = PICK_COUNT): T[] | null {
  const ok = items.map((a) => items.map((b) => compatible(look(a), look(b), rules)));
  const chosen: number[] = [];
  const search = (pool: number[]): boolean => {
    if (chosen.length === count) return true;
    for (let i = 0; i <= pool.length - (count - chosen.length); i++) {
      const next = pool[i];
      chosen.push(next);
      if (search(pool.slice(i + 1).filter((j) => ok[next][j]))) return true;
      chosen.pop();
    }
    return false;
  };
  return search(items.map((_, i) => i)) ? chosen.map((i) => items[i]) : null;
}

export interface VarietyChoice<T> {
  picks: T[];
  /** Human-readable notes for every rule that had to be relaxed. */
  relaxed: string[];
}

/**
 * Choose PICK_COUNT items. `preferred` (the shortlist, best first) is tried before `all`. If the rules
 * cannot be met even with `all`, the palette rule is relaxed first, then the setting rule.
 */
export function chooseVaried<T>(preferred: readonly T[], all: readonly T[], look: (item: T) => Look): VarietyChoice<T> {
  if (all.length < PICK_COUNT) throw new Error(`only ${all.length} usable game prompts; need ${PICK_COUNT}`);
  const levels: Array<Rules & { note: string | null }> = [
    { distinctSettings: true, minPaletteDistance: MIN_PALETTE_DISTANCE, note: null },
    {
      distinctSettings: true,
      minPaletteDistance: MIN_PALETTE_DISTANCE / 2,
      note: `palette distance lowered to ${MIN_PALETTE_DISTANCE / 2}`,
    },
    { distinctSettings: true, minPaletteDistance: 0, note: 'palette distance rule dropped' },
    {
      distinctSettings: false,
      minPaletteDistance: 0,
      note: 'primary-setting and palette rules dropped (fewer than 5 different settings)',
    },
  ];
  for (const level of levels) {
    for (const pool of [preferred, all]) {
      const picks = findSet(pool, look, level);
      if (picks) return { picks, relaxed: level.note ? [level.note] : [] };
    }
  }
  throw new Error('unreachable: the last level accepts any set');
}
