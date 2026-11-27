// Primitive decor: each decor kind is merged into one vertex-coloured geometry and drawn as one InstancedMesh,
// so a theme's decor costs at most MAX_DECOR_KINDS (6) draw calls. Instances are scattered with a seeded RNG
// in a band around the playable bounds (never over it). Idle float and spin run in the vertex shader:
// the per-frame cost is one uniform write.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Prim, ThemeDef } from '@wobble/shared/types';
import type { Bounds, ThemeFeature } from './feature.ts';
import { MAX_DECOR_KINDS } from './resolve.ts';

type Decor = ThemeDef['decor'][number];

/** Most instances of one decor kind (density 1). */
export const MAX_INSTANCES_PER_KIND = 48;
/** Clear gap between the playable bounds and any decor, in metres. */
export const DECOR_MARGIN = 6;
/** Depth of the band decor is scattered in, beyond the margin, in metres. */
export const DECOR_BAND = 70;

/** Deterministic 32-bit PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string, used to seed the scatter from the theme. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/**
 * Scatter `count` placements around `bounds` on the XZ plane. A prop of radius `radius * scale`
 * never reaches within DECOR_MARGIN of the bounds box (so nothing sits over the playable area).
 */
export function scatterDecor(
  seed: number,
  count: number,
  bounds: Bounds,
  radius: number,
  minScale: number,
  maxScale: number,
): Placement[] {
  const rand = mulberry32(seed);
  const out: Placement[] = [];
  const [x0, y0, z0] = bounds.min;
  const [x1, y1, z1] = bounds.max;
  const w = x1 - x0;
  const d = z1 - z0;
  for (let i = 0; i < count; i++) {
    const scale = minScale + (maxScale - minScale) * rand();
    const clear = DECOR_MARGIN + radius * scale;
    const off = clear + DECOR_BAND * rand(); // distance outside the box edge
    const along = rand();
    // Pick a side weighted by its length so the band is evenly filled.
    const side = rand() * (2 * w + 2 * d);
    let x: number;
    let z: number;
    if (side < w) [x, z] = [x0 + along * w, z0 - off];
    else if (side < 2 * w) [x, z] = [x0 + along * w, z1 + off];
    else if (side < 2 * w + d) [x, z] = [x0 - off, z0 + along * d];
    else [x, z] = [x1 + off, z0 + along * d];
    out.push({ x, y: y0 + (y1 - y0 + 10) * rand(), z, yaw: rand() * Math.PI * 2, scale });
  }
  return out;
}

const unitGeometry: Record<Prim['shape'], () => THREE.BufferGeometry> = {
  // Unit primitives (1 m across); prim.scale stretches them. Low segment counts: these are far away.
  sphere: () => new THREE.SphereGeometry(0.5, 12, 8),
  box: () => new THREE.BoxGeometry(1, 1, 1),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  cone: () => new THREE.ConeGeometry(0.5, 1, 12),
  torus: () => new THREE.TorusGeometry(0.35, 0.15, 8, 16),
  capsule: () => new THREE.CapsuleGeometry(0.25, 0.5, 4, 10),
};

function fill(out: Float32Array, c: THREE.Color): void {
  for (let i = 0; i < out.length; i += 3) {
    out[i] = c.r;
    out[i + 1] = c.g;
    out[i + 2] = c.b;
  }
}

/** Merge a prop's primitives into one geometry with `color` and `aEmissive` vertex attributes. */
export function buildPropGeometry(prims: Prim[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  for (const p of prims) {
    const g = unitGeometry[p.shape]().toNonIndexed();
    g.deleteAttribute('uv');
    m.compose(
      new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]),
      q.setFromEuler(e.set(p.rot[0], p.rot[1], p.rot[2])),
      new THREE.Vector3(p.scale[0], p.scale[1], p.scale[2]),
    );
    g.applyMatrix4(m);
    const n = g.getAttribute('position').count;
    const color = new Float32Array(n * 3);
    const emissive = new Float32Array(n * 3);
    fill(color, c.set(p.color));
    fill(emissive, c.set(p.emissive ?? '#000000'));
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aEmissive', new THREE.BufferAttribute(emissive, 3));
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  for (const g of parts) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

function createDecorMaterial(time: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  material.name = 'theme:decor';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
attribute vec3 aEmissive;
varying vec3 vEmissive;
mat3 decorSpin() {
  #ifdef USE_INSTANCING
    float ph = fract(instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.071) * 6.2832;
  #else
    float ph = 0.0;
  #endif
  float a = uTime * (0.15 + 0.1 * sin(ph)) + ph;
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nobjectNormal = decorSpin() * objectNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vEmissive = aEmissive;
transformed = decorSpin() * transformed;
#ifdef USE_INSTANCING
  transformed.y += sin(uTime * 0.6 + instanceMatrix[3].x * 0.3 + instanceMatrix[3].z * 0.2) * 0.35;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEmissive;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vEmissive;',
      );
  };
  material.customProgramCacheKey = () => 'wobble-theme-decor';
  return material;
}

export interface DecorFeature extends ThemeFeature {
  readonly group: THREE.Group;
  /** The placements used for the current theme, per decor kind (for tests and tooling). */
  readonly placements: Placement[][];
}

export function createDecor(scene: THREE.Scene, theme: ThemeDef, bounds: Bounds): DecorFeature {
  const time = { value: 0 };
  const material = createDecorMaterial(time);
  const group = new THREE.Group();
  group.name = 'theme:decor';
  scene.add(group);
  const meshes: THREE.InstancedMesh[] = [];
  const placements: Placement[][] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  const clear = (): void => {
    for (const mesh of meshes) {
      group.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    meshes.length = 0;
    placements.length = 0;
  };

  const build = (kind: Decor, index: number, seed: number): void => {
    const count = Math.round(kind.density * MAX_INSTANCES_PER_KIND);
    if (count === 0) return;
    const geometry = buildPropGeometry(kind.prims);
    const radius = geometry.boundingSphere
      ? geometry.boundingSphere.center.length() + geometry.boundingSphere.radius
      : 1;
    const list = scatterDecor(seed + index * 7919, count, bounds, radius, kind.minScale, kind.maxScale);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `theme:decor:${kind.name}`;
    for (let i = 0; i < count; i++) {
      const p = list[i] as Placement;
      m.compose(pos.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), scl.set(p.scale, p.scale, p.scale));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.frustumCulled = false; // the scatter surrounds the course; one big sphere would never cull anyway
    group.add(mesh);
    meshes.push(mesh);
    placements.push(list);
  };

  const update = (t: ThemeDef): void => {
    clear();
    const seed = hashString(t.name);
    t.decor.slice(0, MAX_DECOR_KINDS).forEach((kind, i) => build(kind, i, seed));
  };
  update(theme);

  return {
    group,
    placements,
    update,
    tick(timeSec) {
      time.value = timeSec;
    },
    dispose() {
      clear();
      scene.remove(group);
      material.dispose();
    },
  };
}
