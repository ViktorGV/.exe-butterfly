// Playability linter (#15). Every assembled or generated course must pass with zero errors.
//
// The core rule is reachability: starting on the spawn surface, the player must be able to reach
// every checkpoint pad and the finish by moving between walkable surfaces whose horizontal gap is
// at most LIMITS.maxGap and whose step up is at most LIMITS.maxStepUp. Moving surfaces count if
// such a window exists at some point in their cycle.
//
// A bounce pad (#110) launches a running player much further than a jump, so the gap from a pad to
// the next surface may be up to bouncePadReach() instead of LIMITS.maxGap.
import { LIMITS, PLAYER, POS_SCALE } from '../constants.ts';
import type { CourseDef, EntityDef, LintResult, PartDef, Pose, SpawnGrid, Vec3, Volume } from '../types.ts';
import { getObstacleKind, periodOf } from './obstacles/index.ts';

const WALKABLE = new Set(['platform', 'ramp', 'bridge', 'movingPlatform', 'spinnerDisc', 'bouncePad', 'carousel']);
const INT16_LIMIT = 32767 / POS_SCALE;
const SAMPLES = 48;
/** Share of a pad's ideal jump distance the linter counts on (the player may not be at full speed). */
export const BOUNCE_PAD_SAFETY = 0.8;

/**
 * Longest gap (m) a bounce pad gets a running player across: launched at `bounce` m/s along the pad's
 * up axis (`upY` = its vertical component), keeping run speed forward, landing back at pad height.
 */
export function bouncePadReach(bounce: number, upY: number): number {
  const airTime = (2 * bounce * upY) / -PLAYER.gravity;
  return Math.max(LIMITS.maxGap, PLAYER.runSpeed * airTime * BOUNCE_PAD_SAFETY);
}

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** top surface height range (a ramp spans a range) */
  topLo: number;
  topHi: number;
}

interface Surface {
  entity: EntityDef;
  part: PartDef;
  index: number;
  moving: boolean;
  period: number;
  at(t: number): Rect;
  swept: Rect;
  /** Longest gap a player can cross leaving this surface (LIMITS.maxGap, more for a bounce pad). */
  reach: number;
}

/** Exact axis-aligned half extents of a rotated part. */
function halfExtents(part: PartDef, pose: Pose): { half: number[]; m: number[][]; h: Vec3 } {
  const [x, y, z, w] = pose.quat;
  // Rotation matrix rows
  const m = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
  const h: Vec3 =
    part.shape === 'box'
      ? part.size
      : part.shape === 'cylinder'
        ? [part.size[0], part.size[1], part.size[0]]
        : [part.size[0], part.size[0], part.size[0]];
  const half = m.map((row) => Math.abs(row[0]) * h[0] + Math.abs(row[1]) * h[1] + Math.abs(row[2]) * h[2]);
  return { half, m, h };
}

function partRect(part: PartDef, pose: Pose): Rect {
  const { half, m, h } = halfExtents(part, pose);
  const top = pose.pos[1] + half[1];
  // A tilted top face (ramp) spans this much height from its low edge to its high edge.
  const slope = 2 * (Math.abs(m[1][0]) * h[0] + Math.abs(m[1][2]) * h[2]);
  return {
    minX: pose.pos[0] - half[0],
    maxX: pose.pos[0] + half[0],
    minZ: pose.pos[2] - half[2],
    maxZ: pose.pos[2] + half[2],
    topLo: top - slope,
    topHi: top,
  };
}

