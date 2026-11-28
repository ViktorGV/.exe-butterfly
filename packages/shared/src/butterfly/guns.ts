// Gun kinds (#210): pure targeting and effect helpers shared by the server checks and the client aim.
// No allocations: callers pass positions as numbers.
import { GUN_LADDER, GUN_LADDER_REPEAT, GUNS } from '../constants.ts';
import type { GunKind } from '../types.ts';

export type GunDef = (typeof GUNS)[GunKind];

export const gunDef = (kind: GunKind): GunDef => GUNS[kind];

/** The gun earned at exactly `hits` hits received (GUN_LADDER), or null when this hit earns nothing. */
export function gunForHits(hits: number): GunKind | null {
  for (const step of GUN_LADDER) if (hits === step.hits) return step.kind;
  const last = GUN_LADDER[GUN_LADDER.length - 1]!;
  if (hits > last.hits && (hits - last.hits) % GUN_LADDER_REPEAT === 0) return last.kind;
  return null;
}

/** xz distance squared. */
export const dist2 = (ax: number, az: number, bx: number, bz: number) => (bx - ax) ** 2 + (bz - az) ** 2;

/** Ahead on the course (it runs toward −Z): b is further along than a. */
export const isAhead = (az: number, bz: number) => bz < az;

/**
 * Whether b is inside the cone in front of a shooter at a facing `yaw` (yaw 0 faces −Z): within `range` and
 * within half of `coneDeg` of the facing. The shooter's own spot (distance 0) is never inside.
 */
export function inCone(ax: number, az: number, yaw: number, bx: number, bz: number, range: number, coneDeg: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const d = Math.hypot(dx, dz);
  if (d <= 1e-6 || d > range) return false;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return (dx * fx + dz * fz) / d >= Math.cos(((coneDeg / 2) * Math.PI) / 180);
}
