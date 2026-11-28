// The racers as the game's player characters: the same full models as the demos (about 45k triangles each),
// driven by the game's animation states (`Anim`) instead of the demo loops. Implements the Wobbler contract
// (object3d, setPose, dispose) so the game, the crowd's near tier and the bots can use it in place of
// createWobbler.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyPose, type Full } from './anim.ts';
import { createPlayAnimator } from './playAnim.ts';
import { boneIndex } from './bones.ts';
import { createGunModel } from '../gun/model.ts';
import type { GunKind } from '@wobble/shared/types';
import { bakedGeometry, bakedReady } from './baked.ts';
import { RACERS, buildRacer, type BuiltRacer, type RacerDef } from './index.ts';

/** Mesh grid size for the game: the full racer, about 45k triangles. */
export const PLAY_STEP = 0.012;
/** Mesh grid size for other players near the camera: about a quarter of the triangles, built on first use. */
export const NEAR_STEP = 0.022;

// ---- which racer a skin plays as ------------------------------------------------------------------------

/** The built-in skins, each played as one of the five racers (by colour, roughly). */
const BY_SKIN_NAME: Readonly<Record<string, string>> = {
  'Sunny Bean': 'zara',
  'Lemon Drop': 'zara',
  'Mint Zap': 'pip',
  'Comet Kid': 'pip',
  'Grape Fizz': 'kappi',
  'Berry Knight': 'kappi',
  'Cocoa Cub': 'kappi',
  'Coral Dash': 'grizzle',
  'Lava Jogger': 'grizzle',
  'Tide Pop': 'spinny',
  'Frost Puff': 'spinny',
  'Plain Jelly': 'spinny',
};

const racerById = new Map(RACERS.map((d) => [d.id, d]));

/** The racer a skin plays as: built-in skins by name, any other skin by a hash of its name (same for everyone). */
export function racerForSkin(skin: unknown): RacerDef {
  const name = typeof skin === 'object' && skin !== null ? String((skin as { name?: unknown }).name ?? '') : '';
  const byName = racerById.get(BY_SKIN_NAME[name] ?? '');
  if (byName) return byName;
  if (racerById.has(name.toLowerCase())) return racerById.get(name.toLowerCase())!;
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return RACERS[(h >>> 0) % RACERS.length];
}

// ---- one sculpt per racer, shared by every player who plays it ---------------------------------------------

const templates = new Map<string, BuiltRacer>();

/** The sculpted racer (built once per grid size, about 0.6 s each at full detail). */
export function racerTemplate(def: RacerDef, step = PLAY_STEP): BuiltRacer {
  const key = `${def.id}:${step}`;
  let t = templates.get(key);
  if (!t) {
    t = buildRacer(def, step, bakedGeometry(def.id, step));
    templates.set(key, t);
  }
  return t;
}

/** Build every racer up front (at load), so no player appearing later causes a hitch. */
export function prepareRacers(defs: readonly RacerDef[] = RACERS): void {
  for (const d of defs) racerTemplate(d);
  for (const d of defs) racerTemplate(d, NEAR_STEP);
}

/**
 * Like prepareRacers, but one racer per idle slot, so the first screen is not held up.
 * A racer needed sooner is built on demand by racerTemplate.
 */
export function prepareRacersLater(defs: readonly RacerDef[] = RACERS): void {
  // Full detail first (the local player), then the coarse near-tier copies, so no racer is sculpted mid-race.
  const queue: [RacerDef, number][] = [...defs.map((d) => [d, PLAY_STEP] as [RacerDef, number])];
  for (const d of defs) queue.push([d, NEAR_STEP]);
  const idle = (fn: () => void) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 1000 });
    else setTimeout(fn, 50);
  };
  const next = () => {
    const item = queue.shift();
    if (!item) return;
    racerTemplate(item[0], item[1]);
    idle(next);
  };
  // Wait for the baked meshes (if they are loading), so the queue doesn't sculpt what is about to arrive.
  void bakedReady().then(() => idle(next));
}

