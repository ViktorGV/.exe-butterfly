// Party-game actions for the racers: idle, run, jump, dive, fall over, push another racer and help a fallen one up.
// Each action is a loop of key poses (eased between) plus procedural motion (run cycle, flailing). Pair actions
// give a pose for both roles: the actor and the partner.
//
// Directions: the racer faces -Z, its right is +X. Root pitch < 0 leans forward; legs swing > 0 forward;
// arm directions are given for the right arm in the spine's space and mirrored for the left.
import * as THREE from 'three';
import { boneIndex } from './bones.ts';
import type { BuiltRacer } from './index.ts';

type V3 = [number, number, number];
/** Upper-arm and forearm directions (right side). */
interface Arm {
  u: V3;
  f: V3;
}
/** [swing forward, knee bend, spread outward]. */
type Leg = V3;

export interface Pose {
  x?: number;
  y?: number;
  z?: number;
  pitch?: number;
  roll?: number;
  yaw?: number;
  /** > 0 squashes, < 0 stretches (volume is kept). */
  squash?: number;
  hips?: V3;
  spine?: V3;
  head?: V3;
  arms?: Arm;
  armR?: Arm;
  armL?: Arm;
  legs?: Leg;
  legR?: Leg;
  legL?: Leg;
}

interface Full {
  x: number;
  y: number;
  z: number;
  pitch: number;
  roll: number;
  yaw: number;
  squash: number;
  hips: V3;
  spine: V3;
  head: V3;
  armR: Arm;
  armL: Arm;
  legR: Leg;
  legL: Leg;
}

// ---- arm presets (right arm) ----------------------------------------------------------------------------

export const ARM = {
  rest: { u: [0.5, -0.86, 0], f: [0.42, -0.86, -0.25] },
  up: { u: [0.3, 0.95, -0.05], f: [0.15, 1, -0.15] },
  out: { u: [1, 0.15, -0.05], f: [0.95, 0.35, -0.15] },
  outUp: { u: [0.8, 0.6, -0.1], f: [0.6, 0.85, -0.2] },
  fwd: { u: [0.22, 0.02, -1], f: [0.12, 0.06, -1] },
  back: { u: [0.4, -0.55, 0.75], f: [0.3, -0.75, 0.6] },
  windup: { u: [0.45, -0.5, 0.75], f: [0.25, 0.15, -0.95] },
  reach: { u: [0.16, -0.42, -0.9], f: [0.1, -0.5, -0.86] },
  superman: { u: [0.5, 0.82, -0.2], f: [0.38, 0.9, -0.2] },
  push: { u: [0.3, -0.85, -0.45], f: [0.2, -0.95, -0.25] },
} satisfies Record<string, Arm>;

const NEUTRAL: Full = {
  x: 0,
  y: 0,
  z: 0,
  pitch: 0,
  roll: 0,
  yaw: 0,
  squash: 0,
  hips: [0, 0, 0],
  spine: [0, 0, 0],
  head: [0, 0, 0],
  armR: ARM.rest,
  armL: ARM.rest,
  legR: [0, 0.05, 0],
  legL: [0, 0.05, 0],
};

