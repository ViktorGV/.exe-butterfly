// Obstacle registry (#14). Parameter names and defaults are frozen in docs/CONTRACTS.md
// ("Obstacle params v1"); see docs/OBSTACLES.md for each kind's parts and motion.
import type { EntityDef, ObstacleKind, PartDef, Pose, Vec3 } from '../../types.ts';
import { boundingRadius } from './bounds.ts';
import type { ObstacleKindExt } from './common.ts';
import { bridge, bumper, gate, movingPlatform, pendulum, ramp, spinnerDisc, sweeper, wall } from './kinds.ts';
import { platform } from './platform.ts';

const registry = new Map<string, ObstacleKindExt>(
  [platform, ramp, sweeper, movingPlatform, bumper, bridge, spinnerDisc, pendulum, gate, wall].map((k) => [k.kind, k]),
);

/** Returns null for unknown kinds (callers skip them, never crash). */
export function getObstacleKind(kind: string): ObstacleKind | null {
  return registry.get(kind) ?? null;
}

/** The kinds implemented so far. */
export function listObstacleKinds(): string[] {
  return [...registry.keys()];
}

/** Seconds per motion cycle, or 0 for static obstacles (and unknown kinds). */
export function periodOf(def: EntityDef): number {
  return registry.get(def.kind)?.period(def) ?? 0;
}

/** Fastest speed (m/s) of any surface point of the obstacle. */
export function maxSurfaceSpeed(def: EntityDef): number {
  return registry.get(def.kind)?.maxSpeed(def) ?? 0;
}

/** Axis-aligned bounds of every collidable or visible part, swept over a full motion cycle. */
export function kindBounds(def: EntityDef, samples = 32): { min: Vec3; max: Vec3 } | null {
  const kind = registry.get(def.kind);
  if (!kind) return null;
  const parts: PartDef[] = kind.parts(def);
  const poses: Pose[] = parts.map(() => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const period = kind.period(def);
  const n = period > 0 ? samples : 1;
  for (let s = 0; s < n; s++) {
    kind.pose(def, (period * s) / n, poses);
    for (let i = 0; i < parts.length; i++) {
      const r = boundingRadius(parts[i]);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], poses[i].pos[k] - r);
        max[k] = Math.max(max[k], poses[i].pos[k] + r);
      }
    }
  }
  return { min, max };
}
