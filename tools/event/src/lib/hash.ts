// Hashing and seeded randomness for the event pipeline. Owned by #56, shared with #59 and #63.
import { createHash } from 'node:crypto';

/** JSON with object keys sorted, so equal values always give equal text (and equal hashes). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** SHA-256 of a string (UTF-8) as lower-case hex. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A 32-bit seed from any string. */
export function seedFrom(text: string): number {
  return Number.parseInt(sha256Hex(text).slice(0, 8), 16) >>> 0;
}

/** mulberry32: seeded PRNG returning floats in [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle into a new array, driven by `rng`. */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
