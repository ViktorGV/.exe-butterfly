// Third-person follow camera (#6). DOM-free apart from the optional drag-to-orbit wiring, so the
// whole rig runs headless in tests against a THREE.PerspectiveCamera (or anything CameraLike).
//
// Rig: a critically damped spring carries a focus point (player feet + height + look-ahead in the
// direction of travel). The camera sits on a sphere around it at (yaw, pitch, distance) and aims a
// little above and ahead of it, so upcoming obstacles stay in view. Distance, pitch and FOV come
// from the viewport aspect (portrait pulls back and widens, see framing.ts).
import type { Vec3 } from '@wobble/shared/types';
import { DEFAULT_FRAMING, computeFraming, type Framing, type FramingOptions } from './framing.ts';
import {
  angleDelta,
  clamp,
  damp,
  dampLinear,
  impulseForPeak,
  smootherstep,
  smoothstep,
  stepImpulseSpring,
  stepSpring,
  wrapAngle,
  type SpringState,
} from './math.ts';
import { attachOrbitControls, type OrbitControls, type OrbitControlsOptions } from './orbitControls.ts';
import { sampleSpline } from './path.ts';

/** The parts of THREE.PerspectiveCamera the rig uses. */
export interface CameraLike {
  readonly position: { set(x: number, y: number, z: number): unknown };
  lookAt(x: number, y: number, z: number): void;
  fov: number;
  aspect: number;
  updateProjectionMatrix(): void;
}

/**
 * Something to spectate: a live object whose `pos` (and optionally `vel`) is updated in place, such
 * as a RemoteState or PlayerState, or a function that writes the position and returns false while
 * the target is unavailable (the camera then holds its last position).
 */
export type PositionProvider =
  { readonly pos: Readonly<Vec3>; readonly vel?: Readonly<Vec3> } | ((out: Vec3) => boolean);

export interface FollowCameraOptions {
  framing?: Partial<FramingOptions>;
  /** Spring frequency of the horizontal follow, rad/s. */
  followOmega?: number;
  /** Spring frequency of the vertical follow (softer, so jumps do not bounce the view), rad/s. */
  verticalOmega?: number;
  /** Focus height above the player's feet, metres. */
  focusHeight?: number;
  /** Look-ahead = horizontal velocity * this, seconds. */
  lookAheadTime?: number;
  maxLookAhead?: number;
  /** Aim point above the focus, metres. */
  aimHeight?: number;
  /** Aim point ahead of the focus, metres. */
  aimAhead?: number;
  /** Auto-rotation rate toward the direction of travel, 1/s. */
  autoRotateRate?: number;
  /** Horizontal speeds (m/s) where auto-rotation starts and reaches full rate. */
  autoRotateMinSpeed?: number;
  autoRotateFullSpeed?: number;
  /** After manual orbit, auto-rotation waits this long, then fades back in over manualBlendSec. */
  manualHoldSec?: number;
  manualBlendSec?: number;
  /** Rate at which pitch returns to the default once auto mode is back, 1/s. */
  pitchReturnRate?: number;
  pitchMin?: number;
  pitchMax?: number;
  /** Right-stick orbit speed at full deflection, rad/s. */
  lookSpeed?: number;
  /** Duration of the spectate hand-over blend, seconds. */
  handoverSec?: number;
  /** Target jumps faster than this (m/s) are treated as cuts, not motion. */
  teleportSpeed?: number;
  /** Peak FOV kick on dive, degrees. */
  diveFovKick?: number;
  /** Peak landing dip, metres. */
  landDip?: number;
  /** Disables the FOV kick and landing dip. Default: the prefers-reduced-motion media query (live). */
  reducedMotion?: boolean;
  /** Pointer events for drag-to-orbit. Default window when present; null for none. */
  orbitTarget?: EventTarget | null;
  /** Extra options for the drag-to-orbit wiring (sensitivity, width, blocking). */
  orbit?: Partial<Omit<OrbitControlsOptions, 'target' | 'onOrbit' | 'onDragChange'>>;
}

