// The Wobbler (#8): the player character, built from a SkinDef and animated procedurally.
//
//   const w = createWobbler(skin);
//   scene.add(w.object3d);
//   engine.onRender((_a, frameDt) => w.setPose(player.state, frameDt)); // { pos, yaw, anim, speed }
//   w.dispose();
//
// Draw calls: body (pattern texture), details (belly, face, accessories; vertex colours), limbs (one
// InstancedMesh of 4), and glowing accessory prims only when the skin has emissive prims.
import * as THREE from 'three';
import { Animator, CH } from './animation.ts';
import {
  acquireSkin,
  sharedBodyGeometry,
  sharedDetailMaterial,
  sharedGlowMaterial,
  sharedLimbGeometry,
} from './cache.ts';
import { LIMB_COUNT, composeLimb } from './parts.ts';
import { PIVOT_Y } from './shape.ts';
import { normalizeSkin, type WobblerParams } from './skin.ts';

export interface WobblerPose {
  /** Feet position (capsule bottom centre), metres. */
  pos: ArrayLike<number>;
  /** Facing; 0 faces -Z, positive turns left. */
  yaw: number;
  /** An `Anim` value. */
  anim: number;
  /** Horizontal speed, m/s (drives the run cycle). */
  speed: number;
}

export interface Wobbler {
  readonly object3d: THREE.Group;
  /** The normalised skin this Wobbler was built from. */
  readonly params: WobblerParams;
  setPose(pose: WobblerPose, dt: number): void;
  dispose(): void;
}

/** How fast the visual yaw catches up with the target (1/s). */
export const TURN_RATE = 16;
const LIMB_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, PIVOT_Y, 0), 1.2);
const _m = new THREE.Matrix4();

function wrapPi(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Build a Wobbler. Never throws on a bad skin: invalid fields use defaults. */
export function createWobbler(skin: unknown): Wobbler {
  const params = normalizeSkin(skin);
  const res = acquireSkin(params);

  const root = new THREE.Group();
  root.name = `wobbler:${params.name}`;
  const pivot = new THREE.Group();
  pivot.rotation.order = 'YXZ';
  pivot.position.y = PIVOT_Y;
  const squash = new THREE.Group();
  squash.position.y = -PIVOT_Y;
  root.add(pivot);
  pivot.add(squash);

  const body = new THREE.Mesh(sharedBodyGeometry(), res.bodyMaterial);
  body.castShadow = true;
  const detail = new THREE.Mesh(res.detail.detail, sharedDetailMaterial());
  const limbs = new THREE.InstancedMesh(sharedLimbGeometry(), res.limbMaterial, LIMB_COUNT);
  limbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  limbs.castShadow = true;
  limbs.boundingSphere = LIMB_BOUNDS;
  squash.add(body, detail, limbs);
  if (res.detail.glow) squash.add(new THREE.Mesh(res.detail.glow, sharedGlowMaterial()));

  const animator = new Animator();
  const { height, girth } = params.body;
  let yaw = 0;
  let posed = false;
  let disposed = false;

  function apply(p: Float32Array): void {
    const s = Math.max(0.5, p[CH.squash]);
    const side = girth / Math.sqrt(s);
    squash.scale.set(side, height * s, side);
    pivot.position.y = PIVOT_Y + p[CH.lift];
    pivot.rotation.set(p[CH.pitch], p[CH.twist], p[CH.roll]);
    limbs.setMatrixAt(0, composeLimb(_m, 0, p[CH.armLSwing], p[CH.armLRaise]));
    limbs.setMatrixAt(1, composeLimb(_m, 1, p[CH.armRSwing], p[CH.armRRaise]));
    limbs.setMatrixAt(2, composeLimb(_m, 2, p[CH.legLSwing], p[CH.legLRaise]));
    limbs.setMatrixAt(3, composeLimb(_m, 3, p[CH.legRSwing], p[CH.legRRaise]));
    limbs.instanceMatrix.needsUpdate = true;
  }

  apply(animator.update(0, 0, 0));

  return {
    object3d: root,
    params,
    setPose(pose, dt) {
      if (disposed) return;
      const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
      const pos = pose.pos;
      if (pos && Number.isFinite(pos[0]) && Number.isFinite(pos[1]) && Number.isFinite(pos[2])) {
        root.position.set(pos[0], pos[1], pos[2]);
      }
      if (Number.isFinite(pose.yaw)) {
        if (!posed) yaw = pose.yaw;
        else yaw += wrapPi(pose.yaw - yaw) * (1 - Math.exp(-TURN_RATE * step));
        yaw = wrapPi(yaw);
        posed = true;
      }
      root.rotation.y = yaw;
      apply(animator.update(pose.anim, pose.speed, step));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      limbs.dispose();
      res.release();
    },
  };
}