function surfacesOf(course: CourseDef, warnings: string[]): Surface[] {
  const out: Surface[] = [];
  for (const e of course.entities) {
    const kind = getObstacleKind(e.kind);
    if (!kind) {
      warnings.push(`entity ${e.id}: unknown kind "${e.kind}" is ignored`);
      continue;
    }
    if (!WALKABLE.has(e.kind)) continue;
    const parts = kind.parts(e);
    const poses: Pose[] = parts.map(() => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
    const period = periodOf(e);
    parts.forEach((part, index) => {
      // The ridges on a spinnerDisc are obstacles to hop, not floor to walk on.
      if (!part.collide || (e.kind === 'spinnerDisc' && index > 0)) return;
      const at = (t: number) => {
        kind.pose(e, t, poses);
        return partRect(part, poses[index]);
      };
      const swept = at(0);
      if (period > 0) {
        for (let s = 1; s < SAMPLES; s++) {
          const r = at((period * s) / SAMPLES);
          swept.minX = Math.min(swept.minX, r.minX);
          swept.maxX = Math.max(swept.maxX, r.maxX);
          swept.minZ = Math.min(swept.minZ, r.minZ);
          swept.maxZ = Math.max(swept.maxZ, r.maxZ);
          swept.topLo = Math.min(swept.topLo, r.topLo);
          swept.topHi = Math.max(swept.topHi, r.topHi);
        }
      }
      let reach: number = LIMITS.maxGap;
      if (part.pad && part.surface === 'bouncy') {
        kind.pose(e, 0, poses);
        reach = bouncePadReach(part.bounce ?? 12, halfExtents(part, poses[index]).m[1][1]);
      }
      out.push({ entity: e, part, index, moving: period > 0, period, at, swept, reach });
    });
  }
  return out;
}

/** Exact AABB of every part of an entity, swept over its motion cycle. */
function exactBounds(e: EntityDef): { min: Vec3; max: Vec3 } | null {
  const kind = getObstacleKind(e.kind);
  if (!kind) return null;
  const parts = kind.parts(e);
  const poses: Pose[] = parts.map(() => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const period = periodOf(e);
  const n = period > 0 ? SAMPLES : 1;
  for (let s = 0; s < n; s++) {
    kind.pose(e, (period * s) / n, poses);
    parts.forEach((part, i) => {
      const { half } = halfExtents(part, poses[i]);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], poses[i].pos[k] - half[k]);
        max[k] = Math.max(max[k], poses[i].pos[k] + half[k]);
      }
    });
  }
  return { min, max };
}

const gap = (a: Rect, b: Rect) =>
  Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));

/** Can a player get from a to b at time-aligned rects, crossing at most `reach` metres? */
const passable = (a: Rect, b: Rect, reach: number) => gap(a, b) <= reach && b.topLo - a.topHi <= LIMITS.maxStepUp;

function canMove(a: Surface, b: Surface): boolean {
  // Cheap reject using the swept rects first.
  if (gap(a.swept, b.swept) > a.reach || b.swept.topLo - a.swept.topHi > LIMITS.maxStepUp) return false;
  if (!a.moving && !b.moving) return passable(a.swept, b.swept, a.reach);
  const span = Math.max(a.period, b.period) * (a.period && b.period && a.period !== b.period ? 4 : 1);
  for (let s = 0; s < SAMPLES * 2; s++) {
    const t = (span * s) / (SAMPLES * 2);
    if (passable(a.at(t), b.at(t), a.reach)) return true;
  }
  return false;
}

function inside(r: Rect, x: number, z: number, margin = 0) {
  return x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin;
}

/** World positions of a grid's four corner slots (first and last row, first and last column). */
function gridCorners(g: SpawnGrid, slots = 300): [number, number][] {
  const rows = Math.ceil(slots / g.cols);
  const half = ((g.cols - 1) * g.spacing) / 2;
  const back = (rows - 1) * g.spacing;
  const c = Math.cos(g.yaw);
  const s = Math.sin(g.yaw);
  return [
    [-half, 0],
    [half, 0],
    [-half, back],
    [half, back],
  ].map(([lx, lz]) => [g.pos[0] + lx * c + lz * s, g.pos[2] - lx * s + lz * c]);
}

function volumeCentre(v: Volume): [number, number] {
  return [v.pos[0], v.pos[2]];
}

