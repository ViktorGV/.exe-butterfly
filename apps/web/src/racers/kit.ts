// The sculpting kit every racer is built with: a builder that collects shapes and finds points on the clay
// surface, plus parts all racers share (A-pose arms, chunky gloves, sturdy boots, big toy eyes).
import * as THREE from 'three';
import { boneIndex, type LimbBone } from './bones.ts';
import { createField, gradient, march, type Field, type Mat, type Shape } from './mesher.ts';
import {
  alignY,
  capsule,
  ellipsoid,
  flipX,
  mul,
  placed,
  roundBox,
  rotZ,
  sphere,
  torus,
  type M3,
  type P3,
  type Sdf,
} from './sdf.ts';

export interface EyeSpec {
  /** Centre of the right eye on the face (x > 0); the left one is mirrored. */
  x: number;
  y: number;
  w: number;
  h: number;
  iris: number;
  style?: 'toy' | 'sleepy' | 'screen';
  /** Eyelid colour for 'sleepy'. */
  lid?: number;
  /** Pupil / screen-eye colour. */
  pupil?: number;
}

export interface Builder {
  field: Field;
  /** Add a shape, blended over k metres with what is there. */
  add(sdf: Sdf, mat: string, k?: number): void;
  /** Carve a shape out; the carved surface gets `mat`. */
  sub(sdf: Sdf, mat: string, k?: number): void;
  /** Surface point seen from the front (from -Z) at (x, y), or a fallback on the z = 0 plane. */
  front(x: number, y: number): P3;
  /** Surface point along a ray from `o` toward `d`. */
  hit(o: P3, d: P3): P3;
  /** Unit normal of the clay at p. */
  normal(p: P3): P3;
  eyes(spec: EyeSpec): void;
  /** Extra meshes (not part of the clay), added to the racer as they are; they move with the head. */
  extra(make: (group: THREE.Group) => void): void;
  /** Bone for the shapes added from now on (limb bones need a side: > 0 = right, +X). */
  bone(name: 'hips' | 'spine' | 'head' | LimbBone, side?: number): void;
  /** Current bone index (helpers save and restore it). */
  currentBone: number;
  /** Rest position of a bone's joint (its pivot), body-local. */
  joint(name: 'hips' | 'spine' | 'head' | LimbBone, side: number, p: P3): void;
  readonly joints: (P3 | undefined)[];
  readonly mats: Mat[];
  readonly eyeSpecs: { p: P3; n: P3; spec: EyeSpec; side: number }[];
  readonly extras: ((group: THREE.Group) => void)[];
}

export function createBuilder(matDefs: Record<string, Mat>): Builder {
  const names = Object.keys(matDefs);
  const mats = names.map((n) => matDefs[n]);
  const index = (name: string) => {
    const i = names.indexOf(name);
    if (i < 0) throw new Error(`unknown material ${name}`);
    return i;
  };
  const shapes: Shape[] = [];
  const field = createField(shapes);
  const g = new THREE.Vector3();
  const b: Builder = {
    field,
    mats,
    eyeSpecs: [],
    extras: [],
    joints: [],
    currentBone: boneIndex('spine'),
    add(sdf, mat, k = 0.02) {
      shapes.push({ sdf, mat: index(mat), k, sub: false, bone: b.currentBone });
    },
    sub(sdf, mat, k = 0.006) {
      shapes.push({ sdf, mat: index(mat), k, sub: true, bone: b.currentBone });
    },
    bone(name, side = 1) {
      b.currentBone = boneIndex(name, side);
    },
    joint(name, side, p) {
      b.joints[boneIndex(name, side)] = p;
    },
    front(x, y) {
      return march(field, [x, y, -0.8], [0, 0, 1]) ?? [x, y, 0];
    },
    hit(o, d) {
      const l = Math.hypot(d[0], d[1], d[2]);
      return march(field, o, [d[0] / l, d[1] / l, d[2] / l]) ?? o;
    },
    normal(p) {
      gradient(field, p[0], p[1], p[2], g);
      return [g.x, g.y, g.z];
    },
    eyes(spec) {
      for (const side of [1, -1]) {
        const p = b.front(spec.x * side, spec.y);
        b.eyeSpecs.push({ p, n: b.normal(p), spec, side });
      }
    },
    extra(make) {
      b.extras.push(make);
    },
  };
  return b;
}

