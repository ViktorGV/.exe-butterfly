// Gun auto-aim: the nearest racer in range. Pure, no Three.js, allocation-free.
import { GUNS, WIRE } from '@wobble/shared/constants';
import { dist2, inCone, isAhead } from '@wobble/shared/butterfly/guns';
import type { RemoteState, Vec3 } from '@wobble/shared/types';

/** The nearest racer (not finished) within range, or -1. `skip` ignores one id (yourself). */
export function nearestTarget(
  me: { readonly pos: Readonly<Vec3> },
  remote: ReadonlyMap<number, RemoteState>,
  skip = -1,
  range: number = GUNS.blaster.rangeM,
): number {
  let best = -1;
  let bestD2 = range * range;
  for (const [id, r] of remote) {
    if (id === skip || (r.flags & WIRE.FLAG_FINISHED) !== 0) continue;
    const dx = r.pos[0] - me.pos[0];
    const dz = r.pos[2] - me.pos[2];
    const d2 = dx * dx + dz * dz;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = id;
    }
  }
  return best;
}

/**
 * Cone gun: writes every racer (not finished, not `skip`) inside the shooter's cone into `out` and returns the
 * count. Mirrors the server pick, so the tracers match who gets hit.
 */
export function coneTargets(
  me: { readonly pos: Readonly<Vec3>; readonly yaw: number },
  remote: ReadonlyMap<number, RemoteState>,
  skip: number,
  out: number[],
  range: number = GUNS.shotgun.rangeM,
  coneDeg: number = GUNS.shotgun.coneDeg,
): number {
  out.length = 0;
  for (const [id, r] of remote) {
    if (id === skip || (r.flags & WIRE.FLAG_FINISHED) !== 0) continue;
    if (inCone(me.pos[0], me.pos[2], me.yaw, r.pos[0], r.pos[2], range, coneDeg)) out.push(id);
  }
  return out.length;
}

/** Homing gun: the nearest racer ahead (toward −Z, not finished) in range, or -1 (nobody ahead). */
export function nearestAhead(
  me: { readonly pos: Readonly<Vec3> },
  remote: ReadonlyMap<number, RemoteState>,
  skip = -1,
  range: number = GUNS.rocket.rangeM,
): number {
  let best = -1;
  let bestD2 = range * range;
  for (const [id, r] of remote) {
    if (id === skip || (r.flags & WIRE.FLAG_FINISHED) !== 0 || !isAhead(me.pos[2], r.pos[2])) continue;
    const d2 = dist2(me.pos[0], me.pos[2], r.pos[0], r.pos[2]);
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = id;
    }
  }
  return best;
}
