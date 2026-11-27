// Debug autopilot (#26): drives the local player along the course so smoke tests can reach
// checkpoints without flaky key timing. Enabled in the game with ?autopilot=1.
// It steers toward the next checkpoint (then the finish), jumps over gaps and low hazards.
import type { Collider, CourseDef, InputState, PlayerState } from '@wobble/shared/types';
import { createContact, sphereVsPart } from '../physics/index.ts';

export interface Autopilot {
  /** Fill and return a reused InputState for camera yaw 0 (forward = -Z). */
  drive(player: PlayerState, colliders: readonly Collider[]): InputState;
}

export function createAutopilot(course: Pick<CourseDef, 'checkpoints' | 'finish'>): Autopilot {
  const out: InputState = { moveX: 0, moveY: 0, jump: false, jumpPressed: false, dive: false, divePressed: false };
  const contact = createContact();
  let jumpHeld = 0;

  /** Is there something solid under (x, z) within reach of height y? */
  const groundAt = (colliders: readonly Collider[], x: number, y: number, z: number) => {
    for (const c of colliders) {
      if (!c.part.collide || c.part.surface === 'bouncy') continue;
      if (sphereVsPart(x, y - 0.4, z, 0.5, c.part, c.pose, contact) && contact.normal[1] > 0.5) return true;
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

      const ax = p.pos[0] + (dx / len) * 1.6;
      const az = p.pos[2] + (dz / len) * 1.6;
      const wantJump = p.grounded && (!groundAt(colliders, ax, p.pos[1], az) || blockedAt(colliders, ax, p.pos[1], az));
      if (wantJump) jumpHeld = 18;
      out.jumpPressed = wantJump;
      out.jump = jumpHeld > 0;
      if (jumpHeld > 0) jumpHeld--;
      return out;
    },
  };
}