// ---- shared parts --------------------------------------------------------------------------------------

/** Direction of an A-pose arm: `angle` radians out from hanging straight down. */
export function armDir(side: number, angle: number): P3 {
  return [side * Math.sin(angle), -Math.cos(angle), 0];
}

/**
 * An arm from the shoulder in the A-pose, with a slight bend forward at the elbow. Returns the wrist.
 * r = [shoulder, elbow, wrist] radii.
 */
export function arm(
  b: Builder,
  side: number,
  shoulder: P3,
  len: [number, number],
  angle: number,
  r: [number, number, number],
  mat: string,
  foreMat = mat,
): P3 {
  const d = armDir(side, angle);
  const elbow: P3 = [shoulder[0] + d[0] * len[0], shoulder[1] + d[1] * len[0], shoulder[2] - 0.012];
  const wrist: P3 = [elbow[0] + d[0] * len[1], elbow[1] + d[1] * len[1], elbow[2] - 0.008];
  const keep = b.currentBone;
  b.joint('upperArm', side, shoulder);
  b.joint('foreArm', side, elbow);
  b.bone('upperArm', side);
  b.add(capsule(shoulder, elbow, r[0], r[1]), mat, 0.03);
  b.bone('foreArm', side);
  b.add(capsule(elbow, wrist, r[1], r[2]), foreMat, 0.02);
  b.currentBone = keep;
  return wrist;
}

/** Frame for a hand at the end of an A-pose arm: local -Y runs down the arm, local +X points away from the body. */
export function handFrame(side: number, angle: number): M3 {
  return mul(rotZ(side * angle), flipX(side));
}

/**
 * Chunky mitten glove of size s at the wrist: palm, three fat finger pads, a thumb toward the front and a
 * rolled cuff. `fingers` lets fingerless gloves show the paw through.
 */
export function glove(
  b: Builder,
  side: number,
  wrist: P3,
  angle: number,
  s: number,
  mat: string,
  cuffMat = mat,
  fingers = mat,
): void {
  const m = handFrame(side, angle);
  const at = (local: Sdf) => placed(local, wrist, m);
  const keep = b.currentBone;
  b.bone('foreArm', side);
  b.add(at(torus([0, -s * 0.15, 0], s * 0.78, s * 0.3)), cuffMat, 0.02);
  b.add(at(ellipsoid([0, -s * 1.05, 0], [s * 0.95, s * 1.05, s * 0.78])), mat, 0.03);
  for (const fx of [-0.52, 0, 0.52])
    b.add(at(sphere([fx * s, -s * 1.85 + Math.abs(fx) * s * 0.22, -s * 0.05], s * 0.4)), fingers, 0.035);
  b.add(at(capsule([-s * 0.45, -s * 0.75, -s * 0.45], [-s * 0.55, -s * 1.3, -s * 0.95], s * 0.34, s * 0.3)), mat, 0.03);
  b.currentBone = keep;
}

/**
 * Sturdy rounded boot (toe toward -Z) on a chunky sole. It is the foot bone, pivoting near its top; the current
 * bone stays on the foot afterwards, so toe caps and laces added next move with it.
 */
export function boot(
  b: Builder,
  x: number,
  size: { w: number; h: number; l: number },
  mat: string,
  soleMat: string,
): void {
  const { w, h, l } = size;
  const side = Math.sign(x) || 1;
  b.joint('foot', side, [x, h * 0.95, 0]);
  b.bone('foot', side);
  b.add(roundBox([x, h * 0.55 + 0.02, -l * 0.25], [w, h * 0.55, l], Math.min(w, h * 0.55) * 0.85), mat, 0.02);
  b.add(capsule([x, h * 0.6, 0.0], [x, h * 1.05, 0.0], w * 0.92, w * 0.85), mat, 0.03);
  b.add(roundBox([x, 0.022, -l * 0.25], [w * 1.08, 0.022, l * 1.05], 0.018), soleMat, 0.008);
}

export function ring(c: P3, axis: P3, R: number, r: number): Sdf {
  return placed(torus([0, 0, 0], R, r), c, alignY(axis));
}

