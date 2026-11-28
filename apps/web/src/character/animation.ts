// Procedural animation (#8): no skeleton, just a handful of pose channels (squash, lift, tilt, limb swing
// and raise) evaluated per Anim state and cross-faded over ~150 ms. Allocation-free after construction.
import { Anim, BUTTERFLY, PLAYER } from '@wobble/shared/constants';
import { BODY, PIVOT_Y } from './shape.ts';

/** Pose channels. Angles in radians; pitch < 0 leans forward, swing > 0 swings a limb forward. */
export const CH = Object.freeze({
  squash: 0, // y stretch factor around the feet (volume preserving), 1 = neutral
  lift: 1, // extra height of the body pivot, metres
  pitch: 2,
  roll: 3,
  twist: 4,
  armLSwing: 5,
  armRSwing: 6,
  armLRaise: 7,
  armRRaise: 8,
  legLSwing: 9,
  legRSwing: 10,
  legLRaise: 11,
  legRRaise: 12,
});
export const CHANNELS = 13;
export const ANIM_COUNT = 11;
export const BLEND_SECONDS = 0.15;
/** Celebrations the CELEBRATE state cycles through (jump-cheer, spin, fist pump). */
export const CELEBRATION_COUNT = 3;

const TAU = Math.PI * 2;
/** Lift that rests the pitched-over body on the ground. */
const PRONE_LIFT = BODY.radius + 0.02 - PIVOT_Y;

function neutral(o: Float32Array): void {
  o.fill(0);
  o[CH.squash] = 1;
}

function arms(o: Float32Array, swingL: number, swingR: number, raiseL: number, raiseR: number): void {
  o[CH.armLSwing] = swingL;
  o[CH.armRSwing] = swingR;
  o[CH.armLRaise] = raiseL;
  o[CH.armRRaise] = raiseR;
}

function legs(o: Float32Array, swingL: number, swingR: number, raiseL: number, raiseR: number): void {
  o[CH.legLSwing] = swingL;
  o[CH.legRSwing] = swingR;
  o[CH.legLRaise] = raiseL;
  o[CH.legRRaise] = raiseR;
}

/**
 * Write the pose of one Anim state into `o` (length CHANNELS).
 * `t` is a running clock in seconds, `stride` the run cycle phase in radians, `k` the run speed / runSpeed and
 * `u` the seconds since this state began (drives the one-shot GETUP; defaults to `t`), `variant` picks the
 * celebration (0..CELEBRATION_COUNT-1).
 */
