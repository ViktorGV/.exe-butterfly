// Turns a racer's sculpt (blended signed distance shapes) into one smooth mesh with Surface Nets: one vertex
// per grid cell the surface passes through, one quad per grid edge it crosses. Each vertex gets the colour and
// finish (roughness, metalness, clearcoat, glow) of the nearest shape's material, a smooth normal from the field,
// and ambient occlusion measured from the field. Build time only.
import * as THREE from 'three';
import { BONE_COUNT } from './bones.ts';
import { hyp, smax, smin, type P3, type Sdf } from './sdf.ts';

export interface Mat {
  /** Hex colour, or a function of the body-local position (for patterns such as plaid). */
  color: number | ((x: number, y: number, z: number) => number);
  rough: number;
  metal?: number;
  /** Clearcoat amount 0..1 (glossy toy plastic). */
  clear?: number;
  /** Emissive strength (the colour glows). */
  glow?: number;
}

export interface Shape {
  sdf: Sdf;
  mat: number;
  /** Blend width with everything before it (m); 0 = hard edge. */
  k: number;
  /** 'sub' carves the shape out of what is there; the carved surface gets its material. */
  sub: boolean;
  /** Skeleton bone that moves this shape (bones.ts). */
  bone: number;
}

export interface Field {
  shapes: Shape[];
  distance(x: number, y: number, z: number): number;
}

export function createField(shapes: Shape[]): Field {
  return {
    shapes,
    distance(x, y, z) {
      let d = Infinity;
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i];
        const b = s.sdf.b;
        const lower = hyp(x - b[0], y - b[1], z - b[2]) - b[3];
        if (s.sub) {
          if (lower >= s.k - d) continue;
          d = smax(d, -s.sdf(x, y, z), s.k);
        } else {
          if (lower > d + s.k) continue;
          d = smin(d, s.sdf(x, y, z), s.k);
        }
      }
      return d;
    },
  };
}

export function gradient(field: Field, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const e = 0.0012;
  return out
    .set(
      field.distance(x + e, y, z) - field.distance(x - e, y, z),
      field.distance(x, y + e, z) - field.distance(x, y - e, z),
      field.distance(x, y, z + e) - field.distance(x, y, z - e),
    )
    .normalize();
}

/** First surface point along a ray from `o` in direction `d` (unit), or null. */
export function march(field: Field, o: P3, d: P3, maxDist = 1.5): P3 | null {
  let t = 0;
  for (let i = 0; i < 300 && t < maxDist; i++) {
    const x = o[0] + d[0] * t;
    const y = o[1] + d[1] * t;
    const z = o[2] + d[2] * t;
    const dist = field.distance(x, y, z);
    if (dist < 0.0004) return [x, y, z];
    t += Math.max(dist * 0.7, 0.0004);
  }
  return null;
}

const SEARCH = { min: [-0.75, -0.02, -0.6] as P3, max: [0.75, 1.6, 0.6] as P3 };

/** Box around everything inside the field, found on a coarse grid. */
function findBounds(field: Field, step: number): { min: P3; max: P3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let z = SEARCH.min[2]; z <= SEARCH.max[2]; z += step)
    for (let y = SEARCH.min[1]; y <= SEARCH.max[1]; y += step)
      for (let x = SEARCH.min[0]; x <= SEARCH.max[0]; x += step) {
        if (field.distance(x, y, z) > step) continue;
        min[0] = Math.min(min[0], x);
        min[1] = Math.min(min[1], y);
        min[2] = Math.min(min[2], z);
        max[0] = Math.max(max[0], x);
        max[1] = Math.max(max[1], y);
        max[2] = Math.max(max[2], z);
      }
  const pad = step * 1.5;
  return {
    min: [min[0] - pad, Math.max(SEARCH.min[1], min[1] - pad), min[2] - pad],
    max: [max[0] + pad, max[1] + pad, max[2] + pad],
  };
}

const CORNER = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];
const EDGES = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * Mesh the field on a grid of `step` metres. Points far from the surface take their value from a coarse
 * grid, so only a thin band around the surface is sampled exactly.
 */
