// Grab targeting (#84): picks who one press of Grab would affect and what it would do.
// Aim assist: the nearest player in front of you within reach, no precise aiming. Allocation-free.
import { Anim, BUTTERFLY } from '@wobble/shared/constants';
import { bestGrabKind, grabKindFor, GRAB_PRIORITY, type TargetSituation } from '@wobble/shared/butterfly/index';
import type { GrabKind, PlayerState, RemoteState } from '@wobble/shared/types';

export interface GrabTarget {
  /** player id, or -1 when nobody is in reach */
  id: number;
  kind: GrabKind | null;
  /** unit vector on the floor from you toward the target */
  dirX: number;
  dirZ: number;
}

/** How a remote player looks from its animation: falling off an edge, knocked down, or just standing. */
export function situationOf(anim: number, belowMe: number): TargetSituation {
  // FALL below the floor you stand on means off the edge (a normal jump also has the FALL pose)
  if (anim === Anim.FALL && belowMe > 0.6) return 'falling';
  if (anim === Anim.STUMBLE || anim === Anim.PRONE || anim === Anim.KNOCKED) return 'knockedDown';
  return 'standing';
}

/** Vertical room for catching a falling player (they are below the edge). */
const FALL_REACH_Y = 3;

export function createGrabTargeting() {
  const out: GrabTarget = { id: -1, kind: null, dirX: 0, dirZ: -1 };
  const reach = BUTTERFLY.GRAB_REACH_M;
  const reach2 = reach * reach;
  return {
    /** Finds the target for `me` among `remote`. Returns the same object every call. */
    find(me: PlayerState, remote: ReadonlyMap<number, RemoteState>): Readonly<GrabTarget> {
      const fx = -Math.sin(me.yaw);
      const fz = -Math.cos(me.yaw);
      let bestRank = GRAB_PRIORITY.length;
      let bestD2 = Infinity;
      out.id = -1;
      out.kind = null;
      for (const [id, r] of remote) {
        const dx = r.pos[0] - me.pos[0];
        const dz = r.pos[2] - me.pos[2];
        const d2 = dx * dx + dz * dz;
        if (d2 > reach2) continue;
        const below = me.pos[1] - r.pos[1];
        const sit = situationOf(r.anim, below);
        // a falling player may be well below the edge; everyone else must be on about the same level
        if (sit === 'falling' ? below > FALL_REACH_Y : Math.abs(below) > 1.2) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const front = (dx * fx + dz * fz) / d;
        if (front < 0 && d > 0.8) continue; // behind you and not right next to you
        const kind = grabKindFor(sit);
        const rank = GRAB_PRIORITY.indexOf(kind);
        if (rank < bestRank || (rank === bestRank && d2 < bestD2)) {
          bestRank = rank;
          bestD2 = d2;
          out.id = id;
          out.kind = kind;
          out.dirX = dx / d;
          out.dirZ = dz / d;
        }
      }
      return out;
    },
  };
}

export { bestGrabKind };
