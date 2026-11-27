// Tier assignment for the crowd (#9): which players get a full-detail Wobbler. Pure and allocation-free.

/** Squared-distance multiplier for players already in the near tier, so they stay a bit longer (~13% in distance). */
export const NEAR_STICKY = 0.75;

export interface TierScratch {
  idx: Int32Array;
  score: Float32Array;
}

export function createTierScratch(max: number): TierScratch {
  return { idx: new Int32Array(max), score: new Float32Array(max) };
}

/**
 * Pick up to `nearMax` of the `n` slots with the smallest `dist2` (Infinity = hidden, never near).
 * Slots with `wasNear[i] = 1` get their distance scaled by `NEAR_STICKY` (hysteresis). At most
 * `maxPromote` slots that were not near may enter the tier per call, so a big crossing is spread
 * over a few frames. Writes 0/1 into `outNear` and returns the near count.
 */
export function assignTiers(
  n: number,
  dist2: Float32Array,
  wasNear: Uint8Array,
  outNear: Uint8Array,
  nearMax: number,
  maxPromote: number,
  s: TierScratch,
): number {
  const { idx, score } = s;
  let m = 0;
  for (let i = 0; i < n; i++) {
    outNear[i] = 0;
    const d = dist2[i]!;
    if (d === Infinity) continue;
    score[i] = wasNear[i] ? d * NEAR_STICKY : d;
    idx[m++] = i;
  }
  const k = Math.min(nearMax, m);
  if (k <= 0) return 0;
  if (k < m) select(idx, score, 0, m - 1, k);
  let promote = 0;
  for (let j = 0; j < k; j++) if (!wasNear[idx[j]!]) promote++;
  // Over budget: admit the closest newcomers first.
  if (promote > maxPromote) sortRange(idx, score, 0, k - 1);
  let count = 0;
  let promoted = 0;
  for (let j = 0; j < k; j++) {
    const i = idx[j]!;
    if (!wasNear[i]) {
      if (promoted >= maxPromote) continue;
      promoted++;
    }
    outNear[i] = 1;
    count++;
  }
  return count;
}

/** Quickselect (Hoare): afterwards idx[0..k-1] hold the k smallest scores, unordered. */
function select(idx: Int32Array, score: Float32Array, lo: number, hi: number, k: number): void {
  const target = k - 1;
  while (hi > lo) {
    const pivot = score[idx[(lo + hi) >> 1]!]!;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (score[idx[i]!]! < pivot) i++;
      while (score[idx[j]!]! > pivot) j--;
      if (i <= j) {
        const t = idx[i]!;
        idx[i] = idx[j]!;
        idx[j] = t;
        i++;
        j--;
      }
    }
    if (target <= j) hi = j;
    else if (target >= i) lo = i;
    else return;
  }
}

/** Insertion sort of idx[lo..hi] by score; meant for short ranges. */
export function sortRange(idx: Int32Array, score: Float32Array, lo: number, hi: number): void {
  for (let a = lo + 1; a <= hi; a++) {
    const v = idx[a]!;
    const sv = score[v]!;
    let b = a - 1;
    while (b >= lo && score[idx[b]!]! > sv) {
      idx[b + 1] = idx[b]!;
      b--;
    }
    idx[b + 1] = v;
  }
}
