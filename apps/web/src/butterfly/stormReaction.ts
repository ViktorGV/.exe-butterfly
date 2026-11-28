// Villain reactions to the storm bar (#84): every quarter of STORM_MAX the villain says something short.

export const STORM_LINES: readonly string[] = Object.freeze([
  'Heh heh… the villain stirs.',
  'The villain grows stronger…',
  'The villain laughs. The storm is rising!',
  'The villain is at full power!',
]);

/**
 * The quarter (1..4) the storm just reached going from `prev` to `level`, or 0 when no quarter boundary
 * was crossed. Several quarters crossed at once report the highest one.
 */
export function stormQuarterCrossed(prev: number, level: number, max: number): number {
  if (max <= 0 || level <= prev) return 0;
  const q = (v: number) => Math.min(4, Math.floor((Math.max(0, v) / max) * 4 + 1e-9));
  const now = q(level);
  return now > q(prev) ? now : 0;
}

/** The villain's line for a storm step, or null when it stays quiet. */
export function stormLine(prev: number, level: number, max: number): string | null {
  const q = stormQuarterCrossed(prev, level, max);
  return q > 0 ? STORM_LINES[q - 1] : null;
}
