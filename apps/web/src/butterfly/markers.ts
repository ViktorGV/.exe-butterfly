// Butterflies circling marked players (#84). Marks arrive as `marked` events (not in snapshots), so the
// client keeps the set and draws one small pooled butterfly per marked player. Nothing is allocated per frame.
import * as THREE from 'three';
import type { RemoteState, Vec3 } from '@wobble/shared/types';
import { wing } from '../desk/textures.ts';

export const MAX_MARKERS = 32;
export const ORBIT_RADIUS_M = 0.9;
export const ORBIT_HEIGHT_M = 2.1;
const ORBIT_RAD_PER_S = 2.4;
/** The marking moment: the butterfly flies from the player who fell to the pusher in this long. */
export const BURST_SEC = 1;
const BURST_ARC_M = 1.5;
/** One paper wing is this wide (m); the body is a thin capsule between the two. */
const WING_M = 0.5;
const BODY_R_M = 0.035;
const BODY_LEN_M = 0.28;
/** Number of wing colours, shared round-robin by the pooled butterflies. */
const WING_HUES = 6;

/**
 * Where the bursting butterfly is at progress `k` (0..1) from `from` to `to` (both feet): eased, lifted in an
 * arc. Writes out.
 */
export function burstPoint(from: Readonly<Vec3>, to: Readonly<Vec3>, k: number, out: Vec3): Vec3 {
  const c = k < 0 ? 0 : k > 1 ? 1 : k;
  const e = c * c * (3 - 2 * c);
  for (let i = 0; i < 3; i++) out[i] = from[i] + (to[i] - from[i]) * e;
  out[1] += ORBIT_HEIGHT_M + Math.sin(Math.PI * c) * BURST_ARC_M;
  return out;
}

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
  /** Mark `id` and fly a butterfly out of `fromId` (the player who fell) to `id` over BURST_SEC. */
  burst(id: number, fromId: number): void;
  /** True while a burst is flying (for tests). */
  bursting(): boolean;
  isMarked(id: number): boolean;
  /** `selfId` / `selfFeet` are the local player (not in `remote`). */
  update(tSec: number, remote: ReadonlyMap<number, RemoteState> | null, selfId: number, selfFeet: Readonly<Vec3>): void;
  reset(): void;
  dispose(): void;
}

export function createMarkerView({ scene }: { scene: THREE.Object3D }): MarkerView {
  const marked = new Set<number>();
  // Same butterflies as the classic map's sky: the printed paper wing and a dark body, in a few hues. Without a
  // canvas (tests) the wings fall back to a plain colour.
  const geo = new THREE.PlaneGeometry(WING_M, WING_M);
  geo.translate(WING_M / 2, 0, 0);
  geo.rotateX(-Math.PI / 2);
  const bodyGeo = new THREE.CapsuleGeometry(BODY_R_M, BODY_LEN_M, 4, 8);
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x2b2440 });
  const mats: THREE.MeshBasicMaterial[] = [];
  for (let k = 0; k < WING_HUES; k++) {
    mats.push(
      typeof document === 'undefined'
        ? new THREE.MeshBasicMaterial({ color: 0xff8fd0, side: THREE.DoubleSide })
        : new THREE.MeshBasicMaterial({
            map: wing((k * 47) % 360),
            transparent: true,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
          }),
    );
  }
  const pool: { root: THREE.Group; l: THREE.Mesh; r: THREE.Mesh }[] = [];
  for (let i = 0; i < MAX_MARKERS; i++) {
    const w = createWings(geo, mats[i % WING_HUES]!, bodyGeo, bodyMat);
    scene.add(w.root);
    pool.push(w);
  }
  const p: Vec3 = [0, 0, 0];
  const burstFrom: Vec3 = [0, 0, 0];
  const burstTo: Vec3 = [0, 0, 0];
  const burstMesh = createWings(geo, mats[0]!, bodyGeo, bodyMat);
  scene.add(burstMesh.root);
  let burstId = -1;
  let burstFromId = -1;
  let burstStart = -1; // set on the first update after burst()
  const feetOf = (
    id: number,
    remote: ReadonlyMap<number, RemoteState> | null,
    selfId: number,
    selfFeet: Readonly<Vec3>,
  ) => (id === selfId ? selfFeet : remote?.get(id)?.pos);

  return {
    mark: (id) => void marked.add(id),
    burst(id, fromId) {
      marked.add(id);
      burstId = id;
      burstFromId = fromId;
      burstStart = -1;
    },
    bursting: () => burstId >= 0,
    isMarked: (id) => marked.has(id),
    update(t, remote, selfId, selfFeet) {
      if (burstId >= 0) {
        if (burstStart < 0) {
          burstStart = t;
          const f = feetOf(burstFromId, remote, selfId, selfFeet);
          const to0 = feetOf(burstId, remote, selfId, selfFeet);
          if (f) for (let k = 0; k < 3; k++) burstFrom[k] = f[k];
          else if (to0) for (let k = 0; k < 3; k++) burstFrom[k] = to0[k];
        }
        const k = (t - burstStart) / BURST_SEC;
        const to = feetOf(burstId, remote, selfId, selfFeet);
        if (k >= 1 || !to) {
          burstId = -1;
          burstMesh.root.visible = false;
        } else {
          for (let j = 0; j < 3; j++) burstTo[j] = to[j];
          burstPoint(burstFrom, burstTo, k, p);
          burstMesh.root.position.set(p[0], p[1], p[2]);
          const flap = Math.sin(t * 30) * 1.1;
          burstMesh.l.rotation.z = flap;
          burstMesh.r.rotation.z = -flap;
          burstMesh.root.scale.setScalar(1.6 - 0.6 * k);
          burstMesh.root.visible = true;
        }
      }
      let i = 0;
      for (const id of marked) {
        if (i >= MAX_MARKERS) break;
        if (id === burstId) continue; // still flying in; it starts circling when it lands
        const feet = id === selfId ? selfFeet : remote?.get(id)?.pos;
        if (!feet) continue;
        const m = pool[i++];
        orbitPoint(feet, id, t, p);
        m.root.position.set(p[0], p[1], p[2]);
        m.root.rotation.y = -(t * ORBIT_RAD_PER_S + id * 1.7);
        const flap = Math.sin(t * 22) * 0.9;
        m.l.rotation.z = flap;
        m.r.rotation.z = -flap;
        m.root.visible = true;
      }
      for (; i < MAX_MARKERS; i++) pool[i].root.visible = false;
    },
    reset() {
      marked.clear();
      burstId = -1;
      burstMesh.root.visible = false;
      for (const m of pool) m.root.visible = false;
    },
    dispose() {
      for (const m of pool) scene.remove(m.root);
      scene.remove(burstMesh.root);
      geo.dispose();
      bodyGeo.dispose();
      bodyMat.dispose();
      for (const m of mats) m.dispose(); // the wing textures are shared with the desk scenery and stay cached
    },
  };
}

function createWings(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  bodyGeo: THREE.BufferGeometry,
  bodyMat: THREE.Material,
) {
  const root = new THREE.Group();
  const l = new THREE.Mesh(geo, mat);
  const r = new THREE.Mesh(geo, mat);
  r.scale.x = -1;
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.x = Math.PI / 2;
  root.add(l, r, body);
  root.visible = false;
  return { root, l, r };
}
