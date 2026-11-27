// Positional attenuation relative to the listener. Y up, yaw 0 faces -Z.

export const HEAR_RADIUS_M = 15;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface Spatial {
  gain: number;
  /** -1 (left) .. 1 (right) */
  pan: number;
}

/** Writes into `out`; returns null when the source is out of earshot. */
export function spatialize(src: Vec3Like, listener: Vec3Like, yaw: number, out: Spatial): Spatial | null {
  const dx = src.x - listener.x;
  const dy = src.y - listener.y;
  const dz = src.z - listener.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d > HEAR_RADIUS_M) return null;
  const t = d / HEAR_RADIUS_M;
  out.gain = (1 - t) * (1 - t);
  // Forward is (-sin yaw, 0, -cos yaw), so right is (cos yaw, 0, -sin yaw).
  const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  out.pan = d < 1e-3 ? 0 : Math.max(-1, Math.min(1, right / d));
  return out;
}