function full(p: Pose): Full {
  return {
    x: p.x ?? 0,
    y: p.y ?? 0,
    z: p.z ?? 0,
    pitch: p.pitch ?? 0,
    roll: p.roll ?? 0,
    yaw: p.yaw ?? 0,
    squash: p.squash ?? 0,
    hips: p.hips ?? NEUTRAL.hips,
    spine: p.spine ?? NEUTRAL.spine,
    head: p.head ?? NEUTRAL.head,
    armR: p.armR ?? p.arms ?? NEUTRAL.armR,
    armL: p.armL ?? p.arms ?? NEUTRAL.armL,
    legR: p.legR ?? p.legs ?? NEUTRAL.legR,
    legL: p.legL ?? p.legs ?? NEUTRAL.legL,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const lerpArm = (a: Arm, b: Arm, t: number): Arm => ({ u: lerp3(a.u, b.u, t), f: lerp3(a.f, b.f, t) });
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** 0 outside [a, d], 1 inside [b, c], eased ramps between. */
const ramp = (t: number, a: number, b: number, c: number, d: number) =>
  smooth(clamp01((t - a) / (b - a))) * (1 - smooth(clamp01((t - c) / (d - c))));

function mix(a: Full, b: Full, t: number): Full {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    pitch: lerp(a.pitch, b.pitch, t),
    roll: lerp(a.roll, b.roll, t),
    yaw: lerp(a.yaw, b.yaw, t),
    squash: lerp(a.squash, b.squash, t),
    hips: lerp3(a.hips, b.hips, t),
    spine: lerp3(a.spine, b.spine, t),
    head: lerp3(a.head, b.head, t),
    armR: lerpArm(a.armR, b.armR, t),
    armL: lerpArm(a.armL, b.armL, t),
    legR: lerp3(a.legR, b.legR, t),
    legL: lerp3(a.legL, b.legL, t),
  };
}

/** Pose at time t from keys [time, pose] (sorted, first at 0); eased between keys. */
function keyed(t: number, keys: [number, Pose][]): Full {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1][0] <= t) i++;
  const [ta, pa] = keys[i];
  const next = keys[Math.min(i + 1, keys.length - 1)];
  const span = next[0] - ta;
  const u = span > 0 ? smooth(clamp01((t - ta) / span)) : 0;
  return mix(full(pa), full(next[1]), u);
}

// ---- applying a pose ------------------------------------------------------------------------------------

const euler = new THREE.Euler();
const qa = new THREE.Quaternion();
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const restDir = new THREE.Vector3();

function setEuler(bone: THREE.Bone, e: V3): void {
  bone.quaternion.setFromEuler(euler.set(e[0], e[1], e[2], 'XYZ'));
}

function aimArm(r: BuiltRacer, side: number, arm: Arm): void {
  const upper = r.bones[boneIndex('upperArm', side)];
  const fore = r.bones[boneIndex('foreArm', side)];
  restDir.copy(r.rest[boneIndex('foreArm', side)]).sub(r.rest[boneIndex('upperArm', side)]).normalize();
  va.set(arm.u[0] * side, arm.u[1], arm.u[2]).normalize();
  upper.quaternion.setFromUnitVectors(restDir, va);
  vb.set(arm.f[0] * side, arm.f[1], arm.f[2]).normalize();
  vb.applyQuaternion(qa.copy(upper.quaternion).invert());
  fore.quaternion.setFromUnitVectors(restDir, vb);
}

function setLeg(r: BuiltRacer, side: number, leg: Leg): void {
  setEuler(r.bones[boneIndex('thigh', side)], [leg[0], 0, side * leg[2]]);
  setEuler(r.bones[boneIndex('foot', side)], [-leg[1], 0, 0]);
}

export function applyPose(r: BuiltRacer, p: Full): void {
  r.body.position.set(p.x, p.y, p.z);
  r.body.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ');
  const sy = 1 - p.squash;
  const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
  r.body.scale.set(sxz, sy, sxz);
  setEuler(r.bones[boneIndex('hips')], p.hips);
  setEuler(r.bones[boneIndex('spine')], p.spine);
  setEuler(r.bones[boneIndex('head')], p.head);
  aimArm(r, 1, p.armR);
  aimArm(r, -1, p.armL);
  setLeg(r, 1, p.legR);
  setLeg(r, -1, p.legL);
}

// ---- actions --------------------------------------------------------------------------------------------

export type Role = 'actor' | 'partner';

export interface Action {
  id: string;
  label: string;
  /** Loop length in seconds. */
  length: number;
  /** True when a second racer takes part (push, help up). */
  pair: boolean;
  pose(r: BuiltRacer, t: number, role: Role): Full;
}

/** Swing an arm direction forward (+) or back (-) around the shoulder's side axis. */
function swing(d: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [d[0], d[1] * c + d[2] * s, d[2] * c - d[1] * s];
}

