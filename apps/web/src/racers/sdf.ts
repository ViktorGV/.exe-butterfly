// Signed distance shapes for sculpting the racers like clay: each returns the distance from a point to its
// surface (negative inside). Every shape also carries a bounding sphere `b` (centre and radius) so the field
// can skip shapes that are far away. Build time only.

/** Length of a 2D or 3D vector (much faster than Math.hypot). */
export const hyp = (a: number, b: number, c = 0): number => Math.sqrt(a * a + b * b + c * c);

export type P3 = readonly [number, number, number];
/** Row-major 3x3 rotation (or reflection) matrix. */
export type M3 = readonly number[];
export type Sdf = ((x: number, y: number, z: number) => number) & { b: readonly [number, number, number, number] };

function withBound(fn: (x: number, y: number, z: number) => number, c: P3, r: number): Sdf {
  const s = fn as Sdf;
  s.b = [c[0], c[1], c[2], r];
  return s;
}

/** Polynomial smooth minimum: blends two surfaces over a width of about k metres. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

export const sphere = (c: P3, r: number): Sdf => withBound((x, y, z) => hyp(x - c[0], y - c[1], z - c[2]) - r, c, r);

/** Ellipsoid (a good approximation of the true distance near the surface). */
export const ellipsoid = (c: P3, r: P3): Sdf =>
  withBound(
    (x, y, z) => {
      const px = (x - c[0]) / r[0];
      const py = (y - c[1]) / r[1];
      const pz = (z - c[2]) / r[2];
      const k0 = hyp(px, py, pz);
      const k1 = hyp(px / r[0], py / r[1], pz / r[2]);
      return k1 === 0 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
    },
    c,
    Math.max(r[0], r[1], r[2]),
  );

/** Capsule from a to b whose radius goes from ra to rb (a tapered limb). */
export const capsule = (a: P3, b: P3, ra: number, rb = ra): Sdf => {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const len2 = bx * bx + by * by + bz * bz || 1e-9;
  return withBound(
    (x, y, z) => {
      const px = x - a[0];
      const py = y - a[1];
      const pz = z - a[2];
      const t = Math.min(1, Math.max(0, (px * bx + py * by + pz * bz) / len2));
      return hyp(px - bx * t, py - by * t, pz - bz * t) - (ra + (rb - ra) * t);
    },
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    Math.sqrt(len2) / 2 + Math.max(ra, rb),
  );
};

