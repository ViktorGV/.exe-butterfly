// Wobbler proportions (#8). Body-local space: origin at the feet, Y up, the face looks toward -Z.
// At height = girth = 1 the figure is 1.12 m tall and 0.39 m in radius, so even at the cosmetic maximum
// (1.15) it stays inside the 0.45 m x 1.3 m player capsule.
import type { Vec3 } from '@wobble/shared/types';
import type { AnchorName } from './skin.ts';

/**
 * Drop body: a wide, round bottom that sits low, and a top that narrows to a soft point, like a
 * droplet of jelly. Deliberately not a bean or capsule: the widest point is low and the top is pointed.
 */
export const BODY = Object.freeze({
  bottom: 0.09,
  top: 1.12,
  centerY: 0.4,
  radius: 0.39,
  /** cos(theta)^squareness for the bottom: < 1 makes it chunkier than an ellipse. */
  squareness: 0.75,
  /** (1 - s^2)^tip for the top: 1 is a cone-like point, higher draws the tip out further. */
  tip: 1.2,
});

/** Height the body tilts around for dives and prone poses. */
export const PIVOT_Y = 0.45;

function heightAt(sin: number): number {
  return sin < 0 ? BODY.centerY - BODY.bottom : BODY.top - BODY.centerY;
}

/** Body radius at profile angle theta in [-pi/2, pi/2]. */
export function radiusAtTheta(theta: number): number {
  const s = Math.sin(theta);
  if (s > 0) return BODY.radius * Math.pow(Math.max(0, 1 - s * s), BODY.tip);
  return BODY.radius * Math.pow(Math.max(0, Math.cos(theta)), BODY.squareness);
}

export function yAtTheta(theta: number): number {
  const s = Math.sin(theta);
  return BODY.centerY + heightAt(s) * s;
}

/** Body radius at height y (0 outside the body). */
export function bodyRadiusAt(y: number): number {
  const rel = y - BODY.centerY;
  const s = rel / heightAt(rel);
  if (s <= -1 || s >= 1) return 0;
  return radiusAtTheta(Math.asin(s));
}

/** d(radius)/dy, numerically. */
export function bodySlopeAt(y: number): number {
  const h = 0.002;
  return (bodyRadiusAt(y + h) - bodyRadiusAt(y - h)) / (2 * h);
}

/** Where accessory prims are attached, body-local (before cosmetic height/girth scaling). */
export const ANCHOR_POS: Readonly<Record<AnchorName, Vec3>> = Object.freeze({
  // A little below the tip, so hats sit over the point instead of balancing on it.
  headTop: [0, BODY.top - 0.1, 0],
  face: [0, 0.64, -bodyRadiusAt(0.64)],
  back: [0, 0.5, bodyRadiusAt(0.5)],
  waist: [0, 0.28, 0],
});

/** Face layout: arc-length offsets on the front of the body. Big eyes, set wide, low on the drop. */
export const FACE = Object.freeze({
  eyeY: 0.63,
  eyeX: 0.14,
  eyeScale: 1.65,
  mouthScale: 1.1,
  mouthY: 0.48,
  cheekY: 0.52,
  cheekX: 0.24,
  bellyY: 0.24,
  bellyRx: 0.2,
  bellyRy: 0.13,
});

/**
 * Limb rig: shoulder / hip pivots and limb sizes (width, length, depth). Limbs hang toward -Y.
 * Thin noodle arms from the widest point and short, wide feet, instead of stubby mitten limbs.
 */
export const LIMBS = Object.freeze({
  shoulderX: 0.33,
  shoulderY: 0.46,
  armSize: [0.08, 0.36, 0.08] as Vec3,
  armSplay: 0.2,
  hipX: 0.15,
  hipY: 0.14,
  legSize: [0.18, 0.15, 0.26] as Vec3,
});
