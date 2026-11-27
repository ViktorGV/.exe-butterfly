// Geometry for parts. Modest segment counts: the game runs on phones first.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Pose, Shape, Vec3 } from '@wobble/shared/types';

export const RADIAL_SEGMENTS = 16;
export const SPHERE_WIDTH_SEGMENTS = 16;
export const SPHERE_HEIGHT_SEGMENTS = 10;

/** Unit geometry per shape; scaleOf() maps a part size onto it (used by instanced parts). */
export function unitGeometry(shape: Shape): THREE.BufferGeometry {
  if (shape === 'box') return new THREE.BoxGeometry(2, 2, 2);
  if (shape === 'cylinder') return new THREE.CylinderGeometry(1, 1, 2, RADIAL_SEGMENTS);
  return new THREE.SphereGeometry(1, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS);
}

/** Scale that turns unitGeometry(shape) into a part of `size` (PartDef.size convention). */
export function scaleOf(shape: Shape, size: Vec3, out: THREE.Vector3): THREE.Vector3 {
  if (shape === 'box') return out.set(size[0], size[1], size[2]);
  if (shape === 'cylinder') return out.set(size[0], size[1], size[0]);
  return out.set(size[0], size[0], size[0]);
}

const m = new THREE.Matrix4();
const p = new THREE.Vector3();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();

/** Write the world matrix of a part of `shape`/`size` at `pose` (unit geometry) into `out`. */
export function partMatrix(shape: Shape, size: Vec3, pose: Pose, out: THREE.Matrix4): THREE.Matrix4 {
  p.set(pose.pos[0], pose.pos[1], pose.pos[2]);
  q.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
  return out.compose(p, q, scaleOf(shape, size, s));
}

/** Accumulates static parts per material slot and merges each slot into one geometry. */
export function createMergeBuffer() {
  const units = new Map<Shape, THREE.BufferGeometry>();
  const pending = new Map<string, THREE.BufferGeometry[]>();
  return {
    add(key: string, shape: Shape, size: Vec3, pose: Pose) {
      let unit = units.get(shape);
      if (!unit) units.set(shape, (unit = unitGeometry(shape)));
      const g = unit.clone().applyMatrix4(partMatrix(shape, size, pose, m));
      let list = pending.get(key);
      if (!list) pending.set(key, (list = []));
      list.push(g);
    },
    /** Merged geometry per key. Consumes the buffer. */
    build(): Map<string, THREE.BufferGeometry> {
      const out = new Map<string, THREE.BufferGeometry>();
      for (const [key, list] of pending) {
        const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
        if (merged !== list[0]) for (const g of list) g.dispose();
        if (merged) {
          merged.computeBoundingSphere();
          out.set(key, merged);
        }
      }
      for (const g of units.values()) g.dispose();
      units.clear();
      pending.clear();
      return out;
    },
  };
}
