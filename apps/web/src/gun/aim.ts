// Gun auto-aim: the nearest racer in range. Pure, no Three.js, allocation-free.
import { BUTTERFLY, WIRE } from '@wobble/shared/constants';
import type { RemoteState, Vec3 } from '@wobble/shared/types';

/** The nearest racer (not finished) within range, or -1. `skip` ignores one id (yourself). */
export function nearestTarget(
  me: { readonly pos: Readonly<Vec3> },
  remote: ReadonlyMap<number, RemoteState>,
  skip = -1,
  range = BUTTERFLY.GUN_RANGE_M,
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
