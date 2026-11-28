// Course runtime (#7): turns a CourseDef into meshes, colliders, markers and spawn grids, driven only
// by the obstacle registry (it knows nothing about specific kinds).
import * as THREE from 'three';
import { getObstacleKind, kindBounds, periodOf } from '@wobble/shared';
import { quatFromYaw } from '@wobble/shared/course/obstacles/math';
import type {
  Collider,
  CourseDef,
  EntityDef,
  MaterialSlot,
  ObstacleKind,
  PartDef,
  Pose,
  Shape,
} from '@wobble/shared/types';
import type { AppliedTheme } from '../theme/index.ts';
import type { DressingTemplate } from '../theme/v2/dressing.ts';
import { createMergeBuffer, partMatrix, unitGeometry } from './geometry.ts';
import { checkpointMarker, finishMarker, type MarkerPiece } from './markers.ts';
import { gridPoint, respawnGrid, type SpawnPoint } from './spawn.ts';

export interface CourseAnchors {
  /** Spawn grid origin, facing the course. */
  start: Pose;
  finish: Pose;
  checkpoints: Pose[];
}

export interface CourseRuntimeOptions {
  courseDef: CourseDef;
  theme: Pick<AppliedTheme, 'getMaterial'>;
  /** Theme v2 (#64) obstacle dressing: cosmetic prims that ride on a part and may hide its base mesh. */
  getDressing?: (kind: string, partIndex: number) => DressingTemplate | null;
  scene: THREE.Object3D;
  /** Let course meshes cast and receive shadows (they only render if renderer.shadowMap.enabled). Default true. */
  shadows?: boolean;
}

export interface CourseRuntime {
  /** The group holding every course mesh (already added to the scene). */
  readonly root: THREE.Group;
  /** Advance collider poses to simulation time t; prevPose keeps the previous call's pose. */
  stepColliders(t: number): void;
  /** Move the visible moving parts to render time t. */
  update(t: number): void;
  /** Every part with collide: true. Stable array and pose objects, updated in place. */
  getColliders(): readonly Collider[];
  spawnPoint(slot: number, out?: SpawnPoint): SpawnPoint;
  /** checkpoint is PlayerState.checkpoint (-1 = none yet, which uses the start grid). */
  respawnPoint(checkpoint: number, slot: number, out?: SpawnPoint): SpawnPoint;
  getAnchors(): CourseAnchors;
  dispose(): void;
}

interface MovingEntity {
  def: EntityDef;
  kind: ObstacleKind;
  sim: Pose[];
  prev: Pose[];
  vis: Pose[];
  /** Per part: instanced mesh and index, or null when the part is not drawn. */
  mesh: (THREE.InstancedMesh | null)[];
  index: number[];
  parts: PartDef[];
  /** Per part: dressing instance (mesh, index, stretch to the real part size) or null. */
  dress: ({ mesh: THREE.InstancedMesh; index: number; scale: THREE.Vector3 } | null)[];
}

interface DressBucket {
  template: DressingTemplate;
  count: number;
  mesh: THREE.InstancedMesh | null;
}

/** Half extents of a part in its own frame (PartDef.size convention). */
const halfOf = (part: Pick<PartDef, 'shape' | 'size'>): [number, number, number] => {
  const [a, b, c] = part.size;
  return part.shape === 'box' ? [a, b, c] : part.shape === 'cylinder' ? [a, b, a] : [a, a, a];
};

/** Parts of a kind at default parameters: theme dressing is authored for these sizes. */
const defaultParts = new Map<string, PartDef[]>();
function defaultPart(kind: string, i: number): PartDef | null {
  let parts = defaultParts.get(kind);
  if (!parts) {
    try {
      parts = getObstacleKind(kind)?.parts({ id: 0, kind, pos: [0, 0, 0], yaw: 0, params: {} }) ?? [];
    } catch {
      parts = [];
    }
    defaultParts.set(kind, parts);
  }
  return parts[i] ?? null;
}

const newPose = (): Pose => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] });
const copyPose = (from: Pose, to: Pose) => {
  for (let k = 0; k < 3; k++) to.pos[k] = from.pos[k];
  for (let k = 0; k < 4; k++) to.quat[k] = from.quat[k];
};
const samePoses = (a: Pose[], b: Pose[]) =>
  a.every((p, i) => p.pos.every((v, k) => v === b[i].pos[k]) && p.quat.every((v, k) => v === b[i].quat[k]));

function anchor(pos: readonly number[], yaw: number): Pose {
  return { pos: [pos[0], pos[1], pos[2]], quat: quatFromYaw(yaw, [0, 0, 0, 1]) };
}

