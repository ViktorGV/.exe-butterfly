// Themed set dressing for the desk map (#64): the school desk surrounds the course with giant props (monitor,
// mug, lamp, plant, scissors) and small clutter. An event theme hides those, so it fills the same space with its
// own: copies of its landmarks as giant set pieces staggered down both sides, and its prim decor scattered as
// clutter near the track. Everything comes from the theme data, so every theme gets its own busy surroundings.
// Visual only, outside the playable area, deterministic (every player sees the same).
import * as THREE from 'three';
import type { CourseDef, Prim, ThemeDefV2 } from '@wobble/shared/types';
import { primsGeometry, primsMaterial } from './prims.ts';

export interface ThemeProps {
  group: THREE.Group;
  /** Pulse the glowing parts (call every frame with seconds). */
  update(t: number): void;
  dispose(): void;
}

function rnd(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Height of a prim set in its own units (top of the highest prim minus bottom of the lowest). */
function heightOf(prims: readonly Prim[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of prims) {
    const r = Math.max(Math.abs(p.scale[0]), Math.abs(p.scale[1]), Math.abs(p.scale[2]));
    lo = Math.min(lo, p.pos[1] - r);
    hi = Math.max(hi, p.pos[1] + r);
  }
  return Number.isFinite(hi - lo) && hi - lo > 0.01 ? hi - lo : 1;
}

export function createThemeProps(opts: { theme: ThemeDefV2; course: CourseDef; groundY: number }): ThemeProps {
  const { theme, course, groundY } = opts;
  const r = rnd(11);
  const group = new THREE.Group();
  group.name = 'theme:props';
  const material = primsMaterial();
  // A soft fill in the theme's own haze colour: against a low sun the set pieces would read as black cut-outs.
  // The set pieces are giant and far: the theme's (often dark) fog would swallow them, so they skip it and take a
  // fill from the sky's horizon glow, standing out against the sky like the desk's giant props.
  material.fog = false;
  material.emissive.set(theme.sky.horizon).multiplyScalar(0.35);
  const geometries: THREE.BufferGeometry[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  const { min, max } = course.bounds;
  const cx = (min[0] + max[0]) / 2;
  const halfW = (max[0] - min[0]) / 2;
  const zStart = max[2] + 10;
  const zEnd = min[2] - 10;
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const place = (prims: readonly Prim[], spots: { x: number; z: number; h: number }[]) => {
    if (prims.length === 0 || spots.length === 0) return;
    const geo = primsGeometry(prims);
    // Stand the set on the ground: its lowest point at y = 0.
    geo.computeBoundingBox();
    geo.translate(0, -(geo.boundingBox?.min.y ?? 0), 0);
    geometries.push(geo);
    const unit = heightOf(prims);
    const mesh = new THREE.InstancedMesh(geo, material, spots.length);
    spots.forEach((s, i) => {
      const k = s.h / unit;
      q.setFromAxisAngle(up, r() * Math.PI * 2);
      mesh.setMatrixAt(i, m.compose(p.set(s.x, groundY, s.z), q, sc.set(k, k, k)));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
    group.add(mesh);
  };

  // Giant set pieces: one every ~45 m on each side, 30-70 m tall, cycling through the landmarks.
  const sets = theme.landmarks.filter((l) => l.prims.length > 0);
  if (sets.length) {
    const spotsBySet = sets.map(() => [] as { x: number; z: number; h: number }[]);
    let i = 0;
    for (let z = zStart - 20; z > zEnd; z -= 45) {
      for (const side of [-1, 1]) {
        const x = cx + side * (halfW + 40 + r() * 35);
        spotsBySet[i % sets.length].push({ x, z: z - r() * 20, h: 30 + r() * 40 });
        i++;
      }
    }
    sets.forEach((l, k) => place(l.prims, spotsBySet[k]));
  }

  // The destination: like the school desk's giant monitor at the far end, the theme's first landmark stands big and
  // centred well behind the finish, so every racer runs toward it.
  if (sets.length) place(sets[0].prims, [{ x: cx, z: min[2] - 90, h: 95 }]);

  // Clutter near the track: the prim decor, 4-12 m tall, a few metres outside the course on both sides.
  const clutter = theme.decor.filter((d) => d.type === 'prims' && d.prims.length > 0);
  if (clutter.length) {
    const spotsBy = clutter.map(() => [] as { x: number; z: number; h: number }[]);
    let i = 0;
    for (let z = zStart; z > zEnd; z -= 9) {
      for (const side of [-1, 1]) {
        if (r() < 0.35) continue;
        const x = cx + side * (halfW + 4 + r() * 18);
        spotsBy[i % clutter.length].push({ x, z: z - r() * 6, h: 6 + r() * 10 });
        i++;
      }
    }
    clutter.forEach((d, k) => place(d.prims, spotsBy[k]));
  }

  return {
    group,
    update(t) {
      material.userData.glow.value = 0.8 + 0.35 * Math.sin(t * 1.3);
    },
    dispose() {
      group.removeFromParent();
      for (const mesh of meshes) mesh.dispose();
      for (const g of geometries) g.dispose();
      material.dispose();
    },
  };
}