/** Waving arms and kicking legs, added on top of a pose with weight w. */
function flail(p: Full, t: number, w: number): Full {
  if (w <= 0) return p;
  const k = (f: number, ph: number) => Math.sin(t * f + ph) * w;
  return {
    ...p,
    armR: { u: swing(p.armR.u, 0.7 * k(13, 0)), f: swing(p.armR.f, 0.9 * k(13, 0.8)) },
    armL: { u: swing(p.armL.u, 0.7 * k(11, 2)), f: swing(p.armL.f, 0.9 * k(11, 2.6)) },
    legR: [p.legR[0] + 0.35 * k(15, 0), p.legR[1] + 0.3 * Math.abs(k(15, 1)), p.legR[2]],
    legL: [p.legL[0] + 0.35 * k(15, Math.PI), p.legL[1] + 0.3 * Math.abs(k(15, 2)), p.legL[2]],
    head: [p.head[0], p.head[1] + 0.25 * k(7, 0), p.head[2]],
  };
}

const idle: Action = {
  id: 'idle',
  label: 'Idle',
  length: 3,
  pair: false,
  pose(_r, t) {
    const b = Math.sin((t / 3) * Math.PI * 2);
    return full({
      squash: 0.02 * b,
      spine: [0.02 * b, 0, 0],
      head: [0, 0.12 * Math.sin((t / 3) * Math.PI * 2 + 1), 0.04 * b],
      armR: { u: swing(ARM.rest.u, 0.06 * b), f: swing(ARM.rest.f, 0.1 * b) },
      armL: { u: swing(ARM.rest.u, -0.06 * b), f: swing(ARM.rest.f, -0.1 * b) },
    });
  },
};

const run: Action = {
  id: 'run',
  label: 'Run',
  length: 0.44,
  pair: false,
  pose(_r, t) {
    const p = (t / 0.44) * Math.PI * 2;
    const s = Math.sin(p);
    const c = Math.cos(p);
    // a > 0 swings the arm forward and the elbow stays bent forward (swing() turns positive angles backward).
    const armSwing = (a: number): Arm => ({
      u: swing([0.35, -0.94, 0], -a),
      f: swing([0.3, -0.95, 0], -(a + 1.4)),
    });
    return full({
      y: 0.05 * Math.abs(s),
      pitch: -0.2,
      roll: 0.07 * s,
      yaw: 0.08 * s,
      squash: 0.05 * Math.cos(2 * p),
      hips: [0, -0.12 * s, 0],
      spine: [-0.08, 0.2 * s, 0],
      head: [0.2, -0.15 * s, 0.04 * s],
      legR: [0.8 * s, 0.1 + 0.9 * Math.max(0, c), 0.05],
      legL: [-0.8 * s, 0.1 + 0.9 * Math.max(0, -c), 0.05],
      armR: armSwing(-0.9 * s),
      armL: armSwing(0.9 * s),
    });
  },
};

const jump: Action = {
  id: 'jump',
  label: 'Jump',
  length: 1.5,
  pair: false,
  pose(_r, t) {
    const p = keyed(t, [
      [0, {}],
      [
        0.22,
        { squash: 0.2, pitch: -0.15, spine: [-0.25, 0, 0], head: [0.3, 0, 0], arms: ARM.back, legs: [0.55, 1, 0.08] },
      ],
      [
        0.32,
        { squash: -0.18, pitch: 0.05, spine: [0.1, 0, 0], head: [-0.15, 0, 0], arms: ARM.up, legs: [-0.15, 0.1, 0] },
      ],
      [0.6, { spine: [-0.1, 0, 0], head: [0.1, 0, 0], arms: ARM.out, legs: [0.8, 1.3, 0.12] }],
      [0.86, { arms: ARM.outUp, legs: [0.2, 0.3, 0.1] }],
      [
        0.92,
        {
          squash: 0.25,
          spine: [-0.2, 0, 0],
          arms: { u: [0.95, -0.2, -0.1], f: [0.9, -0.1, -0.3] },
          legs: [0.5, 1, 0.1],
        },
      ],
      [1.06, { squash: -0.06 }],
      [1.5, {}],
    ]);
    const u = (t - 0.28) / 0.64;
    p.y = u > 0 && u < 1 ? 4 * 0.55 * u * (1 - u) : 0;
    return p;
  },
};

