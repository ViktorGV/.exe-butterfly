// Plausibility limits derived from PLAYER and the course (#19). Generous: honest play must never trip them.
import { PLAYER } from '@wobble/shared/constants';
import type { CourseDef } from '@wobble/shared/types';

export const TOLERANCE = 1.25;
export const MAX_STATES_PER_SEC = 30;
export const SPEED_WINDOW_MS = 1000;
/** metres of slack on top of speed x time (quantisation, jitter) */
export const SPEED_SLACK_M = 1.0;
export const BOUNDS_MARGIN_M = 2;
export const GRID_MARGIN_M = 1.5;
/** how high above a spawn grid a player may be (jumping while waiting) */
export const GRID_UP_M = 4;
/** client race time may run this far ahead of / behind the server's */
export const TIME_AHEAD_MS = 600;
export const TIME_BEHIND_MS = 1000;
export const KICK_STRIKES = 8;
export const CORRECT_RESEND_MS = 500;
export const STALE_DISCONNECT_MS = 5000;
export const SAVE_TTL_MS = 2000;
export const SAVE_RADIUS_M = 2;

const TAU = Math.PI * 2;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.abs(v) : d);

export interface RaceLimits {
  /** horizontal m/s */
  maxSpeedH: number;
  /** vertical m/s */
  maxSpeedV: number;
  minFinishMs: number;
}

/** Strongest bounce and fastest carrying surface in the course (defaults from CONTRACTS.md §4). */
function courseExtras(course: CourseDef): { bounce: number; carry: number } {
  let bounce = 0;
  let carry = 0;
  for (const e of course.entities) {
    const p = e.params;
    if (e.kind === 'bumper') bounce = Math.max(bounce, num(p.bounce, 14));
    else if (e.kind === 'pendulum') {
      bounce = Math.max(bounce, num(p.bounce, 12));
      carry = Math.max(carry, (num(p.length, 5.5) * num(p.amplitude, 1.1) * TAU) / Math.max(0.1, num(p.periodSec, 3)));
    } else if (e.kind === 'movingPlatform') {
      const t = Array.isArray(p.travel) ? (p.travel as unknown[]) : [];
      const len = Math.hypot(num(t[0], 0), num(t[1], 0), num(t[2], 0));
      carry = Math.max(carry, (len * Math.PI) / Math.max(0.1, num(p.periodSec, 4)));
    } else if (e.kind === 'sweeper') carry = Math.max(carry, (num(p.armLength, 6) * num(p.rpm, 12) * TAU) / 60);
    else if (e.kind === 'spinnerDisc') carry = Math.max(carry, (num(p.radius, 4) * num(p.rpm, 8) * TAU) / 60);
    if (typeof p.bounce === 'number') bounce = Math.max(bounce, num(p.bounce, 0));
  }
  return { bounce, carry };
}

/** Shortest plausible route: spawn -> each checkpoint -> finish, minus the volumes' depth. */
export function routeLength(course: CourseDef): number {
  let len = 0;
  let from = course.spawn.pos;
  let fromReach = 0;
  for (const v of [...course.checkpoints.map((c) => c.volume), course.finish]) {
    const reach = Math.min(v.half[0], v.half[2]);
    len += Math.max(0, Math.hypot(v.pos[0] - from[0], v.pos[2] - from[2]) - fromReach - reach);
    from = v.pos;
    fromReach = reach;
  }
  return len;
}

export function deriveLimits(course: CourseDef): RaceLimits {
  const { bounce, carry } = courseExtras(course);
  const maxSpeedH = (Math.max(PLAYER.runSpeed, PLAYER.diveSpeed, bounce) + carry) * TOLERANCE;
  const maxSpeedV = Math.max(-PLAYER.maxFallSpeed, PLAYER.jumpVelocity, bounce) * TOLERANCE;
  const minFinishMs = (routeLength(course) / maxSpeedH) * 1000;
  return { maxSpeedH, maxSpeedV, minFinishMs };
}
