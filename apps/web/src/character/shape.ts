// Wobbler proportions (#8). Body-local space: origin at the feet, Y up, the face looks toward -Z.
// At height = girth = 1 the figure is 1.10 m tall and 0.37 m in radius, so even at the cosmetic maximum
// (1.15) it stays inside the 0.45 m x 1.3 m player capsule.
import type { Vec3 } from '@wobble/shared/types';
import type { AnchorName } from './skin.ts';

/** Gumdrop body: a short round bottom half and a taller, slightly narrower dome. */
export const BODY = Object.freeze({
  bottom: 0.16,
  top: 1.1,
  centerY: 0.48,
  radius: 0.37,
  /** How much narrower the dome is at its top than the belly. */
  taper: 0.045,
  /** cos(theta)^squareness: < 1 makes the silhouette chunkier than an ellipse. */
  squareness: 0.6,
});

/** Height the body tilts around for dives and prone poses. */
export const PIVOT_Y = 0.55;

function heightAt(sin: number): number {
  return sin < 0 ? BODY.centerY - BODY.bottom : BODY.top - BODY.centerY;
}

/** Body radius at profile angle theta in [-pi/2, pi/2]. */
export function radiusAtTheta(theta: number): number {
  const s = Math.sin(theta);
  const c = Math.max(0, Math.cos(theta));
  return (BODY.radius - BODY.taper * Math.max(0, s)) * Math.pow(c, BODY.squareness);
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
  headTop: [0, BODY.top - 0.02, 0],
  face: [0, 0.8, -bodyRadiusAt(0.8)],
  back: [0, 0.62, bodyRadiusAt(0.62)],
  waist: [0, 0.36, 0],
});

/** Face layout: arc-length offsets on the front of the body. */
export const FACE = Object.freeze({
  eyeY: 0.82,
  eyeX: 0.125,
  eyeScale: 1.35,
  mouthScale: 1.2,
  mouthY: 0.68,
  cheekY: 0.72,
  cheekX: 0.2,
  bellyY: 0.42,
  bellyRx: 0.21,
  bellyRy: 0.19,
});

/** Limb rig: shoulder / hip pivots and limb sizes (width, length, depth). Limbs hang toward -Y. */
export const LIMBS = Object.freeze({
  shoulderX: 0.285,
  shoulderY: 0.66,
  armSize: [0.15, 0.3, 0.15] as Vec3,
  armSplay: 0.3,
  hipX: 0.155,
  hipY: 0.25,
  legSize: [0.19, 0.245, 0.21] as Vec3,
});