export function evalAnim(
  anim: number,
  t: number,
  stride: number,
  k: number,
  o: Float32Array,
  u: number = t,
  variant = 0,
): void {
  neutral(o);
  switch (anim) {
    case Anim.RUN: {
      const s = Math.sin(stride);
      o[CH.squash] = 1 + 0.08 * k * Math.cos(stride * 2);
      o[CH.lift] = 0.07 * k * Math.abs(s);
      o[CH.pitch] = -0.18 * k;
      o[CH.roll] = 0.14 * k * s;
      o[CH.twist] = 0.1 * k * s;
      arms(o, -0.9 * k * s, 0.9 * k * s, 0.08 + 0.2 * k, 0.08 + 0.2 * k);
      legs(o, 0.8 * k * s, -0.8 * k * s, 0, 0);
      break;
    }
    case Anim.JUMP:
      o[CH.squash] = 1.12;
      o[CH.pitch] = 0.06;
      arms(o, 0.2, 0.2, 2.3, 2.3);
      legs(o, 0.4, -0.15, 0.05, 0.05);
      break;
    case Anim.FALL: {
      const f = TAU * 3.2 * t;
      o[CH.squash] = 1 + 0.04 * Math.sin(f * 0.5);
      o[CH.roll] = 0.08 * Math.sin(f * 0.5);
      arms(o, 0.4 * Math.sin(f + 1), -0.4 * Math.sin(f + 1), 2.4 + 0.35 * Math.sin(f), 2.4 + 0.35 * Math.cos(f));
      legs(o, 0.6 * Math.sin(f), -0.6 * Math.sin(f), 0.15, 0.15);
      break;
    }
    case Anim.DIVE:
      o[CH.squash] = 1.08;
      o[CH.lift] = 0.05;
      o[CH.pitch] = -1.45;
      arms(o, 2.95, 2.95, 0.12, 0.12);
      legs(o, -0.25, -0.25, 0.1, 0.1);
      break;
    case Anim.PRONE: {
      const b = Math.sin(TAU * 2.5 * t);
      o[CH.squash] = 0.94 + 0.015 * b;
      o[CH.lift] = PRONE_LIFT;
      o[CH.pitch] = -Math.PI / 2;
      arms(o, 0.35 + 0.08 * b, 0.35 - 0.08 * b, 1.35, 1.35);
      legs(o, -0.1, -0.1, 0.3, 0.3);
      break;
    }
    case Anim.STUMBLE: {
      const w = TAU * 2.4 * t;
      o[CH.squash] = 0.95 + 0.05 * Math.sin(w * 2);
      o[CH.pitch] = 0.08 + 0.12 * Math.sin(w * 0.7);
      o[CH.roll] = 0.28 * Math.sin(w);
      o[CH.twist] = 0.2 * Math.sin(w * 0.5 + 1);
      arms(o, 0.3 * Math.sin(w * 1.3), -0.3 * Math.sin(w * 1.3), 1.2 + 0.5 * Math.sin(w), 1.2 - 0.5 * Math.sin(w));
      legs(o, 0.3 * Math.sin(w), -0.3 * Math.sin(w), 0.1, 0.1);
      break;
    }
    case Anim.GRAB: {
      // Reach / push: the arms wind back, thrust straight forward, hold, then relax. `p` is how far through
      // BUTTERFLY.GRAB_ANIM_MS we are; the lunge peaks at 45%.
      const p = Math.min(1, Math.max(0, u / (BUTTERFLY.GRAB_ANIM_MS / 1000)));
      const wind = Math.sin(Math.min(1, p / 0.15) * Math.PI) * (p < 0.15 ? 1 : 0); // brief wind-up before the thrust
      const thrust = p < 0.45 ? Math.sin((p / 0.45) * (Math.PI / 2)) : 1 - 0.35 * ((p - 0.45) / 0.55);
      o[CH.squash] = 1 - 0.04 * thrust;
      o[CH.pitch] = -0.38 * thrust + 0.1 * wind;
      o[CH.lift] = 0.03 * thrust;
      const raise = 0.5 + 1.1 * thrust - 0.35 * wind;
      arms(o, 0.25 * thrust - 0.5 * wind, 0.25 * thrust - 0.5 * wind, raise, raise);
      legs(o, 0.5 * thrust, -0.35 * thrust, 0, 0.05 * thrust);
      break;
    }
    case Anim.KNOCKED: {
      // Flat on the back, dazed: arms flung out, legs apart, a slow wobble.
      const b = Math.sin(TAU * 1.6 * t);
      o[CH.squash] = 0.96 + 0.015 * b;
      o[CH.lift] = PRONE_LIFT;
      o[CH.pitch] = Math.PI / 2;
      o[CH.twist] = 0.18 * Math.sin(TAU * 0.8 * t);
      arms(o, -0.5 + 0.12 * b, 0.5 - 0.12 * b, 1.0, 1.0);
      legs(o, 0.35, -0.35, 0.35, 0.35);
      break;
    }
    case Anim.GETUP: {
      // One-shot: roll up off the floor (pitch and lift ease to standing), a push-off squash on the way, a
      // small overshoot at the end.
      const p = Math.min(1, Math.max(0, u / (BUTTERFLY.GETUP_MS / 1000)));
      const e = p * p * (3 - 2 * p);
      o[CH.pitch] = (Math.PI / 2) * (1 - e);
      o[CH.lift] = PRONE_LIFT * (1 - e) + 0.07 * Math.sin(Math.PI * Math.min(1, p * 1.4));
      o[CH.squash] = 1 - 0.1 * Math.sin(Math.PI * p) + 0.05 * Math.max(0, Math.sin(Math.PI * (p * 2 - 1)));
      o[CH.twist] = 0.15 * (1 - e) * Math.sin(TAU * p);
      const push = Math.sin(Math.PI * p);
      arms(
        o,
        -0.4 * (1 - e) + 0.3 * push,
        0.4 * (1 - e) - 0.3 * push,
        1.0 + 0.9 * push - 0.9 * e,
        1.0 + 0.9 * push - 0.9 * e,
      );
      legs(o, 0.35 * (1 - e), -0.35 * (1 - e), 0.35 * (1 - e) + 0.2 * push, 0.35 * (1 - e) + 0.2 * push);
      break;
    }
    case Anim.CELEBRATE: {
      if (variant % CELEBRATION_COUNT === 1) {
        // spin with arms out
        o[CH.twist] = TAU * ((u * 0.8) % 1);
        o[CH.squash] = 1 - 0.05 * Math.cos(TAU * 1.6 * u);
        arms(o, 0, 0, 1.55, 1.55);
        break;
      }
      if (variant % CELEBRATION_COUNT === 2) {
        // fist pump with one arm, knees bouncing
        const p = 0.5 + 0.5 * Math.sin(TAU * 2.2 * u);
        o[CH.squash] = 1 - 0.07 * (1 - p);
        o[CH.roll] = -0.08;
        arms(o, 0.3, 0.1, 1.6 + 1.3 * p, 0.35);
        break;
      }
      const h = Math.sin(TAU * 1.8 * t);
      o[CH.squash] = 1 + 0.1 * h;
      o[CH.lift] = 0.22 * Math.max(0, h);
      o[CH.twist] = 0.15 * Math.sin(TAU * 0.9 * t);
      const wave = 0.25 * Math.sin(TAU * 3.6 * t);
      arms(o, 0.15, 0.15, 2.6 + wave, 2.6 - wave);
      legs(o, 0.15 * Math.max(0, h), 0.15 * Math.max(0, h), 0.08, 0.08);
      break;
    }
    case Anim.IDLE:
    default: {
      const s = Math.sin(TAU * 0.45 * t);
      o[CH.squash] = 1 + 0.025 * Math.sin(TAU * 0.9 * t);
      o[CH.roll] = 0.02 * s;
      arms(o, 0.06 * s, -0.06 * s, 0.05, 0.05);
      // a fidget in some 4 s windows: look around (twist), bounce, arm sway
      const win = Math.floor(t / 4);
      const lt = t - win * 4;
      const w = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (lt - 0.4) / 3))));
      const kind = ((win * 2654435761) >>> 0) % 4;
      if (kind === 1) o[CH.twist] = 0.35 * w * Math.sin(TAU * ((lt - 0.4) / 3));
      else if (kind === 2) {
        const h = Math.sin(TAU * 2.2 * lt);
        o[CH.squash] += 0.07 * h * w;
        o[CH.lift] = 0.04 * Math.max(0, -h) * w;
      } else if (kind === 3) {
        const a = 0.6 * w * Math.sin(TAU * 1.1 * lt);
        o[CH.armLSwing] += a;
        o[CH.armRSwing] += a;
      }
      break;
    }
  }
}

