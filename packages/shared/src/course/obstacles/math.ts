// Allocation-free maths on plain arrays (no Three.js: this runs on the server and in bots too).
// Seeded by #2 with the minimum the platform kind needs; extended by #14.
import type { Quat, Vec3 } from '../../types.ts';

/** Quaternion for a rotation of `yaw` radians about +Y. Writes into `out`. */
export function quatFromYaw(yaw: number, out: Quat = [0, 0, 0, 1]): Quat {
  const h = yaw * 0.5;
  out[0] = 0;
  out[1] = Math.sin(h);
  out[2] = 0;
  out[3] = Math.cos(h);
  return out;
}

/** Rotate the vector (x, y, z) by yaw about +Y and write it into `out`. */
export function rotateYaw(x: number, y: number, z: number, yaw: number, out: Vec3): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out[0] = x * c + z * s;
  out[1] = y;
  out[2] = -x * s + z * c;
  return out;
}
