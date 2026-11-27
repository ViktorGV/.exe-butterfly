// Seamless tiling: a seam metric, and a blend that removes the wrap-around seam (#59).
import type { Raw } from './raw.ts';
import { createRaw } from './raw.ts';

export type Axis = 'x' | 'y';

export interface SeamScore {
  /** Mean RGB difference (0..255) between the two pixels that meet where the image wraps. */
  seam: number;
  /** Mean RGB difference between neighbouring pixels inside the image, in the same direction. */
  interior: number;
  /** seam / interior. About 1 for a perfect tile; large when the edges do not match. */
  ratio: number;
}

/** A tile passes when its seam is close to ordinary pixel-to-pixel change, or tiny in absolute terms. */
export const SEAM_LIMIT = Object.freeze({ ratio: 2.5, absolute: 6 });

/** Compare the wrap-around neighbours (last and first column or row) with ordinary neighbours. */
export function seamScoreAxis(raw: Raw, axis: Axis): SeamScore {
  const { data, width, height } = raw;
  const length = axis === 'x' ? width : height;
  const lines = axis === 'x' ? height : width;
  const index = (pos: number, line: number) => (axis === 'x' ? line * width + pos : pos * width + line) * 4;
  const diff = (a: number, b: number) =>
    (Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2])) / 3;
  let seam = 0;
  let interior = 0;
  for (let line = 0; line < lines; line++) {
    seam += diff(index(length - 1, line), index(0, line));
    for (let pos = 1; pos < length; pos++) interior += diff(index(pos - 1, line), index(pos, line));
  }
  seam /= lines;
  interior /= lines * Math.max(1, length - 1);
  return { seam, interior, ratio: seam / Math.max(interior, 1) };
}

/** The direction with the larger visible seam. */
export function seamScore(raw: Raw): SeamScore {
  const x = seamScoreAxis(raw, 'x');
  const y = seamScoreAxis(raw, 'y');
  return x.seam >= y.seam ? x : y;
}

const passes = (s: SeamScore) => s.ratio <= SEAM_LIMIT.ratio || s.seam <= SEAM_LIMIT.absolute;

export function isSeamless(raw: Raw, axes: Axis[] = ['x', 'y']): boolean {
  return axes.every((axis) => passes(seamScoreAxis(raw, axis)));
}

const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * Remove the seam along one axis: blend the image with a copy offset by half. At the edges the offset copy
 * wins (its edge pixels are neighbours in the original, so they match); away from the edges the original is
 * untouched. `band` is the blended fraction on each side.
 */
export function blendSeam(raw: Raw, axis: Axis, band = 0.2): Raw {
  const { data, width, height } = raw;
  const out = createRaw(width, height);
  const length = axis === 'x' ? width : height;
  const half = length >> 1;
  const bandPx = Math.max(1, Math.round(length * band));
  const weights = new Float32Array(length);
  for (let p = 0; p < length; p++) weights[p] = smoothstep(Math.min(p, length - 1 - p) / bandPx);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = axis === 'x' ? x : y;
      const shifted = (pos + half) % length;
      const i = (y * width + x) * 4;
      const j = (axis === 'x' ? y * width + shifted : shifted * width + x) * 4;
      const w = weights[pos];
      for (let c = 0; c < 4; c++) out.data[i + c] = Math.round(data[i + c] * w + data[j + c] * (1 - w));
    }
  }
  return out;
}

/** Make a texture tile in both directions. A direction that already tiles is left alone. */
export function makeSeamless(raw: Raw): Raw {
  let out = raw;
  for (const axis of ['x', 'y'] as const) {
    const score = seamScoreAxis(out, axis);
    if (score.ratio > 1.8 && score.seam > 2) out = blendSeam(out, axis);
  }
  return out;
}