export function meshField(field: Field, mats: Mat[], step: number): THREE.BufferGeometry {
  const coarse = step * 5;
  const { min, max } = findBounds(field, 0.03);
  const nx = Math.ceil((max[0] - min[0]) / step) + 1;
  const ny = Math.ceil((max[1] - min[1]) / step) + 1;
  const nz = Math.ceil((max[2] - min[2]) / step) + 1;
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);

  // Coarse grid over the same box.
  const cx = Math.ceil((max[0] - min[0]) / coarse) + 2;
  const cy = Math.ceil((max[1] - min[1]) / coarse) + 2;
  const cz = Math.ceil((max[2] - min[2]) / coarse) + 2;
  const cvals = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++)
        cvals[i + cx * (j + cy * k)] = field.distance(min[0] + i * coarse, min[1] + j * coarse, min[2] + k * coarse);
  const band = coarse * 1.9;

  const vals = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * step;
    const fk = (k * step) / coarse;
    const k0 = Math.floor(fk);
    const tk = fk - k0;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * step;
      const fj = (j * step) / coarse;
      const j0 = Math.floor(fj);
      const tj = fj - j0;
      for (let i = 0; i < nx; i++) {
        const fi = (i * step) / coarse;
        const i0 = Math.floor(fi);
        const ti = fi - i0;
        const c = (a: number, b: number, d: number) => cvals[i0 + a + cx * (j0 + b + cy * (k0 + d))];
        const est =
          (1 - tk) *
            ((1 - tj) * ((1 - ti) * c(0, 0, 0) + ti * c(1, 0, 0)) + tj * ((1 - ti) * c(0, 1, 0) + ti * c(1, 1, 0))) +
          tk * ((1 - tj) * ((1 - ti) * c(0, 0, 1) + ti * c(1, 0, 1)) + tj * ((1 - ti) * c(0, 1, 1) + ti * c(1, 1, 1)));
        vals[at(i, j, k)] = Math.abs(est) > band ? est : field.distance(min[0] + i * step, y, z);
      }
    }
  }

  // One vertex per cell with a sign change: the average of its edges' zero crossings.
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          cv[c] = vals[at(i + CORNER[c][0], j + CORNER[c][1], k + CORNER[c][2])];
          if (cv[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, b] of EDGES) {
          if (cv[a] < 0 === cv[b] < 0) continue;
          const t = cv[a] / (cv[a] - cv[b]);
          sx += CORNER[a][0] + (CORNER[b][0] - CORNER[a][0]) * t;
          sy += CORNER[a][1] + (CORNER[b][1] - CORNER[a][1]) * t;
          sz += CORNER[a][2] + (CORNER[b][2] - CORNER[a][2]) * t;
          n++;
        }
        cellVert[at(i, j, k)] = pos.length / 3;
        pos.push(min[0] + (i + sx / n) * step, min[1] + (j + sy / n) * step, min[2] + (k + sz / n) * step);
      }
    }
  }

  // One quad per grid edge with a sign change, joining the 4 cells around it.
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = vals[at(i, j, k)] < 0;
        if (v0 !== vals[at(i + 1, j, k)] < 0)
          quad(
            cellVert[at(i, j - 1, k - 1)],
            cellVert[at(i, j, k - 1)],
            cellVert[at(i, j, k)],
            cellVert[at(i, j - 1, k)],
            !v0,
          );
        if (v0 !== vals[at(i, j + 1, k)] < 0)
          quad(
            cellVert[at(i - 1, j, k - 1)],
            cellVert[at(i - 1, j, k)],
            cellVert[at(i, j, k)],
            cellVert[at(i, j, k - 1)],
            !v0,
          );
        if (v0 !== vals[at(i, j, k + 1)] < 0)
          quad(
            cellVert[at(i - 1, j - 1, k)],
            cellVert[at(i, j - 1, k)],
            cellVert[at(i, j, k)],
            cellVert[at(i - 1, j, k)],
            !v0,
          );
      }
    }
  }

  // Per-vertex normal, material (blended across the two nearest materials) and occlusion.
  const count = pos.length / 3;
  const nrm = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const fin = new Float32Array(count * 4);
  const ao = new Float32Array(count);
  const g = new THREE.Vector3();
  const tmp = new THREE.Color();
  const matDist = new Float32Array(mats.length);
  const boneDist = new Float32Array(BONE_COUNT);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const order = new Int32Array(BONE_COUNT);
  const margin = Math.max(step * 3, 0.035);
  const shapes = field.shapes;
  const colorOf = (m: Mat, x: number, y: number, z: number, out: number[]) => {
    tmp.setHex(typeof m.color === 'function' ? m.color(x, y, z) : m.color);
    out[0] = tmp.r;
    out[1] = tmp.g;
    out[2] = tmp.b;
  };
  const c1 = [0, 0, 0];
  const c2 = [0, 0, 0];
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3];
    const y = pos[v * 3 + 1];
    const z = pos[v * 3 + 2];
    gradient(field, x, y, z, g);
    nrm[v * 3] = g.x;
    nrm[v * 3 + 1] = g.y;
    nrm[v * 3 + 2] = g.z;

    matDist.fill(Infinity);
    boneDist.fill(Infinity);
    let best = Infinity;
    for (const s of shapes) {
      const b = s.sdf.b;
      const lower = hyp(x - b[0], y - b[1], z - b[2]) - b[3];
      if (lower > best + margin) continue;
      const d = Math.abs(s.sdf(x, y, z));
      if (d <= matDist[s.mat]) matDist[s.mat] = d;
      if (d < boneDist[s.bone]) boneDist[s.bone] = d;
      if (d < best) best = d;
    }

    // Bones whose shapes are close share the vertex: smooth bends at the neck, shoulders, elbows and knees.
    for (let i = 0; i < BONE_COUNT; i++) order[i] = i;
    order.sort((a, b) => boneDist[a] - boneDist[b]);
    let sum = 0;
    for (let w = 0; w < 4; w++) {
      const bi = order[w];
      const d = boneDist[bi];
      const weight = Number.isFinite(d) ? Math.exp(-(d - boneDist[order[0]]) / 0.014) : 0;
      skinIndex[v * 4 + w] = bi;
      skinWeight[v * 4 + w] = weight < 0.03 ? 0 : weight;
      sum += skinWeight[v * 4 + w];
    }
    for (let w = 0; w < 4; w++) skinWeight[v * 4 + w] /= sum;
    let m1 = 0;
    for (let m = 1; m < mats.length; m++) if (matDist[m] < matDist[m1]) m1 = m;
    let m2 = m1 === 0 ? 1 : 0;
    for (let m = 0; m < mats.length; m++) if (m !== m1 && matDist[m] < matDist[m2]) m2 = m;
    const w2 = mats.length > 1 ? Math.max(0, 0.5 - (matDist[m2] - matDist[m1]) / (step * 1.2)) : 0;
    const A = mats[m1];
    const B = mats[m2] ?? A;
    colorOf(A, x, y, z, c1);
    colorOf(B, x, y, z, c2);
    for (let c = 0; c < 3; c++) col[v * 3 + c] = c1[c] * (1 - w2) + c2[c] * w2;
    fin[v * 4] = A.rough * (1 - w2) + B.rough * w2;
    fin[v * 4 + 1] = (A.metal ?? 0) * (1 - w2) + (B.metal ?? 0) * w2;
    fin[v * 4 + 2] = (A.clear ?? 0) * (1 - w2) + (B.clear ?? 0) * w2;
    fin[v * 4 + 3] = (A.glow ?? 0) * (1 - w2) + (B.glow ?? 0) * w2;

    // Occlusion: how much the field closes in along the normal.
    let occ = 0;
    let sca = 1;
    for (let i = 0; i < 5; i++) {
      const h = 0.008 + 0.022 * i;
      const d = field.distance(x + g.x * h, y + g.y * h, z + g.z * h);
      occ += (h - d) * sca;
      sca *= 0.8;
    }
    ao[v] = Math.min(1, Math.max(0.15, 1 - 4.5 * occ));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aFinish', new THREE.BufferAttribute(fin, 4));
  geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
