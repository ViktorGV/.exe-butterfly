// Allocation-free vector and quaternion helpers on plain arrays (x, y, z, w).
import type { Pose, Quat, Vec3 } from '@wobble/shared/types';

/** out = q * v * q^-1 */
export function rotate(q: Quat, x: number, y: number, z: number, out: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
  return out;
}

/** out = q^-1 * v * q (rotation by the conjugate; q is a unit quaternion) */
export function rotateInverse(q: Quat, x: number, y: number, z: number, out: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (-qy * z + qz * y);
  const ty = 2 * (-qz * x + qx * z);
  const tz = 2 * (-qx * y + qy * x);
  out[0] = x + qw * tx + (-qy * tz + qz * ty);
  out[1] = y + qw * ty + (-qz * tx + qx * tz);
  out[2] = z + qw * tz + (-qx * ty + qy * tx);
  return out;
}

const scratch: Vec3 = [0, 0, 0];

/** World point -> collider-local point. */
export function toLocal(pose: Pose, x: number, y: number, z: number, out: Vec3): Vec3 {
  return rotateInverse(pose.quat, x - pose.pos[0], y - pose.pos[1], z - pose.pos[2], out);
}

/** Collider-local point -> world point. */
export function toWorld(pose: Pose, x: number, y: number, z: number, out: Vec3): Vec3 {
  rotate(pose.quat, x, y, z, scratch);
  out[0] = scratch[0] + pose.pos[0];
  out[1] = scratch[1] + pose.pos[1];
  out[2] = scratch[2] + pose.pos[2];
  return out;
}

const local: Vec3 = [0, 0, 0];

/** Where a world point attached to a collider at prevPose ends up at pose. */
export function carryPoint(prev: Pose, curr: Pose, x: number, y: number, z: number, out: Vec3): Vec3 {
  toLocal(prev, x, y, z, local);
  return toWorld(curr, local[0], local[1], local[2], out);
}

/** Rotation about +Y between two orientations (radians), for carrying a player's yaw. */
export function yawDelta(prev: Quat, curr: Quat): number {
  // d = curr * conj(prev); keep its twist about Y.
  const [ax, ay, az, aw] = curr;
  const bx = -prev[0];
  const by = -prev[1];
  const bz = -prev[2];
  const bw = prev[3];
  const dy = aw * by + ay * bw + az * bx - ax * bz;
  const dw = aw * bw - ax * bx - ay * by - az * bz;
  return 2 * Math.atan2(dy, dw);
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