/** Load an entity's parts and t = 0 poses; null (with a warning) when it cannot be built. */
function loadEntity(def: EntityDef) {
  const kind = getObstacleKind(def.kind);
  if (!kind) {
    console.warn(`[course] skipping entity ${def.id}: unknown obstacle kind "${def.kind}"`);
    return null;
  }
  try {
    const parts = kind.parts(def);
    const sim = parts.map(newPose);
    kind.pose(def, 0, sim);
    let moving = periodOf(def) > 0;
    if (!moving) {
      // Trust but verify: a kind that reports no period must really be static.
      const probe = parts.map(newPose);
      kind.pose(def, 1.37, probe);
      moving = !samePoses(sim, probe);
    }
    return { kind, parts, sim, moving };
  } catch (err) {
    console.warn(`[course] skipping entity ${def.id} ("${def.kind}"): ${String(err)}`);
    return null;
  }
}

export function createCourseRuntime({
  courseDef,
  theme,
  getDressing,
  scene,
  shadows = true,
}: CourseRuntimeOptions): CourseRuntime {
  const root = new THREE.Group();
  root.name = `course:${courseDef.id}`;
  const geometries: THREE.BufferGeometry[] = [];
  const colliders: Collider[] = [];
  const moving: MovingEntity[] = [];
  const merge = createMergeBuffer();
  const bucketKey = (shape: Shape, slot: MaterialSlot) => `${shape}|${slot}`;
  const buckets = new Map<string, { shape: Shape; slot: MaterialSlot; count: number; bounds: THREE.Box3 }>();
  // Theme dressing (#64): one InstancedMesh per template. Purely cosmetic, never collides.
  const dressBuckets = new Map<DressingTemplate, DressBucket>();
  type DressSlot = { bucket: DressBucket; index: number; scale: THREE.Vector3 };
  const staticDress: (DressSlot & { pose: Pose })[] = [];
  const movingDress: DressSlot[][] = [];
  /**
   * Dressing for one part; returns whether the base mesh should be hidden. Dressing is authored for the kind's
   * default part size, so it is stretched to this part's real size: it fits every tile, and its surfaces never
   * sit exactly on a visible base (which flickered).
   */
  const dressPart = (kind: string, part: PartDef, i: number, out: DressSlot[]) => {
    const template = part.visible ? (getDressing?.(kind, i) ?? null) : null;
    if (!template) return false;
    let bucket = dressBuckets.get(template);
    if (!bucket) dressBuckets.set(template, (bucket = { template, count: 0, mesh: null }));
    const authored = defaultPart(kind, i);
    const scale = new THREE.Vector3(1, 1, 1);
    if (authored && authored.shape === part.shape) {
      const [ax, ay, az] = halfOf(authored);
      const [px, py, pz] = halfOf(part);
      const ratio = (p: number, a: number) => (a > 1e-6 && p > 1e-6 ? Math.min(8, Math.max(0.125, p / a)) : 1);
      scale.set(ratio(px, ax), ratio(py, ay), ratio(pz, az));
    }
    out[i] = { bucket, index: bucket.count++, scale };
    // Stretched proportionally, the coverage is the same as on the part it was authored for.
    return template.hidesBase(authored && authored.shape === part.shape ? authored : part);
  };

  // 1. Entities: colliders for every collidable part; static visible parts are merged, moving ones instanced.
  for (const def of courseDef.entities) {
    const e = loadEntity(def);
    if (!e) continue;
    const prev = e.sim.map((p) => {
      const c = newPose();
      copyPose(p, c);
      return c;
    });
    e.parts.forEach((part, i) => {
      if (part.collide) colliders.push({ entityId: def.id, part, pose: e.sim[i], prevPose: prev[i] });
    });
    const dress: DressSlot[] = [];
    if (!e.moving) {
      e.parts.forEach((part, i) => {
        const hidden = dressPart(def.kind, part, i, dress);
        if (dress[i]) staticDress.push({ ...dress[i], pose: e.sim[i] });
        if (part.visible && !hidden) merge.add(part.slot, part.shape, part.size, e.sim[i]);
      });
      continue;
    }
    const swept = kindBounds(def);
    const box = swept ? new THREE.Box3().setFromArray([...swept.min, ...swept.max]) : null;
    const index: number[] = [];
    e.parts.forEach((part, i) => {
      const hidden = dressPart(def.kind, part, i, dress);
      const drawn = part.visible && !hidden;
      const key = bucketKey(part.shape, part.slot);
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { shape: part.shape, slot: part.slot, count: 0, bounds: new THREE.Box3() }));
      index.push(drawn ? b.count++ : -1);
      if (box && drawn) b.bounds.union(box);
    });
    movingDress.push(dress);
    const vis = e.sim.map(newPose);
    moving.push({ def, kind: e.kind, sim: e.sim, prev, vis, mesh: [], index, parts: e.parts, dress: [] });
  }

  // 2. Checkpoint and finish markers join the static merge.
  const markers: MarkerPiece[] = [];
  for (const c of courseDef.checkpoints) checkpointMarker(c.volume, markers);
  finishMarker(courseDef.finish, markers);
  for (const m of markers) merge.add(m.slot, m.shape, m.size, m.pose);

  const addMesh = (mesh: THREE.Mesh) => {
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    root.add(mesh);
  };
  for (const [slot, geometry] of merge.build()) {
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, theme.getMaterial(slot as MaterialSlot));
    mesh.name = `static:${slot}`;
    mesh.matrixAutoUpdate = false;
    addMesh(mesh);
  }

  // 3. One InstancedMesh per (shape, slot) for moving parts, culled with the parts' swept bounds.
  const instanced = new Map<string, THREE.InstancedMesh>();
  for (const [key, b] of buckets) {
    if (b.count === 0) continue;
    const geometry = unitGeometry(b.shape);
    geometries.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, theme.getMaterial(b.slot), b.count);
    mesh.name = `moving:${key}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.matrixAutoUpdate = false;
    mesh.boundingBox = b.bounds;
    mesh.boundingSphere = b.bounds.getBoundingSphere(new THREE.Sphere());
    mesh.frustumCulled = !b.bounds.isEmpty();
    instanced.set(key, mesh);
    addMesh(mesh);
  }
  // 4. Dressing meshes: static placements are written once, moving ones every update().
  for (const b of dressBuckets.values()) {
    const mesh = new THREE.InstancedMesh(b.template.geometry, b.template.material, b.count);
    mesh.name = `dressing:${b.template.kind}:${b.template.part}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    b.mesh = mesh;
    instanced.set(mesh.name, mesh);
    addMesh(mesh);
  }
  moving.forEach((e, n) => {
    e.mesh = e.parts.map((part, i) =>
      e.index[i] >= 0 ? (instanced.get(bucketKey(part.shape, part.slot)) ?? null) : null,
    );
    e.dress = e.parts.map((_, i) => {
      const d = movingDress[n][i];
      return d?.bucket.mesh ? { mesh: d.bucket.mesh, index: d.index, scale: d.scale } : null;
    });
  });
  const instancedList = [...instanced.values()];
  scene.add(root);

  const matrix = new THREE.Matrix4();
  const dp = new THREE.Vector3();
  const dq = new THREE.Quaternion();
  const poseMatrix = (pose: Pose, scale: THREE.Vector3) =>
    matrix.compose(
      dp.set(pose.pos[0], pose.pos[1], pose.pos[2]),
      dq.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]),
      scale,
    );
  for (const s of staticDress) s.bucket.mesh?.setMatrixAt(s.index, poseMatrix(s.pose, s.scale));
  let stepped = false;

  function update(t: number) {
    for (let n = 0; n < moving.length; n++) {
      const e = moving[n];
      e.kind.pose(e.def, t, e.vis);
      for (let i = 0; i < e.parts.length; i++) {
        const mesh = e.mesh[i];
        if (mesh) mesh.setMatrixAt(e.index[i], partMatrix(e.parts[i].shape, e.parts[i].size, e.vis[i], matrix));
        const d = e.dress[i];
        if (d) d.mesh.setMatrixAt(d.index, poseMatrix(e.vis[i], d.scale));
      }
    }
    for (let i = 0; i < instancedList.length; i++) instancedList[i].instanceMatrix.needsUpdate = true;
  }

  function stepColliders(t: number) {
    for (let n = 0; n < moving.length; n++) {
      const e = moving[n];
      if (stepped) for (let i = 0; i < e.sim.length; i++) copyPose(e.sim[i], e.prev[i]);
      e.kind.pose(e.def, t, e.sim);
      if (!stepped) for (let i = 0; i < e.sim.length; i++) copyPose(e.sim[i], e.prev[i]);
    }
    stepped = true;
  }

  const anchors: CourseAnchors = {
    start: anchor(courseDef.spawn.pos, courseDef.spawn.yaw),
    finish: anchor(courseDef.finish.pos, courseDef.finish.yaw),
    checkpoints: courseDef.checkpoints.map((c) => anchor(c.volume.pos, c.volume.yaw)),
  };

  update(0);

  return {
    root,
    stepColliders,
    update,
    getColliders: () => colliders,
    spawnPoint: (slot, out) => gridPoint(courseDef.spawn, slot, out),
    respawnPoint: (checkpoint, slot, out) =>
      gridPoint(respawnGrid(courseDef.spawn, courseDef.checkpoints, checkpoint), slot, out),
    getAnchors: () => anchors,
    dispose() {
      scene.remove(root);
      for (const mesh of instancedList) mesh.dispose();
      for (const g of geometries) g.dispose();
      root.clear();
      geometries.length = 0;
      colliders.length = 0;
      moving.length = 0;
      instancedList.length = 0;
    },
  };
}