export function lintCourse(course: CourseDef): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (course.entities.length > LIMITS.maxEntities)
    errors.push(`too many entities: ${course.entities.length} > ${LIMITS.maxEntities}`);

  // Geometry extent, int16 range and killY.
  let minY = Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const e of course.entities) {
    const b = exactBounds(e);
    if (!b) continue;
    minY = Math.min(minY, b.min[1]);
    minZ = Math.min(minZ, b.min[2]);
    maxZ = Math.max(maxZ, b.max[2]);
    if ([...b.min, ...b.max].some((v) => Math.abs(v) > INT16_LIMIT))
      errors.push(`entity ${e.id} reaches outside the int16 position range (±${INT16_LIMIT.toFixed(0)} m)`);
  }
  if (maxZ - minZ > LIMITS.maxCourseLength)
    errors.push(`course too long: ${(maxZ - minZ).toFixed(1)} m > ${LIMITS.maxCourseLength} m`);
  if (Number.isFinite(minY) && course.killY >= minY - 1)
    errors.push(`killY ${course.killY} must be below all geometry (lowest point ${minY.toFixed(2)})`);

  // Order: checkpoints toward -Z, finish beyond the last one.
  let lastZ = course.spawn.pos[2];
  course.checkpoints.forEach((cp, i) => {
    if (cp.volume.pos[2] >= lastZ) errors.push(`checkpoint ${i} is not further along the course than the previous one`);
    lastZ = cp.volume.pos[2];
  });
  if (course.finish.pos[2] >= lastZ) errors.push('finish is not beyond the last checkpoint');

  const surfaces = surfacesOf(course, warnings);

  // Lanes: every walkable surface is at least minLaneWidth wide.
  for (const s of surfaces) {
    const r = s.swept;
    const q = s.moving ? s.at(0) : r;
    const narrow = Math.min(q.maxX - q.minX, q.maxZ - q.minZ);
    if (narrow < LIMITS.minLaneWidth - 1e-6)
      errors.push(`entity ${s.entity.id} (${s.entity.kind}) is narrower than ${LIMITS.minLaneWidth} m`);
  }

  // Spawn and respawn grids stand on static ground at the grid height.
  const onGround = (g: SpawnGrid) =>
    gridCorners(g).every(([x, z]) =>
      surfaces.some((s) => !s.moving && inside(s.swept, x, z) && Math.abs(s.swept.topHi - g.pos[1]) < 0.3),
    );
  if (!onGround(course.spawn)) errors.push('spawn grid is not fully on solid ground');
  course.checkpoints.forEach((cp, i) => {
    if (!onGround(cp.respawn)) errors.push(`checkpoint ${i} respawn grid is not fully on solid ground`);
  });

  // Reachability from the spawn surface.
  const surfaceUnder = (x: number, z: number, y: number) =>
    surfaces.findIndex((s) => inside(s.swept, x, z, 0.5) && s.swept.topHi <= y + 2 && s.swept.topHi >= y - 4);
  const start = surfaceUnder(course.spawn.pos[0], course.spawn.pos[2], course.spawn.pos[1]);
  if (start < 0) {
    errors.push('no walkable surface under the spawn point');
  } else {
    const reached = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const a = surfaces[queue.shift()!];
      for (let j = 0; j < surfaces.length; j++) {
        if (!reached.has(j) && canMove(a, surfaces[j])) {
          reached.add(j);
          queue.push(j);
        }
      }
    }
    const reachable = (v: Volume) => {
      const [x, z] = volumeCentre(v);
      return surfaces.some(
        (s, i) => reached.has(i) && inside(s.swept, x, z) && Math.abs(s.swept.topHi - (v.pos[1] - v.half[1])) < 2,
      );
    };
    const rule = `no path within maxGap ${LIMITS.maxGap} m and maxStepUp ${LIMITS.maxStepUp} m`;
    course.checkpoints.forEach((cp, i) => {
      if (!reachable(cp.volume)) errors.push(`checkpoint ${i} is unreachable (${rule})`);
    });
    if (!reachable(course.finish)) errors.push(`finish is unreachable (${rule})`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
