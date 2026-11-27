import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as THREE from 'three';
import {
  assembleCourse,
  fixtureCourse,
  fixtureTheme,
  getObstacleKind,
  listObstacleKinds,
  periodOf,
  resolveBuiltin,
} from '@wobble/shared';
import type { CourseDef, CourseRecipe, EntityDef, Pose } from '@wobble/shared/types';
import { applyTheme } from '../theme/index.ts';
import { partMatrix } from './geometry.ts';
import { createCourseRuntime, type CourseRuntime } from './index.ts';

const defaultCourse = (): CourseDef => assembleCourse(resolveBuiltin('b:gumdrop-gauntlet')!.data as CourseRecipe);

/** A synthetic course: `n` entities cycling through every registered kind with default params. */
function syntheticCourse(n: number): CourseDef {
  const kinds = listObstacleKinds();
  const entities: EntityDef[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    kind: kinds[i % kinds.length],
    pos: [(i % 4) * 16 - 24, 0, -Math.floor(i / 4) * 16],
    yaw: (i * 0.37) % Math.PI,
    params: {},
  }));
  return { ...structuredClone(fixtureCourse), id: 'synthetic', entities };
}

function drawables(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  return meshes;
}

const posesAt = (def: EntityDef, t: number): Pose[] => {
  const kind = getObstacleKind(def.kind)!;
  const out = kind.parts(def).map((): Pose => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
  kind.pose(def, t, out);
  return out;
};

let scene: THREE.Scene;
let theme: ReturnType<typeof applyTheme>;
let runtime: CourseRuntime | null;
beforeEach(() => {
  scene = new THREE.Scene();
  theme = applyTheme(fixtureTheme, { scene });
  runtime = null;
});
afterEach(() => {
  runtime?.dispose();
  theme.dispose();
});

describe('createCourseRuntime on the built-in default course', () => {
  it('has one collider per collidable part, matching parts() and pose() at every step', () => {
    const course = defaultCourse();
    runtime = createCourseRuntime({ courseDef: course, theme, scene });
    const colliders = runtime.getColliders();
    let expected = 0;
    for (const def of course.entities)
      expected += getObstacleKind(def.kind)!
        .parts(def)
        .filter((p) => p.collide).length;
    expect(colliders.length).toBe(expected);

    for (const t of [-3, 0, 1.25, 7.5, 61]) {
      runtime.stepColliders(t);
      let c = 0;
      for (const def of course.entities) {
        const parts = getObstacleKind(def.kind)!.parts(def);
        const poses = posesAt(def, t);
        parts.forEach((part, i) => {
          if (!part.collide) return;
          const col = colliders[c++];
          expect(col.entityId).toBe(def.id);
          expect(col.part).toEqual(part);
          expect(col.pose.pos).toEqual(poses[i].pos);
          expect(col.pose.quat).toEqual(poses[i].quat);
        });
      }
    }
  });

  it('keeps the array and pose objects stable and prevPose equal to the previous step', () => {
    runtime = createCourseRuntime({ courseDef: defaultCourse(), theme, scene });
    const colliders = runtime.getColliders();
    const poseRefs = colliders.map((c) => [c.pose, c.prevPose]);
    runtime.stepColliders(0);
    for (const c of colliders) expect(c.prevPose).toEqual(c.pose); // first step: no motion
    let last = colliders.map((c) => structuredClone(c.pose));
    let movedSome = false;
    for (let step = 1; step <= 120; step++) {
      runtime.stepColliders(step / 60);
      colliders.forEach((c, i) => {
        expect(c.prevPose).toEqual(last[i]);
        if (c.pose.pos.some((v, k) => v !== last[i].pos[k])) movedSome = true;
      });
      last = colliders.map((c) => structuredClone(c.pose));
    }
    expect(movedSome).toBe(true);
    expect(runtime.getColliders()).toBe(colliders);
    colliders.forEach((c, i) => {
      expect(c.pose).toBe(poseRefs[i][0]);
      expect(c.prevPose).toBe(poseRefs[i][1]);
    });
  });

  it('draws moving parts where their colliders are (same time on both clocks)', () => {
    const course = defaultCourse();
    runtime = createCourseRuntime({ courseDef: course, theme, scene });
    const moving = new Set(course.entities.filter((e) => periodOf(e) > 0).map((e) => e.id));
    const t = 2.3;
    runtime.update(t);
    runtime.stepColliders(t);
    const instanced = drawables(runtime.root).filter((m): m is THREE.InstancedMesh => m instanceof THREE.InstancedMesh);
    expect(instanced.length).toBeGreaterThan(0);
    const expected = new THREE.Matrix4();
    const actual = new THREE.Matrix4();
    let checked = 0;
    for (const c of runtime.getColliders()) {
      if (!c.part.visible || !moving.has(c.entityId)) continue; // static parts are merged
      partMatrix(c.part.shape, c.part.size, c.pose, expected);
      const mesh = instanced.find((m) => m.name === `moving:${c.part.shape}|${c.part.slot}`);
      if (!mesh) throw new Error(`no instanced mesh for ${c.part.shape}|${c.part.slot}`);
      let found = false;
      for (let i = 0; i < mesh.count && !found; i++) {
        mesh.getMatrixAt(i, actual);
        found = actual.elements.every((v, k) => Math.abs(v - expected.elements[k]) < 1e-4);
      }
      expect(found).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('keeps the render clock separate from the simulation clock', () => {
    runtime = createCourseRuntime({ courseDef: defaultCourse(), theme, scene });
    runtime.stepColliders(1);
    const before = runtime.getColliders().map((c) => structuredClone(c.pose));
    runtime.update(5);
    expect(runtime.getColliders().map((c) => c.pose)).toEqual(before);
  });

  it('spawns and respawns on the course grids', () => {
    const course = defaultCourse();
    runtime = createCourseRuntime({ courseDef: course, theme, scene });
    expect(runtime.spawnPoint(0).yaw).toBe(course.spawn.yaw);
    const seen = new Set<string>();
    for (let s = 0; s < 300; s++)
      seen.add(
        runtime
          .spawnPoint(s)
          .pos.map((v) => v.toFixed(6))
          .join(),
      );
    expect(seen.size).toBe(300);
    expect(runtime.respawnPoint(-1, 5)).toEqual(runtime.spawnPoint(5));
    const cp = course.checkpoints[1].respawn;
    const p = runtime.respawnPoint(1, 0);
    expect(p.yaw).toBe(cp.yaw);
    expect(Math.hypot(p.pos[0] - cp.pos[0], p.pos[2] - cp.pos[2])).toBeCloseTo(((cp.cols - 1) / 2) * cp.spacing, 9);
    const last = course.checkpoints.at(-1)!.respawn;
    expect(runtime.respawnPoint(99, 3)).toEqual(runtime.respawnPoint(course.checkpoints.length - 1, 3));
    expect(runtime.respawnPoint(99, 3).yaw).toBe(last.yaw);
  });

  it('exposes start, checkpoint and finish anchors', () => {
    const course = defaultCourse();
    runtime = createCourseRuntime({ courseDef: course, theme, scene });
    const a = runtime.getAnchors();
    expect(a.start.pos).toEqual(course.spawn.pos);
    expect(a.finish.pos).toEqual(course.finish.pos);
    expect(a.checkpoints.map((p) => p.pos)).toEqual(course.checkpoints.map((c) => c.volume.pos));
  });
});

describe('robustness and budgets', () => {
  it('skips unknown kinds with a warning instead of crashing', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const course = structuredClone(fixtureCourse);
      course.entities.push({ id: 999, kind: 'laserShark', pos: [0, 0, 0], yaw: 0, params: {} });
      runtime = createCourseRuntime({ courseDef: course, theme, scene });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('laserShark');
      expect(runtime.getColliders().some((c) => c.entityId === 999)).toBe(false);
      expect(runtime.getColliders().length).toBe(fixtureCourse.entities.length);
      runtime.stepColliders(1);
      runtime.update(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('draws a 400-entity course in at most 60 draw calls and steps it in under 0.5 ms', () => {
    const course = syntheticCourse(400);
    runtime = createCourseRuntime({ courseDef: course, theme, scene });
    const meshes = drawables(scene);
    expect(meshes.length).toBeLessThanOrEqual(60);
    expect(runtime.getColliders().length).toBeGreaterThan(400);

    for (let i = 0; i < 200; i++) {
      runtime.stepColliders(i / 60);
      runtime.update(i / 60 - 0.01);
    }
    const N = 600;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      runtime.stepColliders(10 + i / 60);
      runtime.update(10 + i / 60 - 0.01);
    }
    const ms = (performance.now() - start) / N;
    console.log(`[course] 400 entities: ${meshes.length} draw calls, update + stepColliders ${ms.toFixed(4)} ms`);
    expect(ms).toBeLessThan(0.5);
  });

  it('dispose removes every mesh and frees its geometry', () => {
    const before = scene.children.length;
    runtime = createCourseRuntime({ courseDef: syntheticCourse(40), theme, scene });
    expect(scene.children.length).toBe(before + 1);
    const meshes = drawables(runtime.root);
    let disposed = 0;
    const geometries = new Set(meshes.map((m) => m.geometry));
    for (const g of geometries) g.addEventListener('dispose', () => disposed++);
    runtime.dispose();
    runtime = null;
    expect(scene.children.length).toBe(before);
    expect(drawables(scene).length).toBe(0);
    expect(disposed).toBe(geometries.size);
  });

  it('renders checkpoint and finish markers without adding colliders', () => {
    const course = structuredClone(fixtureCourse);
    course.entities = [];
    runtime = createCourseRuntime({ courseDef: course, theme, scene });
    expect(runtime.getColliders().length).toBe(0);
    const meshes = drawables(runtime.root);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every((m) => !(m instanceof THREE.InstancedMesh))).toBe(true);
    const box = new THREE.Box3().setFromObject(runtime.root);
    expect(box.max.y).toBeGreaterThan(course.finish.pos[1] + course.finish.half[1]);
  });
});
