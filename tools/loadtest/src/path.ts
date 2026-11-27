// Path follower: the line a bot walks through the course (spawn -> checkpoints in order -> finish).
import type { CourseDef, Vec3 } from '@wobble/shared/types';

export interface PathPoint {
  pos: Vec3;
  /** distance from the start along the line, metres */
  dist: number;
}

export interface PathFollower {
  readonly length: number;
  /** waypoints: spawn cell, each checkpoint volume centre, finish centre */
  readonly points: readonly PathPoint[];
  /** index of the latest checkpoint whose volume centre has been passed at `t` seconds, -1 before the first */
  checkpointAt(t: number): number;
  /** writes the position, yaw and finished flag at `t` seconds after the start into `out` */
  at(t: number, out: PathState): PathState;
}

export interface PathState {
  pos: Vec3;
  yaw: number;
  finished: boolean;
}

export interface PathOptions {
  /** metres per second along the line; keep below PLAYER.runSpeed */
  speed: number;
  /** sideways wobble amplitude in metres */
  lateral?: number;
  /** wobble phase in radians, so bots do not move in lockstep */
  phase?: number;
}

/** Row-major spawn cell, same layout as the server's grid. */
function cell(course: CourseDef, slot: number): Vec3 {
  const g = course.spawn;
  const cols = Math.max(1, g.cols);
  const lx = ((slot % cols) - (cols - 1) / 2) * g.spacing;
  const lz = Math.floor(slot / cols) * g.spacing;
  const c = Math.cos(g.yaw);
  const s = Math.sin(g.yaw);
  return [g.pos[0] + lx * c + lz * s, g.pos[1], g.pos[2] - lx * s + lz * c];
}

export function createPathFollower(course: CourseDef, slot: number, opts: PathOptions): PathFollower {
  const lateral = opts.lateral ?? 0;
  const phase = opts.phase ?? 0;
  const raw: Vec3[] = [cell(course, slot), ...course.checkpoints.map((c) => c.volume.pos), course.finish.pos];
  const points: PathPoint[] = [];
  let length = 0;
  raw.forEach((pos, i) => {
    if (i > 0) length += Math.hypot(pos[0] - raw[i - 1][0], pos[1] - raw[i - 1][1], pos[2] - raw[i - 1][2]);
    points.push({ pos, dist: length });
  });
  const total = length;

  function segment(d: number): number {
    let i = 1;
    while (i < points.length - 1 && points[i].dist < d) i++;
    return i;
  }

  return {
    length: total,
    points,
    checkpointAt(t) {
      const d = Math.max(0, t) * opts.speed;
      let cp = -1;
      for (let i = 1; i < points.length - 1; i++) if (points[i].dist <= d) cp = i - 1;
      return cp;
    },
    at(t, out) {
      const d = Math.min(total, Math.max(0, t) * opts.speed);
      const i = segment(d);
      const a = points[i - 1];
      const b = points[i];
      const span = b.dist - a.dist;
      const f = span > 1e-9 ? (d - a.dist) / span : 1;
      const dx = b.pos[0] - a.pos[0];
      const dz = b.pos[2] - a.pos[2];
      const len = Math.hypot(dx, dz) || 1;
      // wobble sideways, fading out at both ends so the bot still enters each volume's centre
      const wob = lateral * Math.sin(d * 0.35 + phase) * Math.min(1, d / 4, (total - d) / 4);
      out.pos[0] = a.pos[0] + dx * f + (-dz / len) * wob;
      out.pos[1] = a.pos[1] + (b.pos[1] - a.pos[1]) * f;
      out.pos[2] = a.pos[2] + dz * f + (dx / len) * wob;
      out.yaw = Math.atan2(-dx, -dz);
      out.finished = d >= total;
      return out;
    },
  };
}
