// Geometry helpers (#8): a tiny indexed mesh builder, unit prim templates at several detail levels,
// and "decals" (flat 2D shapes wrapped onto the body surface) for the belly patch and face.
// Everything here runs at build time only, never per frame.
import * as THREE from 'three';
import { BODY, bodyRadiusAt, bodySlopeAt, radiusAtTheta, yAtTheta } from './shape.ts';
import type { PrimShape } from './skin.ts';

const _m3 = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

/** Accumulates indexed triangles with per-vertex colour and a per-vertex part id. */
export class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly part: number[] = [];
  readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: THREE.Color, part: number): void {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.col.push(color.r, color.g, color.b);
    this.part.push(part);
  }

  /** Append an indexed template geometry transformed by `matrix`. */
  addGeometry(geom: THREE.BufferGeometry, matrix: THREE.Matrix4, color: string, part = 0): void {
    const p = geom.getAttribute('position');
    const n = geom.getAttribute('normal');
    const index = geom.getIndex();
    const base = this.vertexCount;
    _m3.getNormalMatrix(matrix);
    _c.set(color);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      const x = _v.x;
      const y = _v.y;
      const z = _v.z;
      _v.fromBufferAttribute(n, i).applyMatrix3(_m3).normalize();
      this.vertex(x, y, z, _v.x, _v.y, _v.z, _c, part);
    }
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  toGeometry({ color = true, part = false } = {}): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (part) g.setAttribute('part', new THREE.Float32BufferAttribute(this.part, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export const triangles = (g: THREE.BufferGeometry): number =>
  (g.getIndex()?.count ?? g.getAttribute('position').count) / 3;

// ---------------------------------------------------------------------------------------------------------
// Body and limbs

/** The body as a lathe (u runs around the body, v from bottom to top), for the pattern texture. */
export function createBodyGeometry(segments: number, rows: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= rows; i++) {
    const theta = -Math.PI / 2 + (Math.PI * i) / rows;
    pts.push(new THREE.Vector2(i === 0 || i === rows ? 0 : radiusAtTheta(theta), yAtTheta(theta)));
  }
  return new THREE.LatheGeometry(pts, segments);
}

/** One stubby limb: a capsule 0.5 wide and 1 long, hanging from its pivot at the origin toward -Y. */
export function createLimbGeometry(capSegments: number, radialSegments: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(0.25, 0.5, capSegments, radialSegments).translate(0, -0.5, 0);
}

// ---------------------------------------------------------------------------------------------------------
// Accessory prims: unit-sized at scale 1 (each fits the cube [-0.5, 0.5]^3), so `scale` is the size in metres.

/** Detail levels, finest first. The finest level whose total still fits the triangle budget is used. */
const PRIM_LEVELS: Readonly<Record<PrimShape, (() => THREE.BufferGeometry)[]>> = {
  sphere: [8, 6, 5, 4].map((s, i) => () => new THREE.SphereGeometry(0.5, s + 2, [6, 5, 4, 3][i])),
  box: [() => new THREE.BoxGeometry(1, 1, 1)],
  cylinder: [10, 8, 6, 5].map((s) => () => new THREE.CylinderGeometry(0.5, 0.5, 1, s)),
  cone: [10, 8, 6, 5].map((s) => () => new THREE.ConeGeometry(0.5, 1, s)),
  torus: [
    [6, 14],
    [5, 10],
    [4, 8],
    [3, 6],
  ].map(
    ([r, t]) =>
      () =>
        new THREE.TorusGeometry(0.375, 0.125, r, t),
  ),
  capsule: [
    [3, 8],
    [2, 6],
    [1, 6],
    [1, 4],
  ].map(
    ([c, r]) =>
      () =>
        new THREE.CapsuleGeometry(0.25, 0.5, c, r),
  ),
};
export const PRIM_LEVEL_COUNT = 4;
const templates = new Map<string, THREE.BufferGeometry>();

/** Shared unit template for a prim shape at a detail level (0 = finest). Never disposed. */
export function primTemplate(shape: PrimShape, level: number): THREE.BufferGeometry {
  const levels = PRIM_LEVELS[shape];
  const l = Math.min(level, levels.length - 1);
  const key = `${shape}:${l}`;
  let g = templates.get(key);
  if (!g) {
    g = levels[l]();
    templates.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------------------
// Decals: 2D shapes in metres, u to the viewer's right and v up, counter-clockwise as seen from the front.

export interface Shape2D {
  pts: number[]; // u, v pairs
  tris: number[];
}

/** Ellipse (or an arc of one) as a fan around (cu, cv). */
export function ellipse(rx: number, ry: number, segs: number, a0 = 0, a1 = Math.PI * 2, cu = 0, cv = 0): Shape2D {
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const rim = full ? segs : segs + 1;
  const pts = [cu, cv];
  const tris: number[] = [];
  for (let i = 0; i < rim; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    pts.push(cu + Math.cos(a) * rx, cv + Math.sin(a) * ry);
  }
  for (let i = 0; i < segs; i++) tris.push(0, 1 + i, 1 + ((i + 1) % rim));
  return { pts, tris };
}

/** Thick polyline (u, v pairs) as a triangle strip. */
export function band(path: number[], halfWidth: number): Shape2D {
  const n = path.length / 2;
  const pts: number[] = [];
  const tris: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const du = path[b * 2] - path[a * 2];
    const dv = path[b * 2 + 1] - path[a * 2 + 1];
    const len = Math.hypot(du, dv) || 1;
    const ou = (-dv / len) * halfWidth;
    const ov = (du / len) * halfWidth;
    pts.push(path[i * 2] - ou, path[i * 2 + 1] - ov, path[i * 2] + ou, path[i * 2 + 1] + ov);
    if (i > 0) {
      const k = (i - 1) * 2;
      tris.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  return { pts, tris };
}

/** Points along an elliptic arc, for band(). */
export function arc(rx: number, ry: number, a0: number, a1: number, segs: number, cu = 0, cv = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    out.push(cu + Math.cos(a) * rx, cv + Math.sin(a) * ry);
  }
  return out;
}

export function star(rOuter: number, rInner: number, points = 5): Shape2D {
  const pts = [0, 0];
  const tris: number[] = [];
  const rim = points * 2;
  for (let i = 0; i < rim; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / points;
    const r = i % 2 === 0 ? rOuter : rInner;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
    tris.push(0, 1 + i, 1 + ((i + 1) % rim));
  }
  return { pts, tris };
}

/**
 * Wrap a 2D shape onto the front of the body (toward -Z), centred at arc-length offset `cu` and height `cv`,
 * floating `lift` metres above the surface and scaled by `scale`. Layer decals with increasing lift.
 */
export function addDecal(
  b: MeshBuilder,
  shape: Shape2D,
  cu: number,
  cv: number,
  lift: number,
  color: string,
  part = 0,
  scale = 1,
): void {
  const base = b.vertexCount;
  _c.set(color);
  for (let i = 0; i < shape.pts.length; i += 2) {
    const y = Math.min(BODY.top - 0.01, Math.max(BODY.bottom + 0.01, cv + shape.pts[i + 1] * scale));
    const r = Math.max(0.05, bodyRadiusAt(y)) + lift;
    const phi = (cu + shape.pts[i] * scale) / r;
    const sx = -Math.sin(phi);
    const sz = -Math.cos(phi);
    _v.set(sx, -bodySlopeAt(y), sz).normalize();
    b.vertex(sx * r, y, sz * r, _v.x, _v.y, _v.z, _c, part);
  }
  for (const t of shape.tris) b.idx.push(base + t);
}

/** Filled ellipse with inner rings, so large decals follow the body's curvature. */
export function disc(rx: number, ry: number, segs: number, rings: number): Shape2D {
  const pts = [0, 0];
  const tris: number[] = [];
  for (let r = 1; r <= rings; r++) {
    for (let i = 0; i < segs; i++) {
      const a = (Math.PI * 2 * i) / segs;
      pts.push((Math.cos(a) * rx * r) / rings, (Math.sin(a) * ry * r) / rings);
    }
  }
  const ring = (r: number, i: number): number => 1 + (r - 1) * segs + (i % segs);
  for (let i = 0; i < segs; i++) tris.push(0, ring(1, i), ring(1, i + 1));
  for (let r = 2; r <= rings; r++) {
    for (let i = 0; i < segs; i++) {
      tris.push(ring(r - 1, i), ring(r, i), ring(r, i + 1), ring(r - 1, i), ring(r, i + 1), ring(r - 1, i + 1));
    }
  }
  return { pts, tris };
}
