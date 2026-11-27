// Wobbler parts (#8): face, belly and accessory geometry from skin parameters, the limb rig, and the
// crowd LOD mesh. Build time only.
import * as THREE from 'three';
import {
  MeshBuilder,
  PRIM_LEVEL_COUNT,
  addDecal,
  arc,
  band,
  createBodyGeometry,
  createLimbGeometry,
  disc,
  ellipse,
  primTemplate,
  star,
  triangles,
  type Shape2D,
} from './geometry.ts';
import { ANCHOR_POS, FACE, LIMBS } from './shape.ts';
import type { EyeStyle, MouthStyle, WobblerParams } from './skin.ts';

/** Full-detail budgets (phone first). */
export const BUDGET = Object.freeze({ triangles: 2500, drawCalls: 4, lodTriangles: 300, patternPx: 128 });

/** Full-detail shared meshes. */
export const BODY_SEGMENTS = 20;
export const BODY_ROWS = 15;
export const LIMB_CAP_SEGMENTS = 3;
export const LIMB_RADIAL_SEGMENTS = 8;

const WHITE = '#ffffff';
const SHINE = '#fffdf5';
/** Decal lift above the body surface per layer, metres. */
const L0 = 0.004;
const L1 = 0.007;
const L2 = 0.01;
const L3 = 0.013;

type Layer = [shape: Shape2D, du: number, dv: number, lift: number, color: string];

function eyeLayers(style: EyeStyle, ink: string): Layer[] {
  switch (style) {
    case 'dot':
      return [[ellipse(0.032, 0.034, 10), 0, 0, L1, ink]];
    case 'sleepy':
      return [
        [ellipse(0.048, 0.034, 8, Math.PI, Math.PI * 2), 0, 0.006, L1, ink],
        [band([-0.05, 0.012, 0.05, 0.012], 0.006), 0, 0, L2, ink],
      ];
    case 'star':
      return [
        [star(0.056, 0.025), 0, 0, L1, ink],
        [ellipse(0.011, 0.011, 6), -0.012, 0.014, L2, SHINE],
      ];
    case 'wide':
      return [
        [ellipse(0.058, 0.064, 14), 0, 0, L1, WHITE],
        [ellipse(0.031, 0.034, 10), 0, -0.01, L2, ink],
        [ellipse(0.01, 0.01, 6), -0.01, 0.004, L3, SHINE],
      ];
    case 'oval':
    default:
      return [
        [ellipse(0.036, 0.056, 12), 0, 0, L1, ink],
        [ellipse(0.012, 0.014, 6), -0.011, 0.022, L2, SHINE],
      ];
  }
}

function mouthLayers(style: MouthStyle, ink: string): Layer[] {
  switch (style) {
    case 'o':
      return [[ellipse(0.027, 0.033, 10), 0, -0.005, L1, ink]];
    case 'flat':
      return [[band([-0.05, 0, 0.05, 0], 0.011), 0, 0, L1, ink]];
    case 'grin':
      return [
        [ellipse(0.075, 0.052, 10, Math.PI, Math.PI * 2), 0, 0.02, L1, ink],
        [band([-0.06, 0.01, 0.06, 0.01], 0.009), 0, 0, L2, WHITE],
      ];
    case 'none':
      return [];
    case 'smile':
    default:
      return [[band(arc(0.065, 0.04, Math.PI + 0.35, Math.PI * 2 - 0.35, 10, 0, 0.03), 0.011), 0, 0, L1, ink]];
  }
}

function addLayers(b: MeshBuilder, layers: Layer[], cu: number, cv: number, k: number): void {
  for (const [shape, du, dv, lift, color] of layers) addDecal(b, shape, cu + du * k, cv + dv * k, lift, color, 0, k);
}

