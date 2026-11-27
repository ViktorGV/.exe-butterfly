// Pure layout maths for theme v2 (#64): course anchors, landmark and signage placement, decor scatter.
// No three.js here so it can be unit tested and reused by the course runtime (#7).
import { quatFromYaw } from '@wobble/shared/course/obstacles/math';
import type { CourseDef, Pose, Vec3 } from '@wobble/shared/types';
import type { LANDMARK_ANCHORS, SIGNAGE_SLOTS } from '@wobble/shared/constants';

export type LandmarkAnchor = (typeof LANDMARK_ANCHORS)[number];
export type SignageSlot = (typeof SIGNAGE_SLOTS)[number];

/** Same shape as CourseRuntime.getAnchors() in docs/CONTRACTS.md §9. */
export interface ThemeAnchors {
  start: Pose;
  finish: Pose;
  checkpoints: Pose[];
  sideBanners: Pose[];
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** What applyThemeV2 needs to know about the course. */
export interface ThemeCourse {
  bounds: Bounds;
  anchors: ThemeAnchors;
  /** Height of the ground plane under the course. Default: bounds.min.y - 2. */
  groundY?: number;
}

const pose = (x: number, y: number, z: number, yaw: number): Pose => ({
  pos: [x, y, z],
  quat: quatFromYaw(yaw, [0, 0, 0, 1]),
});

/** Most side banners placed per side. */
export const MAX_BANNERS_PER_SIDE = 4;

/**
 * Anchors from a CourseDef (createCourseRuntime().getAnchors() has no sideBanners yet, #7).
 * Side banners stand just outside the bounds at each checkpoint (and halfway when there are few),
 * facing the course.
 */
export function computeAnchors(def: CourseDef): ThemeAnchors {
  const { min, max } = def.bounds;
  const start = pose(def.spawn.pos[0], def.spawn.pos[1], def.spawn.pos[2], def.spawn.yaw);
  const finish = pose(def.finish.pos[0], def.finish.pos[1], def.finish.pos[2], def.finish.yaw);
  const checkpoints = def.checkpoints.map((c) => pose(c.volume.pos[0], c.volume.pos[1], c.volume.pos[2], c.volume.yaw));
  const stops = def.checkpoints.map((c) => c.volume.pos);
  if (stops.length < 2) stops.push(lerp3(def.spawn.pos, def.finish.pos, 0.5));
  const sideBanners: Pose[] = [];
  for (const p of stops.slice(0, MAX_BANNERS_PER_SIDE)) {
    // yaw 0 faces -Z; a banner on the left (-X) faces +X, i.e. yaw -PI/2.
    sideBanners.push(pose(min[0] - 1, p[1] + 2.5, p[2], -Math.PI / 2));
    sideBanners.push(pose(max[0] + 1, p[1] + 2.5, p[2], Math.PI / 2));
  }
  return { start, finish, checkpoints, sideBanners };
}

export function courseForTheme(def: CourseDef): ThemeCourse {
  return { bounds: def.bounds, anchors: computeAnchors(def), groundY: Math.min(def.killY, def.bounds.min[1]) - 2 };
}

export function groundYOf(course: ThemeCourse): number {
  return course.groundY ?? course.bounds.min[1] - 2;
}

function lerp3(a: readonly number[], b: readonly number[], t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Distance landmarks keep from the playable bounds, in metres. */
export const LANDMARK_MARGIN = 18;

/** Base pose of a landmark (its prims are relative to this), always outside the playable bounds. */
export function landmarkPose(anchor: LandmarkAnchor, course: ThemeCourse): Pose {
  const { min, max } = course.bounds;
  const y = groundYOf(course);
  const zAt = (t: number) => max[2] + (min[2] - max[2]) * t;
  const cx = (min[0] + max[0]) / 2;
  switch (anchor) {
    case 'start':
      return pose(course.anchors.start.pos[0], y, max[2] + LANDMARK_MARGIN + 8, 0);
    case 'finish':
      return pose(course.anchors.finish.pos[0], y, min[2] - LANDMARK_MARGIN - 8, 0);
    case 'skylineLeft':
      return pose(min[0] - LANDMARK_MARGIN * 3.5, y, zAt(0.35), Math.PI / 2);
    case 'skylineRight':
      return pose(max[0] + LANDMARK_MARGIN * 3.5, y, zAt(0.65), -Math.PI / 2);
    case 'midway':
      return pose(cx + (max[0] - min[0]) / 2 + LANDMARK_MARGIN * 1.6, y, zAt(0.5), -Math.PI / 2);
  }
}

/** Where each signage image goes: the anchor pose raised to arch height, facing incoming players (+Z). */
export function signagePoses(slot: SignageSlot, anchors: ThemeAnchors): Pose[] {
  const up = (p: Pose, dy: number, dz = 0): Pose => ({ pos: [p.pos[0], p.pos[1] + dy, p.pos[2] + dz], quat: p.quat });
  switch (slot) {
    case 'startArch':
      return [up(anchors.start, 6.5, -4)];
    case 'checkpoint':
      return anchors.checkpoints.map((p) => up(p, 6));
    case 'finishGate':
      return [up(anchors.finish, 7)];
    case 'sideBanner':
      return anchors.sideBanners;
  }
}

/** mulberry32, deterministic in every engine. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export interface ScatterOptions {
  /** Keep-out distance around the playable bounds. Default 6 m. */
  margin?: number;
  /** How far beyond the bounds decor may go. Default 90 m. */
  reach?: number;
}

/** True when (x, z) is inside the bounds grown by `margin` on X and Z. */
export function insideBounds(x: number, z: number, b: Bounds, margin = 0): boolean {
  return x > b.min[0] - margin && x < b.max[0] + margin && z > b.min[2] - margin && z < b.max[2] + margin;
}

/** `count` deterministic [x, z] points around the course, never inside the playable bounds + margin. */
export function scatterOutside(
  count: number,
  bounds: Bounds,
  seed: number,
  opts: ScatterOptions = {},
): [number, number][] {
  const margin = opts.margin ?? 6;
  const reach = opts.reach ?? 90;
  const rng = createRng(seed);
  const x0 = bounds.min[0] - reach;
  const x1 = bounds.max[0] + reach;
  const z0 = bounds.min[2] - reach;
  const z1 = bounds.max[2] + reach;
  const out: [number, number][] = [];
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    const x = x0 + rng() * (x1 - x0);
    const z = z0 + rng() * (z1 - z0);
    if (!insideBounds(x, z, bounds, margin)) out.push([x, z]);
  }
  return out;
}