/** A posable copy of a racer: own bones, shared geometry and materials. */
export function instantiateRacer(def: RacerDef, step = PLAY_STEP): BuiltRacer {
  const t = racerTemplate(def, step);
  const group = cloneSkinned(t.group) as THREE.Group;
  const body = group.children[0] as THREE.Group;
  let mesh: THREE.SkinnedMesh | null = null;
  group.traverse((o) => {
    if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh) throw new Error(`${def.id}: no skinned mesh`);
  const m: THREE.SkinnedMesh = mesh;
  m.frustumCulled = false;
  return { ...t, group, body, mesh: m, bones: m.skeleton.bones };
}

// ---- applying the game's poses ----------------------------------------------------------------------

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const pivot = new THREE.Vector3();

/**
 * Apply a game pose. Leans, dives and falls tip around the waist (not the feet), so a racer lying down lies
 * where the player is; lying poses rest on the belly, back or side.
 */
export function applyPlayPose(r: BuiltRacer, p: Full): void {
  const lift = p.y;
  p.x = 0;
  p.z = 0;
  applyPose(r, p);
  const h = r.rest[boneIndex('spine')].y;
  const wp = clamp01(Math.abs(p.pitch) / 1.5);
  const wr = clamp01(Math.abs(p.roll) / 1.5);
  const w = Math.max(wp, wr);
  const rest = wr > wp ? r.side : p.pitch < 0 ? r.front : r.back;
  pivot.set(0, h, 0).applyEuler(r.body.rotation);
  r.body.position.set(-pivot.x, h - pivot.y + (rest - h) * w + lift * (1 - w), -pivot.z);
}

// ---- the Wobbler contract ------------------------------------------------------------------------------

export interface RacerWobblerPose {
  pos: ArrayLike<number>;
  yaw: number;
  anim: number;
  speed: number;
}

export {
  CELEBRATIONS,
  CELEBRATION_COUNT,
  celebratePose,
  createPlayAnimator,
  newPose,
  type PlayAnimator,
} from './playAnim.ts';

export interface RacerWobbler {
  readonly object3d: THREE.Group;
  readonly racer: RacerDef;
  setPose(pose: RacerWobblerPose, dt: number): void;
  /** Show the gun of this kind in the right hand, or hide it (null). */
  setGun(kind: GunKind | null): void;
  /** Recoil: the gun kicks up and back, harder for bigger guns (0..1), then settles. */
  kick(strength: number): void;
  /** Which celebration (an index into CELEBRATIONS) plays the next time the racer enters CELEBRATE. */
  setCelebration(variant: number): void;
  dispose(): void;
}

/** How fast the visual yaw catches up with the target (1/s), as for the Wobbler. */
const TURN_RATE = 16;

function wrapPi(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** A player character: the racer for `skin`, posed from the game's state every frame. */
export function createRacerWobbler(skin: unknown, step = PLAY_STEP): RacerWobbler {
  const def = racerForSkin(skin);
  const r = instantiateRacer(def, step);
  const root = r.group;
  root.name = `racer:${def.id}`;
  const animator = createPlayAnimator(r);
  let yaw = 0;
  let first = true;
  let gun: THREE.Group | null = null;
  let gunKind: GunKind | null = null;
  const gunRest = new THREE.Vector3();
  let recoil = 0;

  return {
    object3d: root,
    racer: def,
    setPose(pose, dt) {
      root.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
      if (gun && recoil > 0) {
        recoil = Math.max(0, recoil - dt * 4);
        const k = recoil * recoil;
        gun.rotation.x = k * 0.9; // muzzle up
        gun.position.copy(gunRest);
        gun.position.z += k * r.height * 0.12; // and back into the hand
      }
      if (first) yaw = pose.yaw;
      else yaw += wrapPi(pose.yaw - yaw) * Math.min(1, TURN_RATE * dt);
      root.rotation.y = yaw;
      first = false;
      applyPlayPose(r, animator.update(pose.anim, pose.speed, dt));
    },
    setCelebration(variant) {
      animator.celebration = variant;
    },
    setGun(kind) {
      if (kind && kind !== gunKind) {
        gun?.removeFromParent();
        gun = null;
      }
      if (kind) gunKind = kind;
      if (kind && !gun) {
        // in the right hand: the wrist sits about one forearm (elbow - shoulder) past the elbow
        const fore = boneIndex('foreArm', 1);
        const upper = boneIndex('upperArm', 1);
        gun = createGunModel(r.height * 0.3, kind);
        gun.position.copy(r.rest[fore]!).sub(r.rest[upper]!).multiplyScalar(0.95);
        // held a little out from the side so it reads from the camera behind the racer
        gun.position.x += r.height * 0.04;
        r.bones[fore]!.add(gun);
        gunRest.copy(gun.position);
      }
      if (gun) gun.visible = kind !== null;
    },
    kick(strength) {
      recoil = Math.max(recoil, Math.min(1, strength));
    },
    dispose() {
      gun?.removeFromParent();
      root.removeFromParent();
    },
  };
}

/** Other players drawn near the camera: the same racer from a coarser mesh. */
export const createNearRacerWobbler = (skin: unknown): RacerWobbler => createRacerWobbler(skin, NEAR_STEP);