const dive: Action = {
  id: 'dive',
  label: 'Dive',
  length: 2.6,
  pair: false,
  pose(r, t) {
    const F = r.front;
    return keyed(t, [
      [0, {}],
      [0.18, { squash: 0.15, pitch: -0.25, spine: [-0.2, 0, 0], arms: ARM.back, legs: [0.4, 0.8, 0.05] }],
      [
        0.32,
        { y: 0.22, z: -0.2, pitch: -0.8, squash: -0.12, head: [-0.5, 0, 0], arms: ARM.superman, legs: [-0.3, 0.2, 0] },
      ],
      [0.52, { y: F + 0.14, z: -0.45, pitch: -1.45, head: [-0.6, 0, 0], arms: ARM.superman, legs: [-0.25, 0.1, 0.1] }],
      [0.64, { y: F * 0.85, z: -0.55, pitch: -1.57, head: [-0.7, 0, 0], arms: ARM.superman, legs: [-0.2, 0.2, 0.12] }],
      [1.0, { y: F * 0.88, z: -0.8, pitch: -1.55, head: [-0.75, 0, 0], arms: ARM.superman, legs: [-0.4, 1.1, 0.15] }],
      [1.3, { y: F * 0.88, z: -0.82, pitch: -1.55, head: [-0.6, 0, 0], arms: ARM.superman, legs: [-0.2, 0.6, 0.1] }],
      [1.6, { y: 0.16, z: -0.82, pitch: -0.9, head: [-0.3, 0, 0], arms: ARM.push, legs: [0.5, 1, 0.1] }],
      [1.85, { z: -0.82, squash: 0.1, legs: [0.2, 0.4, 0.05] }],
      [2.05, { z: -0.82 }],
      [2.3, { y: 0.18, z: -0.4, squash: -0.08, arms: ARM.outUp, legs: [-0.3, 0.6, 0.1] }],
      [2.5, { squash: 0.12 }],
      [2.6, {}],
    ]);
  },
};

/** Knocked over onto the back, flailing, then up again. Shared by "Fall" and the pushed partner. */
function fallKeys(r: BuiltRacer, t0: number): [number, Pose][] {
  const B = r.back;
  return [
    [0, {}],
    [t0, {}],
    [
      t0 + 0.12,
      { pitch: 0.28, z: 0.08, spine: [0.25, 0, 0], head: [-0.35, 0, 0], arms: ARM.outUp, legs: [0.3, 0.2, 0.1] },
    ],
    [
      t0 + 0.32,
      { pitch: 0.95, y: 0.18, z: 0.25, arms: { u: [0.6, 0.8, -0.3], f: [0.4, 0.9, -0.4] }, legs: [0.9, 0.3, 0.2] },
    ],
    [t0 + 0.5, { pitch: 1.57, y: B, z: 0.38, squash: 0.1, arms: ARM.out, legs: [1.1, 0.2, 0.15] }],
    [t0 + 0.6, { pitch: 1.45, y: B + 0.07, z: 0.4, arms: ARM.outUp, legs: [1.0, 0.3, 0.15] }],
    [t0 + 0.72, { pitch: 1.57, y: B, z: 0.4, arms: ARM.out, legs: [0.9, 0.3, 0.15] }],
    [t0 + 1.55, { pitch: 1.57, y: B, z: 0.4, arms: ARM.out, legs: [0.9, 0.4, 0.15] }],
    [t0 + 1.9, { pitch: 0.7, y: 0.12, z: 0.35, spine: [-0.3, 0, 0], arms: ARM.push, legs: [0.6, 0.8, 0.1] }],
    [t0 + 2.1, { z: 0.3, squash: 0.1 }],
    [t0 + 2.35, { z: 0 }],
  ];
}

const fall: Action = {
  id: 'fall',
  label: 'Fall',
  length: 2.6,
  pair: false,
  pose(r, t) {
    return flail(keyed(t, fallKeys(r, 0.1)), t, ramp(t, 0.15, 0.4, 1.5, 1.75));
  },
};

