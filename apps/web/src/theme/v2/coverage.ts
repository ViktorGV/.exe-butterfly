// The hideBase rule (#54): dressing may hide its obstacle's base mesh only when it covers at least
// 80% of the collider. Prims use unit shapes that fit [-1, 1]^3 (as the course's unit geometry).
// Coverage = share of the part's local bounding box that lies inside any prim's local bounding box,
// sampled on a grid. Conservative for spheres and cylinders, cheap, and pure.
import type { PartDef, Prim } from '@wobble/shared/types';

export const HIDE_BASE_COVERAGE = 0.8;

type Box = { min: [number, number, number]; max: [number, number, number] };

/** Local half extents of a part (PartDef.size convention). */
export function partHalfExtents(part: Pick<PartDef, 'shape' | 'size'>): [number, number, number] {
  const [a, b, c] = part.size;
  if (part.shape === 'box') return [a, b, c];
  if (part.shape === 'cylinder') return [a, b, a];
  return [a, a, a];
}

/** Axis-aligned bounds of a prim after its Euler XYZ rotation and scale (unit shape in [-1, 1]^3). */
export function primBox(p: Prim, scale = 1): Box {
  const [rx, ry, rz] = p.rot;
  const cx = Math.cos(rx),
    sx = Math.sin(rx),
    cy = Math.cos(ry),
    sy = Math.sin(ry),
    cz = Math.cos(rz),
    sz = Math.sin(rz);
  // Rotation matrix for Euler order XYZ (three.js default).
  const m = [
    [cy * cz, -cy * sz, sy],
    [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
    [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
  ];
  const s = p.scale.map((v) => Math.abs(v) * scale);
  const min: [number, number, number] = [0, 0, 0];
  const max: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const e = Math.abs(m[i][0]) * s[0] + Math.abs(m[i][1]) * s[1] + Math.abs(m[i][2]) * s[2];
    min[i] = p.pos[i] * scale - e;
    max[i] = p.pos[i] * scale + e;
  }
  return { min, max };
}

/** Share (0..1) of the part's bounding box covered by the prims. */
export function dressingCoverage(prims: readonly Prim[], part: Pick<PartDef, 'shape' | 'size'>, samples = 8): number {
  const h = partHalfExtents(part);
  const boxes = prims.map((p) => primBox(p));
  let inside = 0;
  for (let i = 0; i < samples; i++)
    for (let j = 0; j < samples; j++)
      for (let k = 0; k < samples; k++) {
        const x = -h[0] + ((i + 0.5) * 2 * h[0]) / samples;
        const y = -h[1] + ((j + 0.5) * 2 * h[1]) / samples;
        const z = -h[2] + ((k + 0.5) * 2 * h[2]) / samples;
        if (
          boxes.some(
            (b) => x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2],
          )
        )
          inside++;
      }
  return inside / samples ** 3;
}

/** The rule: hideBase is honoured only when requested and coverage is at least 80%. */
export function shouldHideBase(
  dressing: { hideBase: boolean; prims: readonly Prim[] },
  part: Pick<PartDef, 'shape' | 'size'>,
): boolean {
  return dressing.hideBase && dressingCoverage(dressing.prims, part) >= HIDE_BASE_COVERAGE;
}
