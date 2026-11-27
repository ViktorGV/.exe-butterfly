import type { PartDef } from '../../types.ts';

/** Radius of a sphere around the part's centre that contains the whole part. */
export function boundingRadius(part: PartDef): number {
  const [a, b, c] = part.size;
  return part.shape === 'box' ? Math.hypot(a, b, c) : part.shape === 'cylinder' ? Math.hypot(a, b) : a;
}