/** Dome-shaped stud or button on the surface at p, raised along the surface normal. */
export function stud(b: Builder, p: P3, r: number, mat: string, k = 0.004): void {
  const n = b.normal(p);
  b.add(sphere([p[0] + n[0] * r * 0.2, p[1] + n[1] * r * 0.2, p[2] + n[2] * r * 0.2], r), mat, k);
}

// ---- eyes ----------------------------------------------------------------------------------------------

const unitSphere = new THREE.SphereGeometry(1, 40, 28);
const eyeMats = new Map<string, THREE.Material>();
function eyeMat(hex: number, kind: 'gloss' | 'flat' | 'glow' | 'skin'): THREE.Material {
  const key = `${kind}:${hex}`;
  let m = eyeMats.get(key);
  if (!m) {
    m =
      kind === 'glow'
        ? new THREE.MeshBasicMaterial({ color: hex })
        : new THREE.MeshPhysicalMaterial({
            color: hex,
            roughness: kind === 'skin' ? 0.55 : kind === 'flat' ? 0.3 : 0.12,
            clearcoat: kind === 'skin' ? 0.3 : 1,
            clearcoatRoughness: 0.06,
          });
    eyeMats.set(key, m);
  }
  return m;
}

const FORWARD = new THREE.Vector3(0, 0, -1);

/** Big glossy toy eyes (or glowing screen eyes) at the spots the builder recorded. */
export function buildEyes(b: Builder, group: THREE.Group): void {
  for (const { p, n, spec, side } of b.eyeSpecs) {
    const eye = new THREE.Group();
    const dir = new THREE.Vector3(n[0], n[1], n[2]).lerp(FORWARD, 0.55).normalize();
    eye.quaternion.setFromUnitVectors(FORWARD, dir);
    const { w, h } = spec;
    const screen = spec.style === 'screen';
    const depth = screen ? w * 0.18 : w * 0.42;
    eye.position.set(p[0], p[1], p[2]).addScaledVector(dir, -depth * 0.45);
    const part = (mat: THREE.Material, s: [number, number, number], at: [number, number, number]) => {
      const mesh = new THREE.Mesh(unitSphere, mat);
      mesh.scale.set(...s);
      mesh.position.set(...at);
      eye.add(mesh);
      return mesh;
    };
    if (screen) {
      part(eyeMat(spec.pupil ?? 0x1b2447, 'flat'), [w, h, depth], [0, 0, 0]);
      part(eyeMat(0xffffff, 'glow'), [w * 0.32, h * 0.3, depth * 0.4], [-w * 0.28, h * 0.32, -depth * 0.75]);
      part(eyeMat(0xffffff, 'glow'), [w * 0.14, h * 0.13, depth * 0.4], [w * 0.3, -h * 0.35, -depth * 0.75]);
    } else {
      part(eyeMat(0xfdfdfb, 'gloss'), [w, h, depth], [0, 0, 0]);
      const ir = Math.min(w, h) * 0.66;
      const iy = -h * 0.08;
      part(eyeMat(spec.iris, 'gloss'), [ir, ir * 1.08, ir * 0.32], [0, iy, -depth * 0.78]);
      part(
        eyeMat(spec.pupil ?? 0x15121c, 'gloss'),
        [ir * 0.56, ir * 0.62, ir * 0.25],
        [0, iy, -depth * 0.78 - ir * 0.12],
      );
      part(
        eyeMat(0xffffff, 'glow'),
        [ir * 0.3, ir * 0.3, ir * 0.12],
        [-ir * 0.32, iy + ir * 0.38, -depth * 0.78 - ir * 0.28],
      );
      part(
        eyeMat(0xffffff, 'glow'),
        [ir * 0.13, ir * 0.13, ir * 0.08],
        [ir * 0.34, iy - ir * 0.34, -depth * 0.78 - ir * 0.26],
      );
      if (spec.style === 'sleepy') {
        const lid = new THREE.Mesh(
          new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, 1.42),
          eyeMat(spec.lid ?? 0x9a6a40, 'skin'),
        );
        lid.scale.set(w * 1.1, h * 1.1, depth * 1.9);
        lid.rotation.x = 0.12;
        eye.add(lid);
      }
    }
    eye.userData.side = side;
    group.add(eye);
  }
}
