// How theme v2 scales with the engine quality preset (#64). Pure.
import type { ImageRef } from '@wobble/shared/types';
import type { QualityPreset } from '../../engine/quality.ts';

export interface ThemeQuality {
  /** Texture resolution factor; < 1 picks `lowSrc` (or decodes at that scale). */
  textureScale: number;
  particleScale: number;
  decorScale: number;
  /** Upper bound for anisotropic filtering. */
  anisotropy: number;
}

export const THEME_QUALITY: Readonly<Record<QualityPreset, Readonly<ThemeQuality>>> = Object.freeze({
  low: Object.freeze({ textureScale: 0.5, particleScale: 0.35, decorScale: 0.5, anisotropy: 1 }),
  medium: Object.freeze({ textureScale: 1, particleScale: 0.7, decorScale: 0.8, anisotropy: 4 }),
  high: Object.freeze({ textureScale: 1, particleScale: 1, decorScale: 1, anisotropy: 8 }),
});

/** Particles per system at density 1 on high. */
export const MAX_PARTICLES = 2400;
/** Instances per decor entry at density 1 on high. */
export const MAX_DECOR_INSTANCES = 80;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function particleCount(density: number, q: ThemeQuality): number {
  return Math.round(MAX_PARTICLES * clamp01(density) * q.particleScale);
}

export function decorCount(density: number, q: ThemeQuality): number {
  return Math.round(MAX_DECOR_INSTANCES * clamp01(density) * q.decorScale);
}

/** File to load for an image at this quality, and the decode scale still to apply. */
export function pickImage(ref: ImageRef, q: ThemeQuality): { src: string; scale: number } {
  if (q.textureScale < 1 && ref.lowSrc) return { src: ref.lowSrc, scale: 1 };
  return { src: ref.src, scale: q.textureScale };
}
