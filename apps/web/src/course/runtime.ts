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

export function createCourseRuntime({ courseDef, theme, scene, shadows = true }: CourseRuntimeOptions): CourseRuntime {
  const root = new THREE.Group();
  root.name = `course:${courseDef.id}`;
  const geometries: THREE.BufferGeometry[] = [];
  const colliders: Collider[] = [];
  const moving: MovingEntity[] = [];
  const merge = createMergeBuffer();
  const bucketKey = (shape: Shape, slot: MaterialSlot) => `${shape}|${slot}`;
  const buckets = new Map<string, { shape: Shape; slot: MaterialSlot; count: number; bounds: THREE.Box3 }>();

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
    if (!e.moving) {
      e.parts.forEach((part, i) => part.visible && merge.add(part.slot, part.shape, part.size, e.sim[i]));
      continue;
    }
    const swept = kindBounds(def);
    const box = swept ? new THREE.Box3().setFromArray([...swept.min, ...swept.max]) : null;
    const index: number[] = [];
    for (const part of e.parts) {
      const key = bucketKey(part.shape, part.slot);
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { shape: part.shape, slot: part.slot, count: 0, bounds: new THREE.Box3() }));
      index.push(part.visible ? b.count++ : -1);
      if (box && part.visible) b.bounds.union(box);
    }
    const vis = e.sim.map(newPose);
    moving.push({ def, kind: e.kind, sim: e.sim, prev, vis, mesh: [], index, parts: e.parts });
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
  for (const e of moving) {
    e.mesh = e.parts.map((part, i) =>
      e.index[i] >= 0 ? (instanced.get(bucketKey(part.shape, part.slot)) ?? null) : null,
    );
  }
  const instancedList = [...instanced.values()];
  scene.add(root);

  const matrix = new THREE.Matrix4();
  let stepped = false;

  function update(t: number) {
    for (let n = 0; n < moving.length; n++) {
      const e = moving[n];
      e.kind.pose(e.def, t, e.vis);
      for (let i = 0; i < e.parts.length; i++) {
        const mesh = e.mesh[i];
        if (mesh) mesh.setMatrixAt(e.index[i], partMatrix(e.parts[i].shape, e.parts[i].size, e.vis[i], matrix));
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