export const FOLLOW_DEFAULTS = {
  followOmega: 7,
  verticalOmega: 4.5,
  focusHeight: 1.1,
  lookAheadTime: 0.3,
  maxLookAhead: 2.5,
  aimHeight: 0.5,
  aimAhead: 1.5,
  autoRotateRate: 1.4,
  autoRotateMinSpeed: 0.8,
  autoRotateFullSpeed: 5,
  manualHoldSec: 1.4,
  manualBlendSec: 0.8,
  pitchReturnRate: 1.2,
  pitchMin: -0.1,
  pitchMax: 1.2,
  lookSpeed: 2.6,
  handoverSec: 0.9,
  teleportSpeed: 60,
  diveFovKick: 6,
  landDip: 0.2,
} as const;

/** Frame steps longer than this (tab resumed, hitch) are clamped, seconds. */
const MAX_DT = 0.25;
const KICK_OMEGA = 9;
const FRAMING_RATE = 4;

export interface FollowCamera {
  /** Call from the render callback with the interpolated local player position and velocity. */
  update(targetPos: Readonly<Vec3>, targetVel: Readonly<Vec3>, dt: number): void;
  /** Camera yaw for camera-relative movement: forward = (-sin yaw, 0, -cos yaw). */
  readonly yaw: number;
  /** Camera elevation above the focus, radians. */
  readonly pitch: number;
  /** Cut to a pose (respawn): no swoosh. The next update continues from here. */
  snapTo(pos: Readonly<Vec3>, yaw: number): void;
  /** Spectate a provider with a smooth hand-over; null returns to the update() target. */
  follow(provider: PositionProvider | null): void;
  readonly spectating: boolean;
  /** Fly through `points` over `ms`, ending exactly at the live follow pose. Resolves when done or cancelled. */
  playIntro(points: readonly Readonly<Vec3>[], ms: number): Promise<void>;
  cancelIntro(): void;
  readonly introPlaying: boolean;
  /** Manual orbit by deltas (radians). Pauses auto-rotation for a moment. */
  orbit(dYaw: number, dPitch: number): void;
  /** Right-stick style orbit rate, -1..1 each: x right turns right, y up looks up. */
  setLookAxis(x: number, y: number): void;
  /** Game-feel kicks: 'dive' widens the FOV briefly, 'land' dips the view (strength 0..1). */
  kick(kind: 'dive' | 'land', strength?: number): void;
  /** The smoothed focus point (handy for the audio listener). */
  readonly focus: Readonly<Vec3>;
  dispose(): void;
}

function reducedMotionQuery(): { matches: boolean } | null {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  if (typeof mm !== 'function') return null;
  try {
    return mm('(prefers-reduced-motion: reduce)');
  } catch {
    return null;
  }
}

