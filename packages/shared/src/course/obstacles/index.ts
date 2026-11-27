// Obstacle registry. Seeded by #2 with `platform` only; every other kind is added by #14.
// Parameter names and defaults are frozen in docs/CONTRACTS.md ("Obstacle params v1").
import type { ObstacleKind } from '../../types.ts';
import { platform } from './platform.ts';

const registry = new Map<string, ObstacleKind>([[platform.kind, platform]]);

/** Returns null for unknown kinds (callers skip them, never crash). */
export function getObstacleKind(kind: string): ObstacleKind | null {
  return registry.get(kind) ?? null;
}

/** The kinds implemented so far. */
export function listObstacleKinds(): string[] {
  return [...registry.keys()];
}
