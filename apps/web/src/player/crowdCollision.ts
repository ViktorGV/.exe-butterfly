// Soft crowd collisions (#28): the local player is pushed out of nearby remote players.
// Remote players are never moved; every client runs the same rule, so the result is symmetric in practice.
// Allocation-free: one scan of the remote map per fixed step with a cheap horizontal reject.
import { Anim, PLAYER } from '@wobble/shared/constants';
import type { PlayerState, RemoteState } from '@wobble/shared/types';

export const CROWD = Object.freeze({
  /** Fastest push out of an overlap, m/s (well under the run speed, so nobody is shoved off a ledge). */
  maxPushSpeed: 3,
  /** Push speed per metre of overlap before the cap. */
  stiffness: 12,
  /** Horizontal speed lost per second for each overlapping neighbour (up to 4). */
  crowdDrag: 0.6,
  /** A dive into someone bounces the diver back at this speed. */
  diveBounce: 3,
  /** On first touching someone, both players bounce apart at this speed, m/s. */
  bumpSpeed: 4,
  /** Upward hop added to a bump, m/s. */
  bumpHop: 1.5,
  /** Local feet above a remote player's feet by this fraction of the height count as standing on a head. */
  headFraction: 0.7,
});

export interface CrowdCollision {
  /** Pushes `player` (position and, for dives and drag, velocity) away from overlapping remote players. */
  apply(player: PlayerState, remote: ReadonlyMap<number, RemoteState>, dt: number): number;
}

export function createCrowdCollision(): CrowdCollision {
  const reach = PLAYER.radius * 2;
  const reach2 = reach * reach;
  const headY = PLAYER.height * CROWD.headFraction;
  let wasTouching = false;

  return {
    apply(player, remote, dt) {
      const px = player.pos[0];
      const py = player.pos[1];
      const pz = player.pos[2];
      let pushX = 0;
      let pushZ = 0;
      let touching = 0;
      let bounceX = 0;
      let bounceZ = 0;
      const diving = player.anim === Anim.DIVE;
      for (const [id, r] of remote) {
        const dx = px - r.pos[0];
        if (dx > reach || dx < -reach) continue;
        const dz = pz - r.pos[2];
        if (dz > reach || dz < -reach) continue;
        const dy = py - r.pos[1];
        if (dy >= PLAYER.height || dy <= -PLAYER.height) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= reach2) continue;
        const dist = Math.sqrt(d2);
        // exactly on top of each other: step apart along a direction picked from the id, so it is stable
        const nx = dist > 1e-4 ? dx / dist : Math.cos(id);
        const nz = dist > 1e-4 ? dz / dist : Math.sin(id);
        const depth = reach - dist;
        // landing on a head: slide off instead of standing on it
        const onHead = dy >= headY && player.vel[1] <= 0;
        const speed = Math.min(CROWD.maxPushSpeed, depth * CROWD.stiffness * (onHead ? 2 : 1));
        pushX += nx * speed;
        pushZ += nz * speed;
        touching++;
        if (diving) {
          bounceX += nx;
          bounceZ += nz;
        }
      }
      if (touching === 0) {
        wasTouching = false;
        return 0;
      }
      const firstContact = !wasTouching;
      wasTouching = true;
      // cap the sum so a pile of neighbours cannot launch the player
      const mag = Math.hypot(pushX, pushZ);
      if (mag > CROWD.maxPushSpeed) {
        pushX *= CROWD.maxPushSpeed / mag;
        pushZ *= CROWD.maxPushSpeed / mag;
      }
      player.pos[0] += pushX * dt;
      player.pos[2] += pushZ * dt;
      // dense crowd: lose some speed
      const keep = Math.max(0, 1 - CROWD.crowdDrag * Math.min(touching, 4) * dt);
      player.vel[0] *= keep;
      player.vel[2] *= keep;
      // A new contact bumps us apart. The other client sees the same contact and bumps them too.
      const pm = Math.hypot(pushX, pushZ);
      if (firstContact && !diving && pm > 1e-4) {
        const nx = pushX / pm;
        const nz = pushZ / pm;
        const into = player.vel[0] * nx + player.vel[2] * nz; // < 0 when running into them
        const kick = CROWD.bumpSpeed - Math.min(0, into); // cancel the inward part, then push out
        player.vel[0] += nx * kick;
        player.vel[2] += nz * kick;
        if (player.grounded) player.vel[1] = Math.max(player.vel[1], CROWD.bumpHop);
      }
      if (diving) {
        const b = Math.hypot(bounceX, bounceZ);
        if (b > 1e-4) {
          player.vel[0] = (bounceX / b) * CROWD.diveBounce;
          player.vel[2] = (bounceZ / b) * CROWD.diveBounce;
        }
      }
      return touching;
    },
  };
}