/** Box with rounded edges: half extents h (including the rounding r). */
export const roundBox = (c: P3, h: P3, r: number): Sdf =>
  withBound(
    (x, y, z) => {
      const qx = Math.abs(x - c[0]) - h[0] + r;
      const qy = Math.abs(y - c[1]) - h[1] + r;
      const qz = Math.abs(z - c[2]) - h[2] + r;
      return hyp(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
    },
    c,
    hyp(h[0], h[1], h[2]),
  );

/** Ring lying flat (axis = Y): major radius R, tube radius r. */
export const torus = (c: P3, R: number, r: number): Sdf =>
  withBound((x, y, z) => hyp(hyp(x - c[0], z - c[2]) - R, y - c[1]) - r, c, R + r);

/** Squash a shape front to back (z) around cz by k (< 1 = flatter). */
export const flatZ = (s: Sdf, cz: number, k: number): Sdf =>
  withBound((x, y, z) => s(x, y, cz + (z - cz) / k) * k, [s.b[0], s.b[1], cz + (s.b[2] - cz) * k], s.b[3] / k);

/** Squash a shape sideways (x) around x = 0 by k (< 1 = thinner, like a fin). */
export const flatX = (s: Sdf, k: number): Sdf =>
  withBound((x, y, z) => s(x / k, y, z) * k, [s.b[0] * k, s.b[1], s.b[2]], s.b[3]);

/** Keep only the part of `s` on the side of the plane through `p` that `n` (unit) points to. */
export const cut = (s: Sdf, p: P3, n: P3): Sdf =>
  withBound(
    (x, y, z) => Math.max(s(x, y, z), -((x - p[0]) * n[0] + (y - p[1]) * n[1] + (z - p[2]) * n[2])),
    [s.b[0], s.b[1], s.b[2]],
    s.b[3],
  );

/** Where both shapes are. */
export const inter = (a: Sdf, b: Sdf): Sdf =>
  withBound((x, y, z) => Math.max(a(x, y, z), b(x, y, z)), [a.b[0], a.b[1], a.b[2]], a.b[3]);

/** `a` with `b` carved out of it (hard edge). */
export const minus = (a: Sdf, b: Sdf): Sdf =>
  withBound((x, y, z) => Math.max(a(x, y, z), -b(x, y, z)), [a.b[0], a.b[1], a.b[2]], a.b[3]);

/** A hollow shell of thickness t around the surface. */
export const shell = (s: Sdf, t: number): Sdf =>
  withBound((x, y, z) => Math.abs(s(x, y, z)) - t, [s.b[0], s.b[1], s.b[2]], s.b[3] + t);

/** Shaggy fur or knobbly clay: small bumps of amplitude `amp` and spatial frequency `freq` on the surface. */
export const fuzz = (s: Sdf, amp: number, freq: number): Sdf =>
  withBound(
    (x, y, z) =>
      s(x, y, z) -
      amp * Math.sin(freq * x + 1.3 * Math.sin(freq * 0.5 * y)) * Math.sin(freq * y + 0.7) * Math.sin(freq * z + 2.1),
    [s.b[0], s.b[1], s.b[2]],
    s.b[3] + amp,
  );

/**
 * A shape defined around the origin, placed at `c` with the rotation `m` (local to world). The local frame's
 * axes are the columns of `m`.
 */
export const placed = (local: Sdf, c: P3, m: M3): Sdf => {
  const lb = local.b;
  const bc: P3 = [
    c[0] + m[0] * lb[0] + m[1] * lb[1] + m[2] * lb[2],
    c[1] + m[3] * lb[0] + m[4] * lb[1] + m[5] * lb[2],
    c[2] + m[6] * lb[0] + m[7] * lb[1] + m[8] * lb[2],
  ];
  return withBound(
    (x, y, z) => {
      const dx = x - c[0];
      const dy = y - c[1];
      const dz = z - c[2];
      // Transpose = inverse for rotations and reflections.
      return local(
        m[0] * dx + m[3] * dy + m[6] * dz,
        m[1] * dx + m[4] * dy + m[7] * dz,
        m[2] * dx + m[5] * dy + m[8] * dz,
      );
    },
    bc,
    lb[3],
  );
};

// ---- rotations ---------------------------------------------------------------------------------------------

export const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const rotX = (a: number): M3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
export const rotY = (a: number): M3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
export const rotZ = (a: number): M3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
/** Mirror the local x axis (for the left/right copy of an asymmetric part). */
export const flipX = (side: number): M3 => [side, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(a: M3, b: M3): M3 {
  const o: number[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o;
}

/** Rotation that turns +Y into the direction d (Rodrigues). */
export function alignY(d: P3): M3 {
  const l = hyp(d[0], d[1], d[2]);
  const x = d[0] / l;
  const y = d[1] / l;
  const z = d[2] / l;
  // axis = Y x d, cos = y
  const ax = z;
  const az = -x;
  const s = hyp(ax, az);
  if (s < 1e-6) return y > 0 ? IDENTITY : [1, 0, 0, 0, -1, 0, 0, 0, -1];
  const kx = ax / s;
  const kz = az / s;
  const c = y;
  const t = 1 - c;
  return [t * kx * kx + c, -kz * s, t * kx * kz, kz * s, c, -kx * s, t * kx * kz, kx * s, t * kz * kz + c];
}

export const add3 = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale3 = (a: P3, s: number): P3 => [a[0] * s, a[1] * s, a[2] * s];
