// Chain Reaction Desk: the course drawn as a giant creative desk set up as a butterfly-effect machine.
// Racers are tiny; every obstacle is a desk object (see pieces.ts). Visual only: it reads the same CourseDef
// and obstacle registry as the course runtime, so every piece sits exactly where its collider is.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getObstacleKind, periodOf } from '@wobble/shared';
import type { CourseDef, EntityDef, ObstacleKind, Pose } from '@wobble/shared/types';
import { disposeMaterials, setDeskPaint, syncDeskPaint, type DeskPaint } from './materials.ts';
export type { DeskPaint } from './materials.ts';
import { mergeStaticMeshes } from './merge.ts';
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

export interface DeskCourseOptions {
  courseDef: CourseDef;
  /** Event theme on the desk map: repaint every desk material in the theme (null = the school desk). */
  paint?: DeskPaint | null;
  /** Obstacle kinds drawn by the theme instead of a desk object (the desk skips their pieces and extras). */
  themedKind?: (kind: string) => boolean;
}

export function createDeskCourse({ courseDef, paint = null, themedKind = () => false }: DeskCourseOptions): DeskCourse {
  setDeskPaint(paint);
  const root = new THREE.Group();
  root.name = 'desk-course';
  const movers: Mover[] = [];
  const staticHolders: THREE.Object3D[] = [];

  for (const entity of courseDef.entities) {
    const kind = getObstacleKind(entity.kind);
    if (!kind || themedKind(entity.kind)) continue;
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
          staticHolders.push(holder);
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

  mergeStaticMeshes(root, staticHolders);
  const scenery = buildScenery(courseDef, root);
  // In a theme the giant school props and paper butterflies give way to the theme's landmarks and particles.
  // Book stacks and paperclip arches read as school however they are painted: the theme brings its own.
  if (paint) for (const o of [...scenery.props, ...scenery.school]) o.visible = false;
  setDeskPaint(null);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      // Flat decals (labels, notebook lines, clock faces) lie on a body that already casts the shadow: skip them
      // in the shadow pass, one draw call saved each.
      const type = (o as THREE.Mesh).geometry.type;
      o.castShadow = type !== 'PlaneGeometry' && type !== 'CircleGeometry';
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
      if (paint) syncDeskPaint();
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
