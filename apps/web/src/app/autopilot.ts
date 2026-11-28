// Debug autopilot (#26): drives the local player along the course so smoke tests can reach
// checkpoints without flaky key timing. Enabled in the game with ?autopilot=1.
// It steers toward the next checkpoint (then the finish), jumps over gaps and low hazards.
import type { Collider, CourseDef, InputState, PlayerState } from '@wobble/shared/types';
import { createContact, sphereVsPart } from '../physics/index.ts';

export interface Autopilot {
  /** Fill and return a reused InputState for camera yaw 0 (forward = -Z). */
  drive(player: PlayerState, colliders: readonly Collider[]): InputState;
}

const LOOK_AHEAD = [2.5, 4, 5.5];
/** Distances ahead checked for something tall in the way (close first: a wall the player touches). */
const BLOCK_AHEAD = [0.7, 1.6];

export function createAutopilot(course: Pick<CourseDef, 'checkpoints' | 'finish'>): Autopilot {
  const out: InputState = { moveX: 0, moveY: 0, jump: false, jumpPressed: false, dive: false, divePressed: false };
  const contact = createContact();
  let jumpHeld = 0;
  /** Lane (world x) chosen while grounded, kept through the jump that follows. */
  let laneX: number | null = null;

  /** Is there something solid under (x, z) within reach of height y? */
  const groundAt = (colliders: readonly Collider[], x: number, y: number, z: number) => {
    for (const c of colliders) {
      if (!c.part.collide || c.part.surface === 'bouncy') continue;
      // A small probe just under the feet: a wide one bridges narrow gaps (between spinner discs) and a
      // deep one sits nearer the underside of thin floors, so neither would count as floor.
      if (sphereVsPart(x, y - 0.2, z, 0.25, c.part, c.pose, contact) && contact.normal[1] > 0.5) return true;
    }
    return false;
  };
  /** Is there a solid obstacle at knee/hip height at (x, z)? */
  const blockedAt = (colliders: readonly Collider[], x: number, y: number, z: number) => {
    for (const c of colliders) {
      if (!c.part.collide) continue;
      if (sphereVsPart(x, y + 0.6, z, 0.4, c.part, c.pose, contact) && contact.normal[1] < 0.5) return true;
    }
    return false;
  };

  return {
    drive(p, colliders) {
      const next = p.checkpoint + 1;
      const target = next < course.checkpoints.length ? course.checkpoints[next].volume.pos : course.finish.pos;
      const dx = target[0] - p.pos[0];
      const dz = target[2] - p.pos[2];
      const len = Math.hypot(dx, dz) || 1;
      // camera yaw 0: right = +X, forward = -Z
      out.moveX = dx / len;
      out.moveY = -dz / len;

      // No floor straight ahead (bridges, platform rows): steer to the nearest lane that has some.
      // Looks 2.5 m ahead first, then further, so it also finds floor that starts later (spinner discs).
      if (p.grounded) {
        laneX = null;
        if (!groundAt(colliders, p.pos[0] + (dx / len) * 2.5, p.pos[1], p.pos[2] + (dz / len) * 2.5)) {
          search: for (const ahead of LOOK_AHEAD) {
            const fz = p.pos[2] + (dz / len) * ahead;
            for (let k = 1; k <= 80; k++) {
              const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
              if (groundAt(colliders, p.pos[0] + off, p.pos[1], fz)) {
                laneX = p.pos[0] + off;
                break search;
              }
            }
          }
        }
      }
      // Something tall straight ahead (sliding wall panels): steer to the nearest clear gap.
      if (p.grounded && laneX === null) {
        blocked: for (const ahead of BLOCK_AHEAD) {
          const bz = p.pos[2] + (dz / len) * ahead;
          if (!blockedAt(colliders, p.pos[0] + (dx / len) * ahead, p.pos[1], bz)) continue;
          for (let k = 1; k <= 80; k++) {
            const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
            const x = p.pos[0] + off;
            if (!blockedAt(colliders, x, p.pos[1], bz) && groundAt(colliders, x, p.pos[1], bz)) {
              laneX = x;
              break blocked;
            }
          }
        }
      }
      // Head for the chosen lane, on the ground and through the air until the next landing.
      if (laneX !== null) {
        const lx = laneX - p.pos[0];
        const lz = (dz / len) * 2.5;
        const l = Math.hypot(lx, lz) || 1;
        out.moveX = lx / l;
        out.moveY = -lz / l;
      }
      const hx = out.moveX;
      const hz = -out.moveY;
      const ax = p.pos[0] + hx * 1.6;
      const az = p.pos[2] + hz * 1.6;
      const wantJump = p.grounded && (!groundAt(colliders, ax, p.pos[1], az) || blockedAt(colliders, ax, p.pos[1], az));
      if (wantJump) jumpHeld = 18;
      out.jumpPressed = wantJump;
      out.jump = jumpHeld > 0;
      if (jumpHeld > 0) jumpHeld--;
      return out;
    },
  };
}
