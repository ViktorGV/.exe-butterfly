// Racer concepts: original kart-racer characters sculpted in code (blended shapes, meshed with Surface Nets),
// skinned to an 11-bone skeleton so they can be animated (anim.ts).
import * as THREE from 'three';
import { BONE_PARENT, BONES, boneIndex } from './bones.ts';
import { buildEyes, createBuilder } from './kit.ts';
import { racerMaterial } from './material.ts';
import { meshField } from './mesher.ts';
import type { P3 } from './sdf.ts';
import type { RacerDef } from './types.ts';
import { grizzle } from './cast/grizzle.ts';
import { kappi } from './cast/kappi.ts';
import { pip } from './cast/pip.ts';
import { spinny } from './cast/spinny.ts';
import { zara } from './cast/zara.ts';

export type { RacerDef } from './types.ts';

export const RACERS: readonly RacerDef[] = [pip, kappi, spinny, zara, grizzle];

export interface BuiltRacer {
  def: RacerDef;
  /** Placement: position and facing of the racer in the scene. */
  group: THREE.Group;
  /** Root motion inside the placement: hops, leans, dives, squash and stretch (pivot at the feet). */
  body: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  /** Rest position of each bone's joint, body-local. */
  rest: THREE.Vector3[];
  /** How far the belly (front, -Z) and the back (+Z) reach from the centre line: lying-down heights. */
  front: number;
  back: number;
  /** Half-width of the head and body (not the arms): the lying-on-the-side height. */
  side: number;
  height: number;
  triangles: number;
  ms: number;
}

/** Sculpt, mesh and rig one racer. Feet at the origin, facing -Z. `step` is the mesh grid size in metres. */
export function buildRacer(def: RacerDef, step = 0.0055): BuiltRacer {
  const t0 = performance.now();
  const b = createBuilder(def.mats);
  def.sculpt(b);
  const geo = meshField(b.field, b.mats, step);

  // Joints: the body ones from the racer's rig, arms and feet as the kit sculpted them.
  const joints: (P3 | undefined)[] = [...b.joints];
  joints[boneIndex('hips')] = [0, def.rig.hips, 0];
  joints[boneIndex('spine')] = [0, def.rig.spine, 0];
  joints[boneIndex('head')] = [0, def.rig.neck, 0];
  for (const s of [1, -1]) {
    joints[boneIndex('thigh', s)] = [s * def.rig.hip[0], def.rig.hip[1], 0];
    joints[boneIndex('foot', s)] ??= [s * def.rig.hip[0], 0.12, 0];
  }
  const rest = BONES.map((name, i) => {
    const j = joints[i];
    if (!j) throw new Error(`${def.id}: no joint for ${name}`);
    return new THREE.Vector3(...j);
  });
  const bones = BONES.map((name, i) => {
    const bone = new THREE.Bone();
    bone.name = name;
    const p = BONE_PARENT[i];
    bone.position.copy(rest[i]).sub(p < 0 ? new THREE.Vector3() : rest[p]);
    return bone;
  });
  bones.forEach((bone, i) => {
    const p = BONE_PARENT[i];
    if (p >= 0) bones[p].add(bone);
  });

  const mesh = new THREE.SkinnedMesh(geo, racerMaterial());
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false;

  // Eyes and extras move with the head.
  const head = bones[boneIndex('head')];
  const loose = new THREE.Group();
  buildEyes(b, loose);
  for (const make of b.extras) make(loose);
  for (const child of [...loose.children]) {
    child.position.sub(rest[boneIndex('head')]);
    head.add(child);
  }

  geo.computeBoundingBox();
  const box = geo.boundingBox ?? new THREE.Box3();
  // Widest point of the parts mostly moved by the hips, spine or head (the arms are posed out of the way).
  const pos = geo.getAttribute('position');
  const skin = geo.getAttribute('skinIndex');
  const core = new Set([boneIndex('hips'), boneIndex('spine'), boneIndex('head')]);
  let side = 0;
  for (let v = 0; v < pos.count; v++) if (core.has(skin.getX(v))) side = Math.max(side, Math.abs(pos.getX(v)));
  const body = new THREE.Group();
  body.add(mesh);
  const group = new THREE.Group();
  group.name = def.id;
  group.add(body);
  return {
    def,
    group,
    body,
    mesh,
    bones,
    rest,
    front: -box.min.z,
    back: box.max.z,
    side,
    height: box.max.y,
    triangles: (geo.index?.count ?? 0) / 3,
    ms: performance.now() - t0,
  };
}