const pushAction: Action = {
  id: 'push',
  label: 'Push',
  length: 2.8,
  pair: true,
  pose(r, t, role) {
    if (role === 'partner') return flail(keyed(t, fallKeys(r, 0.33)), t, ramp(t, 0.4, 0.6, 1.75, 2.0));
    const p = keyed(t, [
      [0, {}],
      [
        0.28,
        {
          pitch: 0.12,
          squash: 0.06,
          spine: [0.15, 0.1, 0],
          arms: ARM.windup,
          legR: [-0.2, 0.3, 0.05],
          legL: [0.25, 0.3, 0.05],
        },
      ],
      [
        0.4,
        {
          z: -0.16,
          pitch: -0.3,
          squash: -0.05,
          spine: [-0.15, 0, 0],
          head: [0.15, 0, 0],
          arms: ARM.fwd,
          legR: [0.5, 0.2, 0.05],
          legL: [-0.35, 0.2, 0.05],
        },
      ],
      [
        0.7,
        { z: -0.16, pitch: -0.2, spine: [-0.1, 0, 0], arms: ARM.fwd, legR: [0.45, 0.2, 0.05], legL: [-0.3, 0.2, 0.05] },
      ],
      [1.1, {}],
      [1.45, { y: 0.07, arms: { u: [0.6, -0.7, -0.3], f: [0.2, 0.1, -1] }, head: [-0.2, 0, 0.1] }],
      [1.6, { squash: 0.05, arms: { u: [0.6, -0.7, -0.3], f: [0.2, 0.1, -1] } }],
      [1.75, { y: 0.07, arms: { u: [0.6, -0.7, -0.3], f: [0.2, 0.1, -1] }, head: [-0.2, 0, -0.1] }],
      [1.95, { squash: 0.05 }],
      [2.8, {}],
    ]);
    return p;
  },
};

/** When the shove lands on the racer being pushed (the pusher uses the Push shove, which lands at 0.4 s). */
const HIT = 0.33;

/** Shoved from behind: lurch forward, stumble, face-plant onto the belly, flail, push up, hop back to the start. */
const pushedBack: Action = {
  id: 'pushedBack',
  label: 'Pushed from behind',
  length: 3.1,
  pair: true,
  pose(r, t, role) {
    if (role === 'partner') return pushAction.pose(r, t, 'actor');
    const F = r.front;
    const t0 = HIT;
    const down: Pose = { pitch: -1.57, y: F * 0.85, z: -0.55, arms: ARM.out, legs: [-0.3, 0.9, 0.15] };
    const p = keyed(t, [
      [0, {}],
      [t0, {}],
      [
        t0 + 0.1,
        {
          pitch: -0.3,
          z: -0.1,
          spine: [-0.2, 0, 0],
          head: [0.35, 0, 0],
          arms: { u: [0.5, 0.3, 0.8], f: [0.4, 0.5, 0.75] },
          legR: [0.6, 0.3, 0.05],
          legL: [-0.4, 0.5, 0.05],
        },
      ],
      [
        t0 + 0.28,
        {
          pitch: -0.55,
          z: -0.35,
          y: 0.05,
          head: [0.2, 0, 0],
          arms: ARM.outUp,
          legR: [-0.4, 0.6, 0.05],
          legL: [0.6, 0.3, 0.05],
        },
      ],
      [
        t0 + 0.45,
        { pitch: -1.2, y: F * 0.8 + 0.1, z: -0.5, head: [-0.4, 0, 0], arms: ARM.superman, legs: [-0.3, 0.3, 0.1] },
      ],
      [t0 + 0.55, { ...down, squash: 0.08, head: [-0.5, 0, 0], arms: ARM.superman }],
      [t0 + 0.65, { ...down, pitch: -1.5, y: F * 0.85 + 0.05 }],
      [t0 + 0.75, down],
      [t0 + 1.45, down],
      [t0 + 1.75, { pitch: -0.9, y: 0.16, z: -0.55, head: [-0.3, 0, 0], arms: ARM.push, legs: [0.5, 1, 0.1] }],
      [t0 + 2.0, { z: -0.55, squash: 0.1, legs: [0.2, 0.4, 0.05] }],
      [t0 + 2.2, { z: -0.55 }],
      [t0 + 2.45, { y: 0.15, z: -0.25, squash: -0.08, arms: ARM.outUp, legs: [-0.3, 0.6, 0.1] }],
      [t0 + 2.62, { squash: 0.1 }],
      [3.1, {}],
    ]);
    return flail(p, t, ramp(t, t0 + 0.7, t0 + 0.85, t0 + 1.3, t0 + 1.5));
  },
};

