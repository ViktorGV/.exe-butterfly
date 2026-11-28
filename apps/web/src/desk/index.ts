// Chain Reaction Desk: the course drawn as a giant creative desk set up as a butterfly-effect machine.
// Racers are tiny; every obstacle is a desk object (see pieces.ts). Visual only: it reads the same CourseDef
// and obstacle registry as the course runtime, so every piece sits exactly where its collider is.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getObstacleKind, periodOf } from '@wobble/shared';
import type { CourseDef, EntityDef, ObstacleKind, Pose } from '@wobble/shared/types';
import { disposeMaterials } from './materials.ts';
import { buildEntityExtras, buildPiece } from './pieces.ts';
import { buildScenery } from './scenery.ts';

export interface DeskCourse {
  root: THREE.Group;
  /** The window sun; move its target near the camera so shadows stay sharp where you look. */
  sun: THREE.DirectionalLight;
  /** Pose every moving obstacle for race time t (seconds) and animate the scenery. */
  update(t: number): void;
  dispose(): void;
}

interface Mover {
  kind: ObstacleKind;
  entity: EntityDef;
  poses: Pose[];
  holders: (THREE.Object3D | null)[];
}

function applyPose(o: THREE.Object3D, p: Pose): void {
  o.position.set(p.pos[0], p.pos[1], p.pos[2]);
  o.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
}

/**
 * The room around the desk: warm wall colour, fog, and a soft room for chrome and brass to reflect. Call after
 * any theme has set its own background, so the desk's wins.
 */
export function applyDeskAtmosphere(scene: THREE.Scene, renderer: THREE.WebGLRenderer): () => void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.background = new THREE.Color('#f1d4ae');
  scene.fog = new THREE.Fog('#f1d4ae', 140, 560);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.6;
  return () => {
    if (scene.environment === env.texture) scene.environment = null;
    env.dispose();
    pmrem.dispose();
  };
}

export function createDeskCourse({ courseDef }: { courseDef: CourseDef }): DeskCourse {
  const root = new THREE.Group();
  root.name = 'desk-course';
  const movers: Mover[] = [];

  for (const entity of courseDef.entities) {
    const kind = getObstacleKind(entity.kind);
    if (!kind) continue;
    try {
      const parts = kind.parts(entity);
      const poses: Pose[] = parts.map(() => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
      kind.pose(entity, 0, poses);
      const poses0 = poses.map((p) => ({ pos: [...p.pos], quat: [...p.quat] }) as Pose);
      const moving = periodOf(entity) > 0;
      const holders = parts.map((part, index) => {
        const piece = buildPiece({ entity, part, index, parts, poses0 });
        if (!piece) return null;
        const holder = new THREE.Group();
        holder.add(piece);
        applyPose(holder, poses0[index]);
        if (!moving) {
          holder.updateMatrix();
          holder.matrixAutoUpdate = false;
        }
        root.add(holder);
        return holder;
      });
      if (moving) movers.push({ kind, entity, poses, holders });
      for (const extra of buildEntityExtras(entity)) root.add(extra);
    } catch (err) {
      console.warn(`desk: skipped ${entity.kind} #${entity.id}`, err);
    }
  }

  const scenery = buildScenery(courseDef, root);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return {
    root,
    sun: scenery.sun,
    update(t) {
      for (const m of movers) {
        m.kind.pose(m.entity, t, m.poses);
        for (let i = 0; i < m.holders.length; i++) {
          const h = m.holders[i];
          if (h) applyPose(h, m.poses[i]);
        }
      }
      scenery.update(t);
    },
    dispose() {
      root.removeFromParent();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      disposeMaterials();
    },
  };
}
