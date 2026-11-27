// Uniform Catmull-Rom spline through a list of points (pure, no allocation per call).
// The curve passes through every point, starting at points[0] and ending at points[n - 1].
import type { Vec3 } from '@wobble/shared/types';

function cr(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Point at `u` in [0, 1] along the spline through `points[0..count)`. Writes into `out`. */
export function sampleSpline(points: readonly Vec3[], count: number, u: number, out: Vec3): Vec3 {
  if (count <= 0) return out;
  if (count === 1 || u <= 0) {
    const p = points[0];
    out[0] = p[0];
    out[1] = p[1];
    out[2] = p[2];
    return out;
  }
  if (u >= 1) {
    const p = points[count - 1];
    out[0] = p[0];
    out[1] = p[1];
    out[2] = p[2];
    return out;
  }
  const segs = count - 1;
  const f = u * segs;
  const i = Math.min(segs - 1, Math.floor(f));
  const t = f - i;
  const a = points[i > 0 ? i - 1 : 0];
  const b = points[i];
  const c = points[i + 1];
  const d = points[i + 2 < count ? i + 2 : count - 1];
  out[0] = cr(a[0], b[0], c[0], d[0], t);
  out[1] = cr(a[1], b[1], c[1], d[1], t);
  out[2] = cr(a[2], b[2], c[2], d[2], t);
  return out;
}
