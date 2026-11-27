// Prims -> one merged, vertex-coloured geometry (dressing, landmarks, prim decor). One draw call each.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Prim } from '@wobble/shared/types';

/** Unit shapes fitting [-1, 1]^3, the same convention coverage.ts uses. */
function unitPrim(shape: Prim['shape']): THREE.BufferGeometry {
  switch (shape) {
    case 'box':
      return new THREE.BoxGeometry(2, 2, 2);
    case 'cylinder':
      return new THREE.CylinderGeometry(1, 1, 2, 12);
    case 'cone':
      return new THREE.ConeGeometry(1, 2, 12);
    case 'torus':
      return new THREE.TorusGeometry(0.7, 0.3, 8, 16);
    case 'capsule':
      return new THREE.CapsuleGeometry(0.5, 1, 4, 8);
    default:
      return new THREE.SphereGeometry(1, 12, 8);
  }
}

const m = new THREE.Matrix4();
const e = new THREE.Euler();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const s = new THREE.Vector3();
const c = new THREE.Color();

/** Merged geometry with a `color` attribute; `scale` multiplies every prim (landmark scale). */
export function primsGeometry(prims: readonly Prim[], scale = 1): THREE.BufferGeometry {
  const parts = prims.map((prim) => {
    const g = unitPrim(prim.shape);
    e.set(prim.rot[0], prim.rot[1], prim.rot[2]);
    m.compose(
      p.set(prim.pos[0] * scale, prim.pos[1] * scale, prim.pos[2] * scale),
      q.setFromEuler(e),
      s.set(prim.scale[0] * scale, prim.scale[1] * scale, prim.scale[2] * scale),
    );
    g.applyMatrix4(m);
    c.set(prim.color);
    if (prim.emissive) c.lerp(new THREE.Color(prim.emissive), 0.5);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  const merged = parts.length === 1 ? parts[0] : (mergeGeometries(parts, false) ?? new THREE.BufferGeometry());
  if (merged !== parts[0]) for (const g of parts) g.dispose();
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

export function primsMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
}