export function createFollowCamera(camera: CameraLike, options: FollowCameraOptions = {}): FollowCamera {
  const o = { ...FOLLOW_DEFAULTS, ...options };
  const framingOpts: FramingOptions = { ...DEFAULT_FRAMING, ...options.framing };
  const motionQuery = options.reducedMotion === undefined ? reducedMotionQuery() : null;
  const reduced = () => options.reducedMotion ?? motionQuery?.matches ?? false;

  const framing: Framing = { fov: 0, distance: 0, pitch: 0, ahead: 0 };
  computeFraming(camera.aspect, framingOpts, framing);
  let fov = framing.fov;
  let distance = framing.distance;
  let ahead = framing.ahead;
  let pitchBase = framing.pitch;

  let yaw = 0;
  let pitch = framing.pitch;
  let manualTimer = Number.POSITIVE_INFINITY;
  let dragging = false;
  let lookX = 0;
  let lookY = 0;
  let prevHeading = 0;
  let hasHeading = false;

  const sx: SpringState = { x: 0, v: 0 };
  const sy: SpringState = { x: 0, v: 0 };
  const sz: SpringState = { x: 0, v: 0 };
  const prevGoal: Vec3 = [0, 0, 0];
  const goal: Vec3 = [0, 0, 0];
  const focus: Vec3 = [0, 0, 0];
  let hasGoal = false;

  const fovKick: SpringState = { x: 0, v: 0 };
  const dip: SpringState = { x: 0, v: 0 };
  let appliedFov = Number.NaN;

  // Spectate state.
  let provider: PositionProvider | null = null;
  const srcPos: Vec3 = [0, 0, 0];
  const srcVel: Vec3 = [0, 0, 0];
  const provPrev: Vec3 = [0, 0, 0];
  const provVel: Vec3 = [0, 0, 0];
  let provHasPrev = false;
  let handover = -1;
  const handFrom: Vec3 = [0, 0, 0];

  // Intro state.
  let introPts: Vec3[] = [];
  let introCount = 0;
  let introMs = 0;
  let introElapsed = 0;
  let introResolve: (() => void) | null = null;
  const introEnd: Vec3 = [0, 0, 0];
  const introPos: Vec3 = [0, 0, 0];
  const introLook: Vec3 = [0, 0, 0];

  const rigPos: Vec3 = [0, 0, 0];
  const rigLook: Vec3 = [0, 0, 0];

  function syncFocus() {
    focus[0] = sx.x;
    focus[1] = sy.x;
    focus[2] = sz.x;
  }

  function computeRig() {
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const d = distance;
    rigPos[0] = sx.x - fx * d * cp;
    rigPos[1] = sy.x + d * sp + dip.x;
    rigPos[2] = sz.x - fz * d * cp;
    const a = o.aimAhead + ahead;
    rigLook[0] = sx.x + fx * a;
    rigLook[1] = sy.x + o.aimHeight + dip.x;
    rigLook[2] = sz.x + fz * a;
  }

  function apply(pos: Readonly<Vec3>, look: Readonly<Vec3>) {
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.lookAt(look[0], look[1], look[2]);
    const f = fov + fovKick.x;
    if (!(Math.abs(f - appliedFov) <= 1e-4)) {
      appliedFov = f;
      camera.fov = f;
      camera.updateProjectionMatrix();
    }
  }

  function readSource(targetPos: Readonly<Vec3>, targetVel: Readonly<Vec3>, dt: number) {
    if (!provider) {
      srcPos[0] = targetPos[0];
      srcPos[1] = targetPos[1];
      srcPos[2] = targetPos[2];
      srcVel[0] = targetVel[0];
      srcVel[1] = targetVel[1];
      srcVel[2] = targetVel[2];
      return;
    }
    let ok = true;
    let vel: Readonly<Vec3> | undefined;
    if (typeof provider === 'function') ok = provider(srcPos);
    else {
      srcPos[0] = provider.pos[0];
      srcPos[1] = provider.pos[1];
      srcPos[2] = provider.pos[2];
      vel = provider.vel;
    }
    if (!ok) {
      // Target gone for now: hold where we were.
      srcPos[0] = provPrev[0];
      srcPos[1] = provPrev[1];
      srcPos[2] = provPrev[2];
      srcVel[0] = srcVel[1] = srcVel[2] = 0;
      return;
    }
    if (vel) {
      srcVel[0] = vel[0];
      srcVel[1] = vel[1];
      srcVel[2] = vel[2];
    } else if (provHasPrev && dt > 0) {
      for (let i = 0; i < 3; i++) {
        let v = (srcPos[i] - provPrev[i]) / dt;
        if (Math.abs(v) > o.teleportSpeed) v = 0;
        provVel[i] = damp(provVel[i], v, 10, dt);
        srcVel[i] = provVel[i];
      }
    } else {
      srcVel[0] = srcVel[1] = srcVel[2] = 0;
    }
    provPrev[0] = srcPos[0];
    provPrev[1] = srcPos[1];
    provPrev[2] = srcPos[2];
    provHasPrev = true;
  }

  function computeGoal() {
    const vx = srcVel[0];
    const vz = srcVel[2];
    let lx = vx * o.lookAheadTime;
    let lz = vz * o.lookAheadTime;
    const len = Math.hypot(lx, lz);
    if (len > o.maxLookAhead) {
      const s = o.maxLookAhead / len;
      lx *= s;
      lz *= s;
    }
    goal[0] = srcPos[0] + lx;
    goal[1] = srcPos[1] + o.focusHeight;
    goal[2] = srcPos[2] + lz;
  }

  function stepAngles(dt: number) {
    if (lookX !== 0 || lookY !== 0) {
      yaw = wrapAngle(yaw - lookX * o.lookSpeed * dt);
      pitch = clamp(pitch - lookY * o.lookSpeed * dt, o.pitchMin, o.pitchMax);
      manualTimer = 0;
    }
    if (dragging) manualTimer = 0;
    else manualTimer += dt;
    const auto = o.manualBlendSec > 0 ? smoothstep((manualTimer - o.manualHoldSec) / o.manualBlendSec) : 1;
    const vx = srcVel[0];
    const vz = srcVel[2];
    const speed = Math.hypot(vx, vz);
    const span = Math.max(1e-6, o.autoRotateFullSpeed - o.autoRotateMinSpeed);
    const speedK = smoothstep((speed - o.autoRotateMinSpeed) / span);
    const heading = Math.atan2(-vx, -vz);
    if (auto > 0 && speedK > 0) {
      // Running back toward the camera: do not spin the view around.
      const h1 = yaw + angleDelta(yaw, heading);
      const off = Math.abs(h1 - yaw);
      const backK = smoothstep((2.7 - off) / 0.6);
      // The heading is treated as turning linearly over the frame (exact, so frame-rate independent).
      const h0 = hasHeading ? h1 + angleDelta(heading, prevHeading) : h1;
      yaw = wrapAngle(dampLinear(yaw, h0, h1, o.autoRotateRate * auto * speedK * backK, dt));
    }
    prevHeading = heading;
    hasHeading = speedK > 0;
    if (auto > 0) pitch = damp(pitch, pitchBase, o.pitchReturnRate * auto, dt);
  }

  function finishIntro() {
    introCount = 0;
    const r = introResolve;
    introResolve = null;
    r?.();
  }

  const orbitControls: OrbitControls | null = (() => {
    const target =
      options.orbitTarget === undefined
        ? ((globalThis as { window?: EventTarget }).window ?? null)
        : options.orbitTarget;
    if (!target) return null;
    return attachOrbitControls({
      ...options.orbit,
      target,
      onOrbit: (dy, dp) => api.orbit(dy, dp),
      onDragChange: (d) => {
        dragging = d;
        if (d) manualTimer = 0;
      },
    });
  })();

  const api: FollowCamera = {
    get yaw() {
      return yaw;
    },
    get pitch() {
      return pitch;
    },
    get focus() {
      return focus;
    },
    get spectating() {
      return provider !== null;
    },
    get introPlaying() {
      return introCount > 0;
    },

    update(targetPos, targetVel, dtIn) {
      const dt = dtIn > 0 ? Math.min(dtIn, MAX_DT) : 0;
      readSource(targetPos, targetVel, dt);

      computeFraming(camera.aspect, framingOpts, framing);
      fov = damp(fov, framing.fov, FRAMING_RATE, dt);
      distance = damp(distance, framing.distance, FRAMING_RATE, dt);
      ahead = damp(ahead, framing.ahead, FRAMING_RATE, dt);
      pitchBase = framing.pitch;

      stepAngles(dt);
      computeGoal();

      if (handover >= 0) {
        handover += dt;
        const k = smootherstep(handover / o.handoverSec);
        for (let i = 0; i < 3; i++) goal[i] = handFrom[i] + (goal[i] - handFrom[i]) * k;
        if (k >= 1) handover = -1;
      }

      if (!hasGoal) {
        sx.x = goal[0];
        sy.x = goal[1];
        sz.x = goal[2];
        sx.v = sy.v = sz.v = 0;
        prevGoal[0] = goal[0];
        prevGoal[1] = goal[1];
        prevGoal[2] = goal[2];
        hasGoal = true;
      } else if (dt > 0) {
        const jump = Math.hypot(goal[0] - prevGoal[0], goal[1] - prevGoal[1], goal[2] - prevGoal[2]);
        if (jump > o.teleportSpeed * dt) {
          // A cut, not motion: no velocity feed-forward (snapTo is the way to cut the camera too).
          prevGoal[0] = goal[0];
          prevGoal[1] = goal[1];
          prevGoal[2] = goal[2];
        }
        stepSpring(sx, prevGoal[0], goal[0], o.followOmega, dt);
        stepSpring(sy, prevGoal[1], goal[1], o.verticalOmega, dt);
        stepSpring(sz, prevGoal[2], goal[2], o.followOmega, dt);
        prevGoal[0] = goal[0];
        prevGoal[1] = goal[1];
        prevGoal[2] = goal[2];
      }
      syncFocus();

      stepImpulseSpring(fovKick, KICK_OMEGA, dt);
      stepImpulseSpring(dip, KICK_OMEGA, dt);

      computeRig();

      if (introCount > 0) {
        introElapsed += dt * 1000;
        const u = introElapsed / introMs;
        if (u >= 1) {
          finishIntro();
          apply(rigPos, rigLook);
          return;
        }
        introEnd[0] = rigPos[0];
        introEnd[1] = rigPos[1];
        introEnd[2] = rigPos[2];
        const e = smootherstep(u);
        sampleSpline(introPts, introCount, e, introPos);
        // Look a little further along the path, handing over to the follow aim point.
        sampleSpline(introPts, introCount, Math.min(1, e + 0.12), introLook);
        const w = smootherstep(u);
        for (let i = 0; i < 3; i++) introLook[i] += (rigLook[i] - introLook[i]) * w;
        apply(introPos, introLook);
        return;
      }

      apply(rigPos, rigLook);
    },

    snapTo(pos, newYaw) {
      computeFraming(camera.aspect, framingOpts, framing);
      fov = framing.fov;
      distance = framing.distance;
      ahead = framing.ahead;
      pitchBase = framing.pitch;
      pitch = framing.pitch;
      yaw = wrapAngle(newYaw);
      manualTimer = Number.POSITIVE_INFINITY;
      handover = -1;
      sx.x = prevGoal[0] = pos[0];
      sy.x = prevGoal[1] = pos[1] + o.focusHeight;
      sz.x = prevGoal[2] = pos[2];
      sx.v = sy.v = sz.v = 0;
      fovKick.x = fovKick.v = dip.x = dip.v = 0;
      provVel[0] = provVel[1] = provVel[2] = 0;
      provHasPrev = false;
      hasHeading = false;
      hasGoal = true;
      syncFocus();
      computeRig();
      if (introCount === 0) apply(rigPos, rigLook);
    },

    follow(next) {
      if (next === provider) return;
      provider = next;
      provHasPrev = false;
      hasHeading = false;
      provVel[0] = provVel[1] = provVel[2] = 0;
      if (!hasGoal) return;
      handFrom[0] = prevGoal[0] = sx.x;
      handFrom[1] = prevGoal[1] = sy.x;
      handFrom[2] = prevGoal[2] = sz.x;
      handover = 0;
    },

    playIntro(points, ms) {
      finishIntro();
      if (points.length === 0 || !(ms > 0)) return Promise.resolve();
      // Copied once per intro (not per frame). The last control point is the live follow pose,
      // rewritten every frame, so the flight lands exactly where the follow camera is.
      introPts = points.map((p) => [p[0], p[1], p[2]] as Vec3);
      introPts.push(introEnd);
      const n = introPts.length;
      computeRig();
      introEnd[0] = rigPos[0];
      introEnd[1] = rigPos[1];
      introEnd[2] = rigPos[2];
      introCount = n;
      introMs = ms;
      introElapsed = 0;
      return new Promise<void>((resolve) => {
        introResolve = resolve;
      });
    },

    cancelIntro() {
      finishIntro();
    },

    orbit(dYaw, dPitch) {
      yaw = wrapAngle(yaw + dYaw);
      pitch = clamp(pitch + dPitch, o.pitchMin, o.pitchMax);
      manualTimer = 0;
    },

    setLookAxis(x, y) {
      lookX = clamp(x, -1, 1);
      lookY = clamp(y, -1, 1);
    },

    kick(kind, strength = 1) {
      if (reduced()) return;
      const s = clamp(strength, 0, 1);
      if (kind === 'dive') fovKick.v += impulseForPeak(o.diveFovKick * s, KICK_OMEGA);
      else dip.v -= impulseForPeak(o.landDip * s, KICK_OMEGA);
    },

    dispose() {
      orbitControls?.dispose();
      finishIntro();
    },
  };

  return api;
}