/** Shoved from the right side: knocked sideways, tip over onto the left side, flail, push off, hop back. */
const pushedSide: Action = {
  id: 'pushedSide',
  label: 'Pushed from the side',
  length: 3.1,
  pair: true,
  pose(r, t, role) {
    if (role === 'partner') return pushAction.pose(r, t, 'actor');
    const S = r.side;
    const t0 = HIT;
    const down: Pose = { roll: 1.57, x: -0.42, y: S, arms: ARM.up, legR: [0, 0.2, 0.3], legL: [0, 0.2, 0.1] };
    const p = keyed(t, [
      [0, {}],
      [t0, {}],
      [
        t0 + 0.1,
        {
          roll: 0.3,
          x: -0.08,
          spine: [0, 0, 0.15],
          head: [0, 0, -0.35],
          armR: ARM.outUp,
          armL: ARM.out,
          legR: [0, 0.3, 0.25],
          legL: [0, 0.1, -0.05],
        },
      ],
      [
        t0 + 0.28,
        {
          roll: 0.55,
          x: -0.3,
          y: 0.06,
          head: [0, 0, -0.25],
          arms: ARM.outUp,
          legR: [0.2, 0.5, 0.4],
          legL: [-0.1, 0.4, 0],
        },
      ],
      [t0 + 0.48, { ...down, squash: 0.08 }],
      [t0 + 0.58, { ...down, roll: 1.48, y: S + 0.06 }],
      [t0 + 0.7, down],
      [t0 + 1.45, down],
      [
        t0 + 1.8,
        {
          roll: 0.7,
          x: -0.4,
          y: 0.1,
          spine: [0, 0, -0.3],
          armL: ARM.push,
          armR: ARM.out,
          legs: [0.3, 0.8, 0.1],
        },
      ],
      [t0 + 2.05, { x: -0.4, squash: 0.1 }],
      [t0 + 2.25, { x: -0.4 }],
      [t0 + 2.47, { x: -0.15, y: 0.13, squash: -0.06, arms: ARM.outUp, legs: [0, 0.5, 0.15] }],
      [t0 + 2.62, { squash: 0.08 }],
      [3.1, {}],
    ]);
    return flail(p, t, ramp(t, t0 + 0.65, t0 + 0.8, t0 + 1.3, t0 + 1.5));
  },
};

/** Lying flat on the back after a fall (the pivot is the feet, so the body lies toward +Z). */
function lyingPose(r: BuiltRacer): Pose {
  return { pitch: 1.57, y: r.back, arms: ARM.out, legs: [0.15, 0.2, 0.12] };
}

/** From `start` on, blend over 0.25 s into the run cycle, turned by `yaw` and shifted back by `z`. */
function runOff(r: BuiltRacer, p: Full, t: number, start: number, yaw: number, z = 0): Full {
  const w = smooth(clamp01((t - start) / 0.25));
  if (w <= 0) return p;
  const go = run.pose(r, Math.max(0, t - start), 'actor');
  go.yaw += yaw;
  go.z += z;
  return mix(p, go, w);
}

/** A quick helping hand: about 1 s to pull the fallen racer up, then both turn and run on with the race. */
const help: Action = {
  id: 'help',
  label: 'Help up',
  length: 2.4,
  pair: true,
  pose(r, t, role) {
    // Both turn to face -Z (the race direction) after the pull; they stand facing each other along X.
    const turn = role === 'actor' ? -Math.PI / 2 : Math.PI / 2;
    if (role === 'partner') {
      const B = r.back;
      const lying = lyingPose(r);
      const reaching: Pose = {
        ...lying,
        head: [-0.45, 0, 0],
        arms: { u: [0.15, -0.55, -0.82], f: [0.1, -0.6, -0.8] },
      };
      const p = keyed(t, [
        [0, reaching],
        [0.3, { ...reaching, head: [-0.5, 0, 0] }],
        [
          0.8,
          {
            pitch: 0.8,
            y: B * 0.6,
            head: [-0.3, 0, 0],
            arms: { u: [0.15, -0.2, -1], f: [0.1, -0.2, -1] },
            legs: [0.4, 0.6, 0.1],
          },
        ],
        [1.3, { squash: -0.06, arms: ARM.fwd }],
        [1.45, { squash: 0.06, yaw: turn * 0.6 }],
        [1.6, { yaw: turn }],
        [2.4, { yaw: turn }],
      ]);
      return runOff(r, p, t, 1.45, turn);
    }
    const p = keyed(t, [
      [0, {}],
      [
        0.3,
        {
          z: -0.05,
          pitch: -0.5,
          spine: [-0.35, 0, 0],
          head: [0.5, 0, 0],
          arms: ARM.reach,
          legR: [0.35, 0.45, 0.05],
          legL: [-0.25, 0.45, 0.05],
        },
      ],
      [
        0.8,
        {
          z: 0.12,
          pitch: 0.25,
          spine: [0.15, 0, 0],
          arms: { u: [0.18, -0.3, -0.95], f: [0.1, -0.25, -0.97] },
          legR: [-0.2, 0.3, 0.05],
          legL: [0.3, 0.4, 0.05],
        },
      ],
      [1.3, { z: 0.2, pitch: 0.06, arms: ARM.fwd }],
      [1.45, { z: 0.2, yaw: turn * 0.6 }],
      [1.6, { z: 0.2, yaw: turn }],
      [2.4, { z: 0.2, yaw: turn }],
    ]);
    return runOff(r, p, t, 1.45, turn, 0.2);
  },
};

