// In-game procedural animation for the racers: every `Anim` state as a pose, written into preallocated
// buffers (no allocation per frame), cross-faded between states, with a landing squash, idle fidgets and
// several celebrations. play.ts applies the result to the racer's bones.
import { Anim, BUTTERFLY } from '@wobble/shared/constants';
import { ARM, full, type Full, type Pose } from './anim.ts';

type V3 = [number, number, number];
interface Arm {
  u: V3;
  f: V3;
}

/** The lying-down heights of a racer (a BuiltRacer satisfies this). */
export interface RacerDims {
  front: number;
  back: number;
  side: number;
}

// ---- in-place pose helpers -----------------------------------------------------------------------------

/** A fresh neutral pose with its own arrays (safe to write into). */
export function newPose(): Full {
  return clonePose(full({}));
}

function clonePose(p: Full): Full {
  return {
    ...p,
    hips: [p.hips[0], p.hips[1], p.hips[2]],
    spine: [p.spine[0], p.spine[1], p.spine[2]],
    head: [p.head[0], p.head[1], p.head[2]],
    armR: { u: [...p.armR.u], f: [...p.armR.f] },
    armL: { u: [...p.armL.u], f: [...p.armL.f] },
    legR: [p.legR[0], p.legR[1], p.legR[2]],
    legL: [p.legL[0], p.legL[1], p.legL[2]],
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const ramp = (t: number, a: number, b: number, c: number, d: number) =>
  smooth(clamp01((t - a) / (b - a))) * (1 - smooth(clamp01((t - c) / (d - c))));
const TAU = Math.PI * 2;

function set3(o: V3, x: number, y: number, z: number): void {
  o[0] = x;
  o[1] = y;
  o[2] = z;
}
function lerp3(o: V3, a: V3, b: V3, t: number): void {
  set3(o, lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
}
function setArm(o: Arm, a: Arm): void {
  set3(o.u, a.u[0], a.u[1], a.u[2]);
  set3(o.f, a.f[0], a.f[1], a.f[2]);
}
function lerpArm(o: Arm, a: Arm, b: Arm, t: number): void {
  lerp3(o.u, a.u, b.u, t);
  lerp3(o.f, a.f, b.f, t);
}
/** Swing direction `d` forward (−) or back (+) about the shoulder's side axis, into `o` (may alias d). */
function swing(o: V3, d: V3, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const y = d[1] * c + d[2] * s;
  const z = d[2] * c - d[1] * s;
  set3(o, d[0], y, z);
}

/** o = mix(a, b, t). `o` may be `a` or `b`. */
export function mixPose(o: Full, a: Full, b: Full, t: number): Full {
  o.x = lerp(a.x, b.x, t);
  o.y = lerp(a.y, b.y, t);
  o.z = lerp(a.z, b.z, t);
  o.pitch = lerp(a.pitch, b.pitch, t);
  o.roll = lerp(a.roll, b.roll, t);
  o.yaw = lerp(a.yaw, b.yaw, t);
  o.squash = lerp(a.squash, b.squash, t);
  lerp3(o.hips, a.hips, b.hips, t);
  lerp3(o.spine, a.spine, b.spine, t);
  lerp3(o.head, a.head, b.head, t);
  lerpArm(o.armR, a.armR, b.armR, t);
  lerpArm(o.armL, a.armL, b.armL, t);
  lerp3(o.legR, a.legR, b.legR, t);
  lerp3(o.legL, a.legL, b.legL, t);
  return o;
}

export function copyPose(o: Full, a: Full): Full {
  return mixPose(o, a, a, 0);
}

/** Key poses, normalised once (each key has its own arrays). */
interface Keys {
  t: number[];
  p: Full[];
}
function keys(list: [number, Pose][]): Keys {
  return { t: list.map((k) => k[0]), p: list.map((k) => clonePose(full(k[1]))) };
}
function keyedInto(o: Full, t: number, k: Keys): Full {
  const n = k.t.length;
  let i = 0;
  while (i < n - 1 && k.t[i + 1]! <= t) i++;
  const j = Math.min(i + 1, n - 1);
  const span = k.t[j]! - k.t[i]!;
  return mixPose(o, k.p[i]!, k.p[j]!, span > 0 ? smooth(clamp01((t - k.t[i]!) / span)) : 0);
}

/** Waving arms and kicking legs on top of `p`, weight w, at rate scale `rate`. */
function flail(p: Full, t: number, w: number, rate = 1): void {
  if (w <= 0) return;
  const k = (f: number, ph: number) => Math.sin(t * f * rate + ph) * w;
  swing(p.armR.u, p.armR.u, 0.7 * k(13, 0));
  swing(p.armR.f, p.armR.f, 0.9 * k(13, 0.8));
  swing(p.armL.u, p.armL.u, 0.7 * k(11, 2));
  swing(p.armL.f, p.armL.f, 0.9 * k(11, 2.6));
  p.legR[0] += 0.35 * k(15, 0);
  p.legR[1] += 0.3 * Math.abs(k(15, 1));
  p.legL[0] += 0.35 * k(15, Math.PI);
  p.legL[1] += 0.3 * Math.abs(k(15, 2));
  p.head[1] += 0.25 * k(7, 0);
}

// ---- fixed key tables (built once) ---------------------------------------------------------------------

const ARM_HIP: Arm = { u: [0.75, -0.6, 0.15], f: [-0.5, -0.2, -0.3] };
const ARM_PUMP_LOW: Arm = { u: [0.6, -0.2, -0.3], f: [0.2, 0.95, -0.2] };
const ARM_RUN_U: V3 = [0.35, -0.94, 0];
const ARM_RUN_F: V3 = [0.3, -0.95, 0];

const STUMBLE = keys([
  [0, {}],
  [
    0.12,
    {
      pitch: -0.35,
      squash: 0.08,
      spine: [-0.25, 0, 0],
      head: [0.4, 0, 0],
      arms: { u: [0.5, 0.3, 0.8], f: [0.4, 0.5, 0.75] },
      legR: [0.6, 0.3, 0.05],
      legL: [-0.4, 0.5, 0.05],
    },
  ],
  [
    0.35,
    {
      pitch: -0.45,
      squash: -0.05,
      head: [0.2, 0, 0],
      arms: ARM.outUp,
      legR: [-0.4, 0.6, 0.05],
      legL: [0.6, 0.3, 0.05],
    },
  ],
  [0.65, { pitch: -0.15, squash: 0.06, arms: ARM.out, legR: [0.3, 0.3, 0.05], legL: [-0.2, 0.3, 0.05] }],
  [1, {}],
]);

const JUMP = keys([
  [0, { squash: 0.16, pitch: -0.12, spine: [-0.2, 0, 0], head: [0.25, 0, 0], arms: ARM.back, legs: [0.5, 0.9, 0.08] }],
  [0.09, { squash: -0.22, pitch: 0.05, spine: [0.1, 0, 0], head: [-0.15, 0, 0], arms: ARM.up, legs: [-0.15, 0.1, 0] }],
  [0.32, { squash: -0.06, spine: [-0.05, 0, 0], arms: ARM.outUp, legs: [0.6, 1.1, 0.12] }],
  [0.6, { squash: 0.02, spine: [-0.1, 0, 0], head: [0.1, 0, 0], arms: ARM.out, legs: [0.8, 1.3, 0.12] }],
]);

const FALL = keys([
  [0, { squash: -0.07, spine: [-0.05, 0, 0], head: [-0.2, 0, 0], arms: ARM.outUp, legs: [0.2, 0.3, 0.1] }],
]);

const GRAB_S = BUTTERFLY.GRAB_ANIM_MS / 1000;
const GRAB = keys([
  [0, {}],
  [
    0.07,
    {
      pitch: 0.12,
      squash: 0.08,
      spine: [0.15, 0.1, 0],
      arms: ARM.windup,
      legR: [-0.2, 0.3, 0.05],
      legL: [0.25, 0.3, 0.05],
    },
  ],
  [
    0.18,
    {
      pitch: -0.34,
      squash: -0.08,
      spine: [-0.18, 0, 0],
      head: [0.15, 0, 0],
      arms: ARM.fwd,
      legR: [0.55, 0.25, 0.05],
      legL: [-0.4, 0.2, 0.05],
    },
  ],
  [GRAB_S, { pitch: -0.22, spine: [-0.1, 0, 0], arms: ARM.fwd, legR: [0.4, 0.2, 0.05], legL: [-0.3, 0.2, 0.05] }],
]);

const CHEER = keys([
  [0, { squash: 0.12, arms: ARM.out, legs: [0.2, 0.5, 0.08] }],
  [0.25, { y: 0.28, squash: -0.14, arms: ARM.up, legs: [0.4, 0.8, 0.1] }],
  [0.5, { squash: 0.14, arms: ARM.outUp }],
  [0.7, { squash: 0.12, arms: ARM.out, legs: [0.2, 0.5, 0.08] }],
]);

/** Racer-specific tables (depend on lying heights), built once per racer. */
interface RacerKeys {
  dive: Keys;
  prone: Keys;
  knocked: Keys;
  getup: Keys;
}

function racerKeys(r: RacerDims): RacerKeys {
  const F = r.front;
  const B = r.back;
  const lying: Pose = { pitch: 1.57, y: B, arms: ARM.out, legs: [0.15, 0.2, 0.12] };
  return {
    dive: keys([
      [0, { y: 0.22, pitch: -0.8, squash: -0.2, head: [-0.5, 0, 0], arms: ARM.superman, legs: [-0.3, 0.2, 0] }],
      [
        0.22,
        { y: F + 0.14, pitch: -1.45, squash: -0.12, head: [-0.6, 0, 0], arms: ARM.superman, legs: [-0.3, 0.1, 0.1] },
      ],
    ]),
    prone: keys([
      [0, { y: F * 0.85, pitch: -1.57, squash: 0.12, head: [-0.7, 0, 0], arms: ARM.superman, legs: [-0.2, 0.2, 0.12] }],
      [0.18, { y: F * 0.88, pitch: -1.55, squash: 0.02, head: [-0.75, 0, 0], arms: ARM.out, legs: [-0.4, 1.1, 0.15] }],
    ]),
    knocked: keys([
      [0, {}],
      [0.12, { pitch: 0.28, spine: [0.25, 0, 0], head: [-0.35, 0, 0], arms: ARM.outUp, legs: [0.3, 0.2, 0.1] }],
      [0.32, { pitch: 0.95, y: 0.18, arms: { u: [0.6, 0.8, -0.3], f: [0.4, 0.9, -0.4] }, legs: [0.9, 0.3, 0.2] }],
      [0.5, { pitch: 1.57, y: B, squash: 0.14, arms: ARM.out, legs: [1.1, 0.2, 0.15] }],
      [0.6, { pitch: 1.45, y: B + 0.07, squash: -0.05, arms: ARM.outUp, legs: [1.0, 0.3, 0.15] }],
      [0.72, { pitch: 1.57, y: B, arms: ARM.out, legs: [0.9, 0.3, 0.15] }],
    ]),
    getup: keys([
      [0, lying],
      [0.12, { ...lying, head: [-0.35, 0, 0], legs: [0.3, 0.5, 0.12] }],
      [
        0.4,
        {
          pitch: 0.6,
          y: -0.1,
          squash: 0.15,
          spine: [-0.4, 0, 0],
          arms: { u: [0.6, -0.6, -0.5], f: [0.5, -0.4, -0.75] },
          legs: [0.9, 1.3, 0.12],
        },
      ],
      [0.7, { y: 0.06, squash: -0.12, arms: ARM.outUp, legs: [0.1, 0.2, 0.05] }],
      [0.85, { squash: 0.08, head: [0, 0.25, 0.15] }],
      [1, { head: [0, -0.15, -0.1] }],
      [1.1, {}],
    ]),
  };
}

// ---- state poses ---------------------------------------------------------------------------------------

/** Idle with a fidget every few seconds (look around, bounce, arm swing, stretch, toe tap). */
function idlePose(o: Full, t: number, seed: number): void {
  copyPose(o, NEUTRAL_POSE);
  const b = Math.sin(t * TAU * 0.4);
  o.squash = 0.025 * b;
  o.spine[0] = 0.025 * b;
  o.head[1] = 0.1 * Math.sin(t * TAU * 0.33 + 1);
  o.head[2] = 0.04 * b;
  swing(o.armR.u, o.armR.u, 0.06 * b);
  swing(o.armL.u, o.armL.u, -0.06 * b);
  // fidget windows of 4 s; which fidget (or none) is picked from the racer's seed
  const win = Math.floor(t / 4);
  const lt = t - win * 4;
  const kind = ((win * 2654435761 + seed) >>> 0) % 6;
  const w = ramp(lt, 0.4, 0.8, 2.8, 3.3);
  if (w <= 0) return;
  switch (kind) {
    case 1: {
      // look around: left, right, back to front
      const look = Math.sin(((lt - 0.4) / 2.9) * TAU);
      o.head[1] += 0.75 * look * w;
      o.spine[1] += 0.2 * look * w;
      o.head[0] -= 0.1 * w;
      break;
    }
    case 2: {
      // bounce on the spot
      const h = Math.sin(lt * TAU * 2.2);
      o.squash += 0.1 * h * w;
      o.y += 0.06 * Math.max(0, -h) * w;
      o.legR[1] += 0.25 * Math.max(0, h) * w;
      o.legL[1] += 0.25 * Math.max(0, h) * w;
      swing(o.armR.f, o.armR.f, -0.4 * Math.max(0, h) * w);
      swing(o.armL.f, o.armL.f, -0.4 * Math.max(0, h) * w);
      break;
    }
    case 3: {
      // arm sway: both arms swing like a pendulum, body twists along
      const s = Math.sin(lt * TAU * 1.1);
      swing(o.armR.u, o.armR.u, -0.7 * s * w);
      swing(o.armR.f, o.armR.f, -0.9 * s * w);
      swing(o.armL.u, o.armL.u, -0.7 * s * w);
      swing(o.armL.f, o.armL.f, -0.9 * s * w);
      o.yaw += 0.15 * s * w;
      break;
    }
    case 4: {
      // big stretch: arms up, rise onto the toes
      lerpArm(o.armR, o.armR, ARM.up, w);
      lerpArm(o.armL, o.armL, ARM.up, w);
      o.squash -= 0.1 * w;
      o.spine[0] += 0.12 * w;
      o.head[0] -= 0.25 * w;
      break;
    }
    case 5: {
      // toe tap and a little side-to-side
      const s = Math.sin(lt * TAU * 2.5);
      o.legR[0] += 0.3 * Math.max(0, s) * w;
      o.legR[1] += 0.3 * Math.max(0, s) * w;
      o.roll += 0.05 * Math.sin(lt * TAU * 1.25) * w;
      o.head[2] += 0.12 * Math.sin(lt * TAU * 1.25) * w;
      break;
    }
    default:
      break;
  }
}

function runPose(o: Full, ph: number, k: number): void {
  copyPose(o, NEUTRAL_POSE);
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  const c2 = Math.cos(2 * ph);
  o.y = 0.08 * k * Math.abs(s);
  o.pitch = -0.12 - 0.12 * k;
  o.roll = 0.08 * s;
  o.yaw = 0.09 * s;
  // squash at each foot strike, stretch at mid-stride
  o.squash = 0.09 * k * c2;
  set3(o.hips, 0, -0.12 * s, 0);
  set3(o.spine, -0.08, 0.2 * s, 0);
  // head bob: nods with each step, sways with the stride
  set3(o.head, 0.18 + 0.1 * k * c2, -0.15 * s, 0.05 * s);
  set3(o.legR, 0.85 * s, 0.1 + 0.95 * Math.max(0, c), 0.05);
  set3(o.legL, -0.85 * s, 0.1 + 0.95 * Math.max(0, -c), 0.05);
  const a = 0.95 * s;
  swing(o.armR.u, ARM_RUN_U, a);
  swing(o.armR.f, ARM_RUN_F, a - 1.4);
  swing(o.armL.u, ARM_RUN_U, -a);
  swing(o.armL.f, ARM_RUN_F, -a - 1.4);
}

/** Number of celebrations `celebratePose` knows. */
export const CELEBRATION_COUNT = 5;
export const CELEBRATIONS = ['cheer', 'fistPump', 'spin', 'wave', 'hops'] as const;

/**
 * A celebration pose (the finish line, and the podium). `variant` picks one of CELEBRATIONS (wrapped), `t` is
 * seconds since it began. Writes into `o` (allocation-free) and returns it; apply with applyPlayPose.
 */
export function celebratePose(o: Full, variant: number, t: number): Full {
  const v = ((Math.floor(variant) % CELEBRATION_COUNT) + CELEBRATION_COUNT) % CELEBRATION_COUNT;
  copyPose(o, NEUTRAL_POSE);
  switch (v) {
    case 1: {
      // fist pump: right arm punches the air, left on the hip, knee bounce
      const p = Math.sin(t * TAU * 2.2);
      const up = 0.5 + 0.5 * p;
      lerpArm(o.armR, ARM_PUMP_LOW, ARM.up, up);
      setArm(o.armL, ARM_HIP);
      o.squash = 0.08 * -p;
      o.legR[1] += 0.25 * (1 - up);
      o.legL[1] += 0.25 * (1 - up);
      o.spine[0] = 0.1;
      o.spine[2] = -0.08;
      o.head[0] = -0.2;
      break;
    }
    case 2: {
      // spin on the spot with arms out, then a little bow
      const cyc = t % 2;
      o.yaw = TAU * smooth(clamp01(cyc / 1.1));
      const out = ramp(cyc, 0, 0.15, 1.0, 1.2);
      lerpArm(o.armR, o.armR, ARM.out, out);
      lerpArm(o.armL, o.armL, ARM.out, out);
      o.y = 0.08 * Math.sin(Math.PI * clamp01(cyc / 1.1));
      o.squash = -0.06 * out + 0.1 * ramp(cyc, 1.1, 1.2, 1.3, 1.45);
      const bow = ramp(cyc, 1.25, 1.45, 1.75, 1.95);
      o.pitch = -0.45 * bow;
      o.head[0] = 0.3 * bow;
      break;
    }
    case 3: {
      // both arms up, swaying side to side like waving to the crowd
      const s = Math.sin(t * TAU * 0.9);
      setArm(o.armR, ARM.up);
      setArm(o.armL, ARM.up);
      o.roll = 0.18 * s;
      o.spine[2] = 0.15 * s;
      o.head[2] = 0.15 * s;
      o.armR.u[0] += 0.4 * s;
      o.armL.u[0] -= 0.4 * s;
      o.squash = 0.04 * Math.cos(t * TAU * 1.8);
      break;
    }
    case 4: {
      // bunny hops, knees tucked, arms flapping
      const h = Math.sin(t * TAU * 1.6);
      const air = Math.max(0, h);
      o.y = 0.3 * air;
      o.squash = h < 0 ? 0.16 * -h : -0.1 * air;
      set3(o.legR, 0.5 * air, 1.1 * air + 0.3 * Math.max(0, -h), 0.1);
      set3(o.legL, 0.5 * air, 1.1 * air + 0.3 * Math.max(0, -h), 0.1);
      lerpArm(o.armR, ARM.out, ARM.outUp, 0.5 + 0.5 * Math.sin(t * TAU * 3.2));
      lerpArm(o.armL, ARM.out, ARM.outUp, 0.5 + 0.5 * Math.sin(t * TAU * 3.2));
      o.head[0] = -0.15;
      break;
    }
    default:
      keyedInto(o, t % 0.7, CHEER);
      break;
  }
  return o;
}

const NEUTRAL_POSE = newPose();

// ---- the animator --------------------------------------------------------------------------------------

const BLEND = 0.15;
const RUN_CYCLE = 0.44;
const isAir = (a: number) => a === Anim.JUMP || a === Anim.FALL;

export interface PlayAnimator {
  /** The blended pose of the last update (owned by the animator; copy before mutating it across frames). */
  readonly pose: Full;
  readonly anim: number;
  /** The celebration playing (or to play next), one of CELEBRATIONS. */
  celebration: number;
  /** Advance and return the blended pose (the same object each frame). */
  update(anim: number, speed: number, dt: number): Full;
}

/**
 * Animates one racer: cross-fades between states, adds a landing squash after jumps and falls, picks a new
 * celebration each finish. Allocation-free per update; about a dozen sin/cos and two pose mixes per racer.
 */
export function createPlayAnimator(r: RacerDims, seed = (Math.random() * 0x7fffffff) | 0): PlayAnimator {
  const rk = racerKeys(r);
  const out = newPose();
  const cur = newPose();
  const from = newPose();
  const tmp = newPose();
  let anim = -1;
  let s = 0;
  let clock = (seed % 97) * 0.13; // de-sync idles between racers
  let runT = 0;
  let fade = 1;
  let land = 9;
  let landAmp = 0;
  let celebrations = seed;

  function statePose(o: Full, a: number, speed: number): void {
    switch (a) {
      case Anim.RUN: {
        const k = Math.min(1.3, Math.max(0.3, speed / 7.5));
        runPose(o, ((runT % RUN_CYCLE) / RUN_CYCLE) * TAU, k);
        const w = clamp01((speed - 0.4) / 1.6);
        if (w < 1) {
          idlePose(tmp, clock, seed);
          mixPose(o, tmp, o, w);
        }
        break;
      }
      case Anim.JUMP:
        keyedInto(o, s, JUMP);
        break;
      case Anim.FALL:
        keyedInto(o, 0, FALL);
        flail(o, clock, 0.9);
        o.legR[0] += 0.4 * Math.sin(clock * 9);
        o.legL[0] -= 0.4 * Math.sin(clock * 9);
        break;
      case Anim.DIVE:
        keyedInto(o, s, rk.dive);
        // a stretched streamline with a little flutter kick
        o.legR[0] += 0.15 * Math.sin(clock * 16);
        o.legL[0] -= 0.15 * Math.sin(clock * 16);
        break;
      case Anim.PRONE:
        keyedInto(o, s, rk.prone);
        flail(o, clock, 0.3);
        break;
      case Anim.STUMBLE: {
        keyedInto(o, Math.min(s / (BUTTERFLY.STUMBLE_MS / 1000), 1), STUMBLE);
        const e = ramp(s, 0.03, 0.12, 0.6, 0.95);
        // wobble like a spinning top about to fall over
        o.roll += 0.28 * Math.sin(s * 14) * e;
        o.yaw += 0.2 * Math.sin(s * 9 + 1) * e;
        o.head[2] -= 0.3 * Math.sin(s * 14 - 0.6) * e;
        flail(o, clock, 0.6 * e);
        break;
      }
      case Anim.CELEBRATE:
        celebratePose(o, celebrations, s);
        break;
      case Anim.GRAB:
        keyedInto(o, s, GRAB);
        break;
      case Anim.KNOCKED: {
        keyedInto(o, Math.min(s, 0.72), rk.knocked);
        // flailing on the back: an early burst, then kicks in fits and starts
        const burst = ramp(s, 0.45, 0.65, 1.0, 1.3);
        const fits = s > 1 ? 0.3 + 0.3 * Math.max(0, Math.sin(clock * 2.3)) : 0;
        flail(o, clock, Math.max(burst, fits));
        break;
      }
      case Anim.GETUP:
        keyedInto(o, clamp01(s / (BUTTERFLY.GETUP_MS / 1000)) * 1.1, rk.getup);
        flail(o, clock, ramp(s, 0, 0.04, 0.08, 0.15) * 0.5);
        break;
      default:
        idlePose(o, clock, seed);
        break;
    }
  }

  const api: PlayAnimator = {
    pose: out,
    get anim() {
      return anim;
    },
    celebration: seed % CELEBRATION_COUNT,
    update(a, speed, dt) {
      const sp = Number.isFinite(speed) ? Math.abs(speed) : 0;
      const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
      if (a !== anim) {
        if (anim >= 0) {
          copyPose(from, out);
          fade = 0;
          if (isAir(anim) && !isAir(a) && a !== Anim.DIVE) {
            land = 0;
            landAmp = anim === Anim.FALL ? 1 : 0.75;
          }
        }
        if (a === Anim.CELEBRATE) {
          celebrations = api.celebration;
          api.celebration = (api.celebration + 1 + ((seed >>> 3) % (CELEBRATION_COUNT - 1))) % CELEBRATION_COUNT;
        }
        anim = a;
        s = 0;
      }
      s += step;
      clock = (clock + step) % 600;
      land += step;
      if (a === Anim.RUN) runT = (runT + step * Math.min(1.3, Math.max(0.35, sp / 7.5))) % (RUN_CYCLE * 100);
      statePose(cur, a, sp);
      if (fade < 1) {
        fade = Math.min(1, fade + step / BLEND);
        mixPose(out, from, cur, smooth(fade));
      } else copyPose(out, cur);
      if (land < 0.6) {
        // landing: squash down with bent knees, spring back with a little overshoot
        const e = landAmp * Math.exp(-land * 9);
        const sq = e * Math.cos(land * 17);
        out.squash += 0.28 * sq;
        out.y -= 0.04 * Math.max(0, sq);
        out.legR[1] += 0.7 * Math.max(0, sq);
        out.legL[1] += 0.7 * Math.max(0, sq);
        out.spine[0] -= 0.15 * Math.max(0, sq);
        swing(out.armR.u, out.armR.u, 0.3 * sq);
        swing(out.armL.u, out.armL.u, 0.3 * sq);
      }
      return out;
    },
  };
  return api;
}
