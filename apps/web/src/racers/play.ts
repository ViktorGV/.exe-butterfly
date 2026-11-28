// The racers as the game's player characters: the same full models as the demos (about 45k triangles each),
// driven by the game's animation states (`Anim`) instead of the demo loops. Implements the Wobbler contract
// (object3d, setPose, dispose) so the game, the crowd's near tier and the bots can use it in place of
// createWobbler.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Anim, BUTTERFLY } from '@wobble/shared/constants';
import {
  ARM,
  applyPose,
  dive,
  fallKeys,
  flail,
  getUp,
  idle,
  jump,
  keyed,
  mix,
  ramp,
  run,
  type Full,
  type Pose,
} from './anim.ts';
import { boneIndex } from './bones.ts';
import { RACERS, buildRacer, type BuiltRacer, type RacerDef } from './index.ts';

/** Mesh grid size for the game: the full racer, about 45k triangles. */
export const PLAY_STEP = 0.012;

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

/** The sculpted racer (built once, about 0.6 s each). */
export function racerTemplate(def: RacerDef): BuiltRacer {
  let t = templates.get(def.id);
  if (!t) {
    t = buildRacer(def, PLAY_STEP);
    templates.set(def.id, t);
  }
  return t;
}

/** Build every racer up front (at load), so no player appearing later causes a hitch. */
export function prepareRacers(defs: readonly RacerDef[] = RACERS): void {
  for (const d of defs) racerTemplate(d);
}

/** A posable copy of a racer: own bones, shared geometry and materials. */
export function instantiateRacer(def: RacerDef): BuiltRacer {
  const t = racerTemplate(def);
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

// ---- the game's states as racer poses -----------------------------------------------------------------

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const RUN_CYCLE = 0.44;

const STUMBLE: [number, Pose][] = [
  [0, {}],
  [
    0.12,
    {
      pitch: -0.3,
      spine: [-0.2, 0, 0],
      head: [0.35, 0, 0],
      arms: { u: [0.5, 0.3, 0.8], f: [0.4, 0.5, 0.75] },
      legR: [0.6, 0.3, 0.05],
      legL: [-0.4, 0.5, 0.05],
    },
  ],
  [0.35, { pitch: -0.4, head: [0.2, 0, 0], arms: ARM.outUp, legR: [-0.4, 0.6, 0.05], legL: [0.6, 0.3, 0.05] }],
  [0.65, { pitch: -0.15, arms: ARM.out, legR: [0.3, 0.3, 0.05], legL: [-0.2, 0.3, 0.05] }],
  [1, {}],
];

const CHEER: [number, Pose][] = [
  [0, { squash: 0.1, arms: ARM.out }],
  [0.25, { y: 0.25, squash: -0.1, arms: ARM.up, legs: [0.4, 0.8, 0.1] }],
  [0.5, { squash: 0.12, arms: ARM.outUp }],
  [0.7, { squash: 0.1, arms: ARM.out }],
];

const GRAB: [number, Pose][] = [
  [0, {}],
  [
    0.15,
    {
      pitch: -0.2,
      spine: [-0.15, 0, 0],
      head: [0.15, 0, 0],
      arms: ARM.fwd,
      legR: [0.35, 0.3, 0.05],
      legL: [-0.2, 0.3, 0.05],
    },
  ],
];

interface PlayClock {
  /** Seconds in the current state. */
  s: number;
  /** Seconds since the racer was made (idle sway, flailing). */
  clock: number;
  /** Run cycle time, advanced by speed. */
  runT: number;
}

/** The pose for game state `anim` at the given clocks. Root offsets along the ground are left out. */
export function playPose(r: BuiltRacer, anim: number, c: PlayClock, speed: number): Full {
  const { s, clock } = c;
  switch (anim) {
    case Anim.RUN: {
      const p = run.pose(r, c.runT % RUN_CYCLE, 'actor');
      const w = clamp01((speed - 0.4) / 1.6);
      return w >= 1 ? p : mix(idle.pose(r, clock % idle.length, 'actor'), p, w);
    }
    case Anim.JUMP: {
      const p = jump.pose(r, 0.32 + Math.min(s, 0.6) * 0.47, 'actor');
      p.y = 0;
      return p;
    }
    case Anim.FALL: {
      const p = jump.pose(r, 0.75, 'actor');
      p.y = 0;
      return flail(p, clock, 0.9);
    }
    case Anim.DIVE:
      return dive.pose(r, 0.32 + clamp01(s / 0.25) * 0.2, 'actor');
    case Anim.PRONE: {
      const p = dive.pose(r, 1.0, 'actor');
      return flail(p, clock, 0.35);
    }
    case Anim.STUMBLE:
      return flail(
        keyed(Math.min(s / (BUTTERFLY.STUMBLE_MS / 1000), 1), STUMBLE),
        clock,
        ramp(s, 0.05, 0.15, 0.5, 0.8) * 0.6,
      );
    case Anim.CELEBRATE:
      return keyed(s % 0.7, CHEER);
    case Anim.GRAB:
      return keyed(Math.min(s, 0.15), GRAB);
    case Anim.KNOCKED: {
      const p = keyed(0.1 + Math.min(s, 0.62), fallKeys(r, 0.1));
      return flail(p, clock, ramp(s, 0.5, 0.7, 1.0, 1.2));
    }
    case Anim.GETUP:
      return getUp.pose(r, 0.25 + clamp01(s / (BUTTERFLY.GETUP_MS / 1000)) * 1.75, 'actor');
    default:
      return idle.pose(r, clock % idle.length, 'actor');
  }
}

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

export interface RacerWobbler {
  readonly object3d: THREE.Group;
  readonly racer: RacerDef;
  setPose(pose: RacerWobblerPose, dt: number): void;
  dispose(): void;
}

/** How fast the visual yaw catches up with the target (1/s), as for the Wobbler. */
const TURN_RATE = 16;
/** Cross-fade between states (s). */
const FADE = 0.15;

function wrapPi(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** A player character: the racer for `skin`, posed from the game's state every frame. */
export function createRacerWobbler(skin: unknown): RacerWobbler {
  const def = racerForSkin(skin);
  const r = instantiateRacer(def);
  const root = r.group;
  root.name = `racer:${def.id}`;
  const c: PlayClock = { s: 0, clock: 0, runT: 0 };
  let anim = -1;
  let yaw = 0;
  let first = true;
  let from: Full | null = null;
  let last: Full | null = null;
  let fade = 1;

  return {
    object3d: root,
    racer: def,
    setPose(pose, dt) {
      root.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
      if (first) yaw = pose.yaw;
      else yaw += wrapPi(pose.yaw - yaw) * Math.min(1, TURN_RATE * dt);
      root.rotation.y = yaw;
      if (pose.anim !== anim) {
        if (!first && last) {
          from = last;
          fade = 0;
        }
        anim = pose.anim;
        c.s = 0;
      }
      first = false;
      c.s += dt;
      c.clock += dt;
      if (anim === Anim.RUN) c.runT += dt * Math.min(1.3, Math.max(0.35, pose.speed / 7.5));
      let p = playPose(r, anim, c, pose.speed);
      if (fade < 1 && from) {
        fade = Math.min(1, fade + dt / FADE);
        p = mix(from, p, fade * fade * (3 - 2 * fade));
      }
      last = p;
      applyPlayPose(r, { ...p });
    },
    dispose() {
      root.removeFromParent();
    },
  };
}
