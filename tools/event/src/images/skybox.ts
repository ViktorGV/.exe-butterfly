// Equirectangular skybox fixes: join the left and right edges, and collapse each pole to one colour (#59).
import type { Raw } from './raw.ts';
import { createRaw } from './raw.ts';

/**
 * In an equirectangular image the whole top row is a single point (and so is the bottom row), so rows near a
 * pole fade into their average colour. `band` is the blended fraction of the height at each pole.
 */
export function blendPoles(raw: Raw, band = 0.18): Raw {
  const { data, width, height } = raw;
  const out = createRaw(width, height);
  data.copy(out.data);
  const rows = Math.max(1, Math.round(height * band));
  for (const bottom of [false, true]) {
    const sample = Math.max(1, rows >> 2);
    const mean = [0, 0, 0];
    for (let r = 0; r < sample; r++) {
      const y = bottom ? height - 1 - r : r;
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 3; c++) mean[c] += data[(y * width + x) * 4 + c];
      }
    }
    for (let c = 0; c < 3; c++) mean[c] /= sample * width;
    for (let r = 0; r < rows; r++) {
      const y = bottom ? height - 1 - r : r;
      const t = r / rows;
      const keep = t * t * (3 - 2 * t);
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(data[i + c] * keep + mean[c] * (1 - keep));
      }
    }
  }
  return out;
}

export function fixSkybox(raw: Raw): Raw {
  // The game mirrors the panorama behind the course, so its left and right edges never meet: no seam blend.
  return blendPoles(raw, 0.08);
}