/** Belly patch, eyes, mouth and cheeks. */
function buildFace(b: MeshBuilder, p: WobblerParams): void {
  addDecal(b, disc(FACE.bellyRx, FACE.bellyRy, 16, 3), 0, FACE.bellyY, L0, p.body.belly);
  if (p.face.cheeks) {
    const cheek = ellipse(0.045, 0.028, 10);
    addDecal(b, cheek, -FACE.cheekX, FACE.cheekY, L0, p.face.cheeks);
    addDecal(b, cheek, FACE.cheekX, FACE.cheekY, L0, p.face.cheeks);
  }
  const eyes = eyeLayers(p.face.eyes, p.face.eyeColor);
  addLayers(b, eyes, -FACE.eyeX, FACE.eyeY, FACE.eyeScale);
  addLayers(b, eyes, FACE.eyeX, FACE.eyeY, FACE.eyeScale);
  addLayers(b, mouthLayers(p.face.mouth, p.face.eyeColor), 0, FACE.mouthY, FACE.mouthScale);
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _g = new THREE.Color();

function accessoryTriangles(p: WobblerParams, level: number): number {
  let n = 0;
  for (const a of p.accessories) for (const prim of a.prims) n += triangles(primTemplate(prim.shape, level));
  return n;
}

/** Finest accessory detail level that keeps the whole Wobbler inside the triangle budget. */
export function accessoryLevel(p: WobblerParams, baseTriangles: number): number {
  for (let level = 0; level < PRIM_LEVEL_COUNT - 1; level++) {
    if (baseTriangles + accessoryTriangles(p, level) <= BUDGET.triangles) return level;
  }
  return PRIM_LEVEL_COUNT - 1;
}

function buildAccessories(detail: MeshBuilder, glow: MeshBuilder, p: WobblerParams, level: number): void {
  for (const a of p.accessories) {
    const anchor = ANCHOR_POS[a.anchor];
    for (const prim of a.prims) {
      _p.set(anchor[0] + prim.pos[0], anchor[1] + prim.pos[1], anchor[2] + prim.pos[2]);
      _q.setFromEuler(_e.set(prim.rot[0], prim.rot[1], prim.rot[2]));
      _s.set(prim.scale[0], prim.scale[1], prim.scale[2]);
      _m.compose(_p, _q, _s);
      const template = primTemplate(prim.shape, level);
      if (prim.emissive) {
        // Unlit and brightened: reads as glowing without a fifth material.
        _c.set(prim.color).add(_g.set(prim.emissive));
        _c.r = Math.min(1, _c.r);
        _c.g = Math.min(1, _c.g);
        _c.b = Math.min(1, _c.b);
        glow.addGeometry(template, _m, `#${_c.getHexString()}`);
      } else detail.addGeometry(template, _m, prim.color);
    }
  }
}

export interface DetailGeometry {
  /** Belly, face and lit accessories (vertex colours). */
  detail: THREE.BufferGeometry;
  /** Emissive accessory prims (vertex colours, unlit), or null when there are none. */
  glow: THREE.BufferGeometry | null;
  /** Accessory detail level that was used (0 = finest). */
  level: number;
}

/** Per-skin detail geometry. `baseTriangles` is everything else the Wobbler draws (body and limbs). */
export function buildDetailGeometry(p: WobblerParams, baseTriangles: number): DetailGeometry {
  const detail = new MeshBuilder();
  const glow = new MeshBuilder();
  buildFace(detail, p);
  const level = accessoryLevel(p, baseTriangles + detail.triangleCount);
  buildAccessories(detail, glow, p, level);
  return { detail: detail.toGeometry(), glow: glow.triangleCount > 0 ? glow.toGeometry() : null, level };
}

// ---------------------------------------------------------------------------------------------------------
// Limb rig. Index 0 left arm, 1 right arm, 2 left leg, 3 right leg (the Wobbler's own left is -X).

export const LIMB_COUNT = 4;

/**
 * Limb transform in body-local space. `swing` turns the limb forward (+) / back (-) around X;
 * `raise` lifts it sideways away from the body around Z (0 = hanging, pi = straight up).
 */
export function composeLimb(out: THREE.Matrix4, limb: number, swing: number, raise: number): THREE.Matrix4 {
  const arm = limb < 2;
  const side = limb % 2 === 0 ? -1 : 1;
  const size = arm ? LIMBS.armSize : LIMBS.legSize;
  _p.set(side * (arm ? LIMBS.shoulderX : LIMBS.hipX), arm ? LIMBS.shoulderY : LIMBS.hipY, 0);
  _q.setFromEuler(_e.set(swing, 0, side * ((arm ? LIMBS.armSplay : 0.04) + raise), 'ZXY'));
  _s.set(size[0] * 2, size[1], size[2] * 2);
  return out.compose(_p, _q, _s);
}

// ---------------------------------------------------------------------------------------------------------
// Crowd LOD

/** Values of the LOD geometry's `part` attribute. */
export const LOD_PART = Object.freeze({ primary: 0, belly: 1, limbs: 2, ink: 3 });

/** Low-detail Wobbler in rest pose, with a `part` attribute (see LOD_PART) instead of colours. */
export function buildLodGeometry(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const body = createBodyGeometry(10, 7);
  b.addGeometry(body, _m.identity(), WHITE, LOD_PART.primary);
  body.dispose();
  addDecal(b, ellipse(FACE.bellyRx, FACE.bellyRy, 8), 0, FACE.bellyY, 0.012, WHITE, LOD_PART.belly);
  const eye = ellipse(0.04, 0.055, 5);
  addDecal(b, eye, -FACE.eyeX, FACE.eyeY, 0.012, WHITE, LOD_PART.ink);
  addDecal(b, eye, FACE.eyeX, FACE.eyeY, 0.012, WHITE, LOD_PART.ink);
  const limb = createLimbGeometry(1, 5);
  for (let i = 0; i < LIMB_COUNT; i++) b.addGeometry(limb, composeLimb(_m, i, 0, 0), WHITE, LOD_PART.limbs);
  limb.dispose();
  return b.toGeometry({ color: false, part: true });
}
