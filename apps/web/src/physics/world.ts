// Capsule-vs-colliders queries for the player controller: broadphase, contact gathering and
// surface velocities. Stateless apart from reused scratch storage.
import type { Collider, Vec3 } from '@wobble/shared/types';
import { boundingRadius, createContact, sphereVsPart, type Contact } from './contact.ts';
import { carryPoint } from './math.ts';

export interface CapsuleShape {
  radius: number;
  height: number;
}

/** Sphere centres along the capsule, as heights above the feet. */
export function capsuleSpheres({ radius, height }: CapsuleShape): number[] {
  const bottom = radius;
  const top = Math.max(radius, height - radius);
  const count = Math.max(2, Math.ceil((top - bottom) / (radius * 0.5)) + 1);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(bottom + ((top - bottom) * i) / (count - 1));
  return out;
}

/**
 * Keep the colliders whose bounding sphere comes within `margin` of the capsule.
 * Writes into `out` (reused) and returns it.
 */
export function gatherNearby(
  colliders: readonly Collider[],
  feet: Vec3,
  shape: CapsuleShape,
  margin: number,
  out: Collider[],
): Collider[] {
  out.length = 0;
  const half = shape.height / 2;
  const cx = feet[0];
  const cy = feet[1] + half;
  const cz = feet[2];
  const reach = half + margin;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (!c.part.collide) continue;
    const p = c.pose.pos;
    const r = boundingRadius(c.part) + reach;
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    if (dx * dx + dy * dy + dz * dz <= r * r) out.push(c);
  }
  return out;
}

const tmp = createContact();

/**
 * Deepest contact between the capsule (feet position, sphere heights) and one collider.
 * Returns the sphere index that touched, or -1.
 */
export function capsuleVsCollider(
  feet: Vec3,
  radius: number,
  heights: readonly number[],
  collider: Collider,
  out: Contact,
): number {
  let best = -1;
  out.depth = 0;
  for (let i = 0; i < heights.length; i++) {
    if (sphereVsPart(feet[0], feet[1] + heights[i], feet[2], radius, collider.part, collider.pose, tmp)) {
      if (tmp.depth > out.depth) {
        out.depth = tmp.depth;
        out.normal[0] = tmp.normal[0];
        out.normal[1] = tmp.normal[1];
        out.normal[2] = tmp.normal[2];
        best = i;
      }
    }
  }
  return best;
}

const moved: Vec3 = [0, 0, 0];

/** Velocity (m/s) of the collider's surface at a world point over the last step. */
export function surfaceVelocity(collider: Collider, x: number, y: number, z: number, dt: number, out: Vec3): Vec3 {
  if (dt <= 0) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  carryPoint(collider.prevPose, collider.pose, x, y, z, moved);
  out[0] = (moved[0] - x) / dt;
  out[1] = (moved[1] - y) / dt;
  out[2] = (moved[2] - z) / dt;
  return out;
}