const air = (a: number): boolean => a === Anim.JUMP || a === Anim.FALL;
const isAnim = (a: number): boolean => Number.isInteger(a) && a >= 0 && a < ANIM_COUNT;

/** Cross-fades Anim states and yields the blended pose. One per Wobbler. */
export class Animator {
  /** Blended pose, valid after update(). */
  readonly pose = new Float32Array(CHANNELS);
  readonly weights = new Float32Array(ANIM_COUNT);
  private readonly scratch = new Float32Array(CHANNELS);
  private readonly enteredAt = new Float32Array(ANIM_COUNT);
  private current: number = Anim.IDLE;
  private clock = 0;
  private stride = 0;
  private land = 9;
  private landAmp = 0;
  /** The celebration the next CELEBRATE plays (0..CELEBRATION_COUNT-1); advances after each one. */
  celebration = 0;
  private playing = 0;
  /** Smoothed run speed factor, so the gait eases in and out instead of snapping. */
  private kSmooth = 0;

  constructor() {
    this.weights[Anim.IDLE] = 1;
    neutral(this.pose);
  }

  get anim(): number {
    return this.current;
  }

  update(anim: number, speed: number, dt: number): Float32Array {
    if (isAnim(anim) && anim !== this.current) {
      if (air(this.current) && !air(anim) && anim !== Anim.DIVE) {
        this.land = 0;
        this.landAmp = this.current === Anim.FALL ? 1 : 0.7;
      }
      if (anim === Anim.CELEBRATE) {
        this.playing = this.celebration;
        this.celebration = (this.celebration + 1) % CELEBRATION_COUNT;
      }
      this.current = anim;
      this.enteredAt[anim] = this.clock;
    }
    const sp = Number.isFinite(speed) ? Math.abs(speed) : 0;
    const kTarget = Math.min(1.3, sp / PLAYER.runSpeed);
    this.kSmooth += (kTarget - this.kSmooth) * (1 - Math.exp(-10 * dt));
    const k = this.kSmooth;
    this.clock = (this.clock + dt) % 600;
    this.land += dt;
    this.stride = (this.stride + dt * TAU * (1.3 + 0.25 * Math.min(sp, 12))) % TAU;

    const w = this.weights;
    const step = dt / BLEND_SECONDS;
    let total = 0;
    for (let i = 0; i < ANIM_COUNT; i++) {
      w[i] = i === this.current ? Math.min(1, w[i] + step) : Math.max(0, w[i] - step);
      total += w[i];
    }

    let eased = 0;
    for (let i = 0; i < ANIM_COUNT; i++) eased += w[i]! * w[i]! * (3 - 2 * w[i]!);
    if (eased <= 0) eased = total;
    const pose = this.pose;
    pose.fill(0);
    for (let i = 0; i < ANIM_COUNT; i++) {
      if (w[i] <= 0) continue;
      // ease the cross-fade (smoothstep) so state changes start and settle softly
      const wi = w[i]! * w[i]! * (3 - 2 * w[i]!);
      // seconds since this state began (the clock wraps every 600 s)
      const since = (this.clock - this.enteredAt[i]! + 600) % 600;
      evalAnim(i, this.clock, this.stride, k, this.scratch, since, this.playing);
      const f = wi / eased;
      for (let c = 0; c < CHANNELS; c++) pose[c] += this.scratch[c] * f;
    }
    if (this.land < 0.6) {
      // landing squash with a springy overshoot
      const sq = this.landAmp * Math.exp(-this.land * 9) * Math.cos(this.land * 17);
      pose[CH.squash] -= 0.22 * sq;
      pose[CH.lift] -= 0.03 * Math.max(0, sq);
      pose[CH.armLRaise] += 0.3 * Math.max(0, sq);
      pose[CH.armRRaise] += 0.3 * Math.max(0, sq);
    }
    return pose;
  }
}
