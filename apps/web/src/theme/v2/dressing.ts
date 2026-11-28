// Obstacle dressing (#64). getDressing(kind, partIndex) returns a cached template (one merged
// geometry + material). The course runtime (#7) instantiates it on every matching part;
// until it does, createDressingLayer drives the same templates from the obstacle registry so the
// dressing follows moving parts exactly (same pose() call as the colliders). Colliders never change.
import * as THREE from 'three';
import { getObstacleKind } from '@wobble/shared';
import type { CourseDef, Dressing, MaterialSlot, PartDef, Pose } from '@wobble/shared/types';
import { shouldHideBase } from './coverage.ts';
import type { ResourceTracker } from './images.ts';
import { primsGeometry, primsMaterial } from './prims.ts';

export interface DressingTemplate {
  kind: string;
  part: number;
  /** In the part's local frame (part centre, part rotation, metres). */
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** What the theme asked for; use hidesBase(part) for the fairness-checked answer. */
  requestedHideBase: boolean;
  /** hideBase rule from #54: true only if requested and the prims cover >= 80% of the part. */
  hidesBase(part: Pick<PartDef, 'shape' | 'size'>): boolean;
}

/** Textured dressing keeps only a light tint of each prim colour: dark x dark texture turned floors black. */
const tint = new THREE.Color();
const WHITE = new THREE.Color('#ffffff');
const lightTint = (p: Dressing['prims'][number]) => ({
  ...p,
  color: `#${tint.set(p.color).lerp(WHITE, 0.7).getHexString()}`,
});

/** Draw dressing a hair in front of surfaces it touches, so a coplanar face never flickers against the base. */
function inFront<M extends THREE.Material>(material: M): M {
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  return material;
}

/**
 * `slotMaterial(slot)` is the theme's textured slot material: dressing with a `slot` draws its prims with that
 * texture, tinted by each prim's colour. Textures load late, so call sync() each frame to pick them up.
 */
export function createDressingTemplates(
  dressing: readonly Dressing[],
  tracker: ResourceTracker,
  slotMaterial: (slot: MaterialSlot) => THREE.Material | null = () => null,
) {
  const cache = new Map<string, DressingTemplate>();
  let flat: THREE.Material | null = null;
  const textured = new Map<MaterialSlot, { material: THREE.MeshStandardMaterial; source: THREE.Material | null }>();
  const materialFor = (slot: MaterialSlot | null | undefined): THREE.Material => {
    if (!slot) return (flat ??= tracker.track(inFront(primsMaterial())));
    let t = textured.get(slot);
    if (!t) textured.set(slot, (t = { material: tracker.track(inFront(primsMaterial())), source: slotMaterial(slot) }));
    return t.material;
  };
  const byKey = new Map(dressing.map((d) => [`${d.kind}|${d.part}`, d]));
  return {
    get(kind: string, partIndex: number): DressingTemplate | null {
      const key = `${kind}|${partIndex}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const d = byKey.get(key);
      if (!d) return null;
      const t: DressingTemplate = {
        kind,
        part: partIndex,
        geometry: tracker.track(primsGeometry(d.slot ? d.prims.map(lightTint) : d.prims)),
        material: materialFor(d.slot),
        requestedHideBase: d.hideBase,
        hidesBase: (part) => shouldHideBase(d, part),
      };
      cache.set(key, t);
      return t;
    },
    /** Copy late-loading slot textures onto textured dressing materials. Cheap; call once per frame. */
    sync() {
      for (const t of textured.values()) {
        const map = (t.source as THREE.MeshStandardMaterial | null)?.map ?? null;
        if (t.material.map !== map) {
          t.material.map = map;
          t.material.needsUpdate = true;
        }
      }
    },
  };
}

type GetDressing = (kind: string, partIndex: number) => DressingTemplate | null;

interface Driven {
  def: CourseDef['entities'][number];
  poses: Pose[];
  slots: { part: number; mesh: THREE.InstancedMesh; index: number }[];
}

/**
 * Instantiates dressing for every entity of the course and keeps it on its parts.
 * Call update(t) with the same render time as course.update(t).
 */
export function createDressingLayer({ getDressing, courseDef }: { getDressing: GetDressing; courseDef: CourseDef }) {
  const group = new THREE.Group();
  group.name = 'theme:dressing';
  const counts = new Map<DressingTemplate, number>();
  const plan: { def: Driven['def']; parts: PartDef[]; hits: { part: number; t: DressingTemplate }[] }[] = [];
  const hiddenBase: { entityId: number; part: number }[] = [];
  for (const def of courseDef.entities) {
    const kind = getObstacleKind(def.kind);
    if (!kind) continue;
    let parts: PartDef[];
    try {
      parts = kind.parts(def);
    } catch {
      continue;
    }
    const hits: { part: number; t: DressingTemplate }[] = [];
    parts.forEach((part, i) => {
      const t = getDressing(def.kind, i);
      if (!t) return;
      hits.push({ part: i, t });
      counts.set(t, (counts.get(t) ?? 0) + 1);
      if (t.hidesBase(part)) hiddenBase.push({ entityId: def.id, part: i });
    });
    if (hits.length) plan.push({ def, parts, hits });
  }
  const meshes = new Map<DressingTemplate, THREE.InstancedMesh>();
  for (const [t, n] of counts) {
    const mesh = new THREE.InstancedMesh(t.geometry, t.material, n);
    mesh.name = `dressing:${t.kind}:${t.part}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    meshes.set(t, mesh);
    group.add(mesh);
  }
  const driven: Driven[] = plan.map(({ def, parts, hits }) => ({
    def,
    poses: parts.map(() => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] })),
    slots: hits.map(({ part, t }) => {
      const mesh = meshes.get(t)!;
      return { part, mesh, index: mesh.count++ };
    }),
  }));
  const meshList = [...meshes.values()];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);

  function update(t: number) {
    for (let n = 0; n < driven.length; n++) {
      const d = driven[n];
      getObstacleKind(d.def.kind)!.pose(d.def, t, d.poses);
      for (let i = 0; i < d.slots.length; i++) {
        const slot = d.slots[i];
        const pose = d.poses[slot.part];
        p.set(pose.pos[0], pose.pos[1], pose.pos[2]);
        q.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
        slot.mesh.setMatrixAt(slot.index, m.compose(p, q, one));
      }
    }
    for (let i = 0; i < meshList.length; i++) meshList[i].instanceMatrix.needsUpdate = true;
  }
  update(0);
  return {
    group,
    /** Parts whose base mesh may be hidden under the #54 rule (the course runtime owns those meshes). */
    hiddenBase,
    update,
    dispose() {
      group.removeFromParent();
      for (const mesh of meshList) mesh.dispose();
      group.clear();
    },
  };
}
