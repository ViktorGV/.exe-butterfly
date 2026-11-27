// Sphere vs primitive part (box / cylinder / sphere) in the part's local frame.
// The player capsule is tested as a few overlapping spheres along its axis.
import type { PartDef, Pose, Vec3 } from '@wobble/shared/types';
import { rotate, toLocal } from './math.ts';

export interface Contact {
  /** Penetration depth in metres (> 0 when touching). */
  depth: number;
  /** World-space normal pointing from the part toward the sphere. */
  normal: Vec3;
}

export function createContact(): Contact {
  return { depth: 0, normal: [0, 1, 0] };
}

const l: Vec3 = [0, 0, 0];
const n: Vec3 = [0, 0, 0];

/**
 * Test a sphere (world centre c, radius r) against a part at a pose.
 * Returns true and fills `out` when they overlap.
 */
export function sphereVsPart(
  cx: number,
  cy: number,
  cz: number,
  r: number,
  part: PartDef,
  pose: Pose,
  out: Contact,
): boolean {
  toLocal(pose, cx, cy, cz, l);
  const [sx, sy, sz] = part.size;
  let depth: number;

  if (part.shape === 'box') {
    const qx = Math.max(-sx, Math.min(sx, l[0]));
    const qy = Math.max(-sy, Math.min(sy, l[1]));
    const qz = Math.max(-sz, Math.min(sz, l[2]));
    const dx = l[0] - qx;
    const dy = l[1] - qy;
    const dz = l[2] - qz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 1e-12) {
      if (d2 >= r * r) return false;
      const d = Math.sqrt(d2);
      n[0] = dx / d;
      n[1] = dy / d;
      n[2] = dz / d;
      depth = r - d;
    } else {
      // Centre inside the box: leave through the nearest face.
      const px = sx - Math.abs(l[0]);
      const py = sy - Math.abs(l[1]);
      const pz = sz - Math.abs(l[2]);
      n[0] = n[1] = n[2] = 0;
      if (py <= px && py <= pz) {
        n[1] = l[1] >= 0 ? 1 : -1;
        depth = r + py;
      } else if (px <= pz) {
        n[0] = l[0] >= 0 ? 1 : -1;
        depth = r + px;
      } else {
        n[2] = l[2] >= 0 ? 1 : -1;
        depth = r + pz;
      }
    }
  } else if (part.shape === 'cylinder') {
    // Axis = local Y, size = [radius, halfHeight, 0]
    const R = sx;
    const H = sy;
    const rl = Math.hypot(l[0], l[2]);
    const outsideR = rl > R;
    const outsideY = Math.abs(l[1]) > H;
    if (outsideR || outsideY) {
      const k = outsideR ? R / rl : 1;
      const qx = l[0] * k;
      const qz = l[2] * k;
      const qy = Math.max(-H, Math.min(H, l[1]));
      const dx = l[0] - qx;
      const dy = l[1] - qy;
      const dz = l[2] - qz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r || d2 < 1e-12) return false;
      const d = Math.sqrt(d2);
      n[0] = dx / d;
      n[1] = dy / d;
      n[2] = dz / d;
      depth = r - d;
    } else {
      const penR = R - rl;
      const penY = H - Math.abs(l[1]);
      if (penY <= penR || rl < 1e-9) {
        n[0] = 0;
        n[1] = l[1] >= 0 ? 1 : -1;
        n[2] = 0;
        depth = r + penY;
      } else {
        n[0] = l[0] / rl;
        n[1] = 0;
        n[2] = l[2] / rl;
        depth = r + penR;
      }
    }
  } else {
    // sphere: size = [radius, 0, 0]
    const d = Math.hypot(l[0], l[1], l[2]);
    const reach = r + sx;
    if (d >= reach) return false;
    if (d < 1e-9) {
      n[0] = 0;
      n[1] = 1;
      n[2] = 0;
    } else {
      n[0] = l[0] / d;
      n[1] = l[1] / d;
      n[2] = l[2] / d;
    }
    depth = reach - d;
  }

  out.depth = depth;
  rotate(pose.quat, n[0], n[1], n[2], out.normal);
  return true;
}

const radiusCache = new WeakMap<PartDef, number>();

/** Radius of a sphere around the part's centre that contains the whole part. */
export function boundingRadius(part: PartDef): number {
  let r = radiusCache.get(part);
  if (r === undefined) {
    const [a, b, c] = part.size;
    r = part.shape === 'box' ? Math.hypot(a, b, c) : part.shape === 'cylinder' ? Math.hypot(a, b) : a;
    radiusCache.set(part, r);
  }
  return r;
}