/** Getting up alone in 2 s: sit up, rock onto the feet into a crouch, stand, shake it off. */
const getUp: Action = {
  id: 'getup',
  label: 'Get up',
  length: 2,
  pair: false,
  pose(r, t) {
    const lying = lyingPose(r);
    const p = keyed(t, [
      [0, lying],
      [0.25, { ...lying, head: [-0.35, 0, 0], legs: [0.3, 0.5, 0.12] }],
      [
        0.7,
        {
          pitch: 0.75,
          y: -0.12,
          spine: [-0.45, 0, 0],
          head: [-0.2, 0, 0],
          arms: { u: [0.45, -0.75, 0.5], f: [0.35, -0.85, 0.4] },
          legs: [1.0, 1.2, 0.15],
        },
      ],
      [
        1.15,
        {
          pitch: 0.15,
          y: -0.06,
          squash: 0.18,
          spine: [-0.35, 0, 0],
          head: [0.15, 0, 0],
          arms: { u: [0.6, -0.6, -0.5], f: [0.5, -0.4, -0.75] },
          legs: [0.9, 1.4, 0.12],
        },
      ],
      [1.55, { y: 0.05, squash: -0.1, spine: [0.05, 0, 0], arms: ARM.outUp, legs: [0.1, 0.2, 0.05] }],
      [1.72, { squash: 0.08, head: [0, 0.25, 0.15] }],
      [1.86, { head: [0, -0.25, -0.15] }],
      [2, {}],
    ]);
    return flail(p, t, ramp(t, 0.0, 0.08, 0.2, 0.3) * 0.5);
  },
};

export const ACTIONS: readonly Action[] = [
  idle,
  run,
  jump,
  dive,
  fall,
  getUp,
  pushAction,
  pushedBack,
  pushedSide,
  help,
];

/** Where a racer stands for a pair action: x, and facing (yaw; 0 faces the camera at -Z, +pi/2 faces -X). */
export interface Spot {
  x: number;
  yaw: number;
}

/**
 * Where the actor (the chosen racer) and the partner (the next racer) stand for each pair action, and the x the
 * camera centres on. In Push the actor shoves; in the Pushed actions the actor is shoved and the partner pushes.
 */
export const PAIR_LAYOUT: Record<string, { actor: Spot; partner: Spot; focusX: number }> = {
  push: { actor: { x: 0.42, yaw: Math.PI / 2 }, partner: { x: -0.42, yaw: -Math.PI / 2 }, focusX: 0 },
  // The partner stands behind the actor, facing the same way; the actor falls forward toward -X.
  pushedBack: { actor: { x: 0.15, yaw: Math.PI / 2 }, partner: { x: 0.74, yaw: Math.PI / 2 }, focusX: -0.22 },
  // The actor faces the camera; the partner stands at the actor's right (+X) facing it, so the actor tips to -X.
  pushedSide: { actor: { x: 0.2, yaw: 0 }, partner: { x: 0.83, yaw: Math.PI / 2 }, focusX: -0.1 },
  help: { actor: { x: 0.28, yaw: Math.PI / 2 }, partner: { x: -0.16, yaw: -Math.PI / 2 }, focusX: -0.24 },
};
