// Pure, DOM-free camera maths. Every integrator here is an exact closed-form solution over the
// step, so results do not depend on how a span of time is cut into frames (30, 60 or 144 Hz).
// Nothing allocates: state lives in caller-owned objects.

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number) {
  a = (a + Math.PI) % TAU;
  if (a <= 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed difference `to - from`, in (-PI, PI]. */
export function angleDelta(from: number, to: number) {
  return wrapAngle(to - from);
}

/** Smoothstep easing on [0, 1]. */
export function smoothstep(u: number) {
  u = clamp(u, 0, 1);
  return u * u * (3 - 2 * u);
}

/** Ease-in-out with zero velocity and acceleration at both ends (smootherstep). */
export function smootherstep(u: number) {
  u = clamp(u, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
}

/**
 * First-order exponential approach of `a` toward a target that moves linearly from `t0` to `t1`
 * during the step: a' = k (T(t) - a). Exact, so frame-rate independent.
 */
export function dampLinear(a: number, t0: number, t1: number, k: number, dt: number) {
  if (dt <= 0) return a;
  if (k <= 0) return a;
  const w = (t1 - t0) / dt;
  const lag = w / k;
  return t1 - lag + (a - t0 + lag) * Math.exp(-k * dt);
}

/** Exponential approach toward a fixed target (dampLinear with a constant target). */
export function damp(a: number, target: number, k: number, dt: number) {
  if (dt <= 0 || k <= 0) return a;
  return target + (a - target) * Math.exp(-k * dt);
}

/** Exponential approach of an angle toward a fixed target angle along the shortest arc. */
export function dampAngle(a: number, target: number, k: number, dt: number) {
  return wrapAngle(a + angleDelta(a, target) * (1 - Math.exp(-k * dt)));
}

export interface SpringState {
  x: number;
  v: number;
}

/**
 * Critically damped spring with angular frequency `omega`, tracking a target that moves linearly
 * from `t0` to `t1` during the step (velocity feed-forward, so a target moving at constant speed is
 * followed with no lag). Solves e'' + 2we' + w^2 e = 0 for e = x - T(t) exactly.
 * From rest toward a fixed target it never overshoots.
 */
export function stepSpring(s: SpringState, t0: number, t1: number, omega: number, dt: number) {
  if (dt <= 0) return;
  const u = (t1 - t0) / dt;
  const e0 = s.x - t0;
  const de0 = s.v - u;
  const c = de0 + omega * e0;
  const ex = Math.exp(-omega * dt);
  s.x = t1 + (e0 + c * dt) * ex;
  s.v = u + (de0 - omega * c * dt) * ex;
}

/** A 1-D critically damped spring resting at 0, kicked by velocity impulses (FOV kick, landing dip). */
export function stepImpulseSpring(s: SpringState, omega: number, dt: number) {
  stepSpring(s, 0, 0, omega, dt);
}

/**
 * Velocity impulse that makes a critically damped spring at rest peak at exactly `peak`.
 * The peak of x(t) = v t e^(-wt) is v / (w e), reached at t = 1/w.
 */
export function impulseForPeak(peak: number, omega: number) {
  return peak * omega * Math.E;
}
