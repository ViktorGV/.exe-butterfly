// Butterflies circling marked players (#84). Marks arrive as `marked` events (not in snapshots), so the
// client keeps the set and draws one small pooled butterfly per marked player. Nothing is allocated per frame.
import * as THREE from 'three';
import type { RemoteState, Vec3 } from '@wobble/shared/types';

export const MAX_MARKERS = 32;
export const ORBIT_RADIUS_M = 0.9;
export const ORBIT_HEIGHT_M = 2.1;
const ORBIT_RAD_PER_S = 2.4;

/** Where a player's butterfly is `t` seconds in (phase per id, so they don't move in lockstep). Writes out. */
export function orbitPoint(feet: Readonly<Vec3>, id: number, t: number, out: Vec3): Vec3 {
  const a = t * ORBIT_RAD_PER_S + id * 1.7;
  out[0] = feet[0] + Math.cos(a) * ORBIT_RADIUS_M;
  out[1] = feet[1] + ORBIT_HEIGHT_M + Math.sin(t * 5 + id) * 0.15;
  out[2] = feet[2] + Math.sin(a) * ORBIT_RADIUS_M;
  return out;
}

export interface MarkerView {
  mark(id: number): void;
  isMarked(id: number): boolean;
  /** `selfId` / `selfFeet` are the local player (not in `remote`). */
  update(tSec: number, remote: ReadonlyMap<number, RemoteState> | null, selfId: number, selfFeet: Readonly<Vec3>): void;
  reset(): void;
  dispose(): void;
}

export function createMarkerView({ scene }: { scene: THREE.Object3D }): MarkerView {
  const marked = new Set<number>();
  const geo = new THREE.PlaneGeometry(0.28, 0.22);
  geo.translate(0.14, 0, 0);
  const mat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, side: THREE.DoubleSide });
  const pool: { root: THREE.Group; l: THREE.Mesh; r: THREE.Mesh }[] = [];
  for (let i = 0; i < MAX_MARKERS; i++) {
    const root = new THREE.Group();
    const l = new THREE.Mesh(geo, mat);
    const r = new THREE.Mesh(geo, mat);
    r.rotation.y = Math.PI;
    root.add(l, r);
    root.visible = false;
    scene.add(root);
    pool.push({ root, l, r });
  }
  const p: Vec3 = [0, 0, 0];

  return {
    mark: (id) => void marked.add(id),
    isMarked: (id) => marked.has(id),
    update(t, remote, selfId, selfFeet) {
      let i = 0;
      for (const id of marked) {
        if (i >= MAX_MARKERS) break;
        const feet = id === selfId ? selfFeet : remote?.get(id)?.pos;
        if (!feet) continue;
        const m = pool[i++];
        orbitPoint(feet, id, t, p);
        m.root.position.set(p[0], p[1], p[2]);
        m.root.rotation.y = -(t * ORBIT_RAD_PER_S + id * 1.7);
        const flap = Math.sin(t * 22) * 0.9;
        m.l.rotation.x = flap;
        m.r.rotation.x = -flap;
        m.root.visible = true;
      }
      for (; i < MAX_MARKERS; i++) pool[i].root.visible = false;
    },
    reset() {
      marked.clear();
      for (const m of pool) m.root.visible = false;
    },
    dispose() {
      for (const m of pool) scene.remove(m.root);
      geo.dispose();
      mat.dispose();
    },
  };
}
