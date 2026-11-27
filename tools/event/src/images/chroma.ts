// Sprites are generated on a flat chroma colour, then keyed out, despilled, trimmed and checked (#59).
import { distance } from './color.ts';
import type { Raw, Rgb } from './raw.ts';
import { createRaw } from './raw.ts';

export const CHROMA_KEYS = Object.freeze({ magenta: [255, 0, 255] as Rgb, green: [0, 255, 0] as Rgb });
export type ChromaName = keyof typeof CHROMA_KEYS;

/** The key farthest from every theme colour, so the sprite itself is not keyed away. */
export function pickChroma(palette: Rgb[]): ChromaName {
  const closest = (key: Rgb) => Math.min(Infinity, ...palette.map((c) => distance(c, key)));
  return closest(CHROMA_KEYS.magenta) >= closest(CHROMA_KEYS.green) ? 'magenta' : 'green';
}

/** Median colour of the outermost pixels: what the model really painted as background. */
export function borderColor(raw: Raw): Rgb {
  const { data, width, height } = raw;
  const channels: number[][] = [[], [], []];
  const take = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) channels[c].push(data[i + c]);
  };
  for (let x = 0; x < width; x++) {
    take(x, 0);
    take(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    take(0, y);
    take(width - 1, y);
  }
  return channels.map((v) => v.sort((a, b) => a - b)[v.length >> 1]) as Rgb;
}

/** Remove the key colour from edge pixels so no pink or green halo remains. */
function despill(rgb: Rgb, key: ChromaName): Rgb {
  const [r, g, b] = rgb;
  if (key === 'green') return [r, Math.min(g, Math.max(r, b)), b];
  const spill = Math.max(0, Math.min(r, b) - g);
  return [r - spill, g, b - spill];
}

/** Distance from the background below which a pixel is transparent, and above which it is opaque. */
export const KEY_RANGE = Object.freeze({ inner: 70, outer: 150 });

/** Turn the background colour transparent with a soft edge, despilling the partly transparent rim. */
export function keyOut(raw: Raw, key: ChromaName, background: Rgb): Raw {
  const { inner, outer } = KEY_RANGE;
  const out = createRaw(raw.width, raw.height);
  for (let i = 0; i < raw.data.length; i += 4) {
    let rgb: Rgb = [raw.data[i], raw.data[i + 1], raw.data[i + 2]];
    const d = distance(rgb, background);
    const alpha = Math.min(1, Math.max(0, (d - inner) / (outer - inner)));
    if (alpha === 0) continue;
    if (d < outer * 1.6) rgb = despill(rgb, key);
    out.data[i] = rgb[0];
    out.data[i + 1] = rgb[1];
    out.data[i + 2] = rgb[2];
    out.data[i + 3] = Math.round(alpha * raw.data[i + 3]);
  }
  return out;
}

/** Fraction of pixels that are mostly opaque. */
export function alphaCoverage(raw: Raw): number {
  let n = 0;
  for (let i = 3; i < raw.data.length; i += 4) if (raw.data[i] >= 128) n++;
  return n / (raw.width * raw.height);
}

/** Crop to the visible pixels. Returns null when nothing is visible. */
export function trim(raw: Raw, threshold = 24): Raw | null {
  let minX = raw.width;
  let minY = raw.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < raw.height; y++) {
    for (let x = 0; x < raw.width; x++) {
      if (raw.data[(y * raw.width + x) * 4 + 3] < threshold) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return null;
  const out = createRaw(maxX - minX + 1, maxY - minY + 1);
  for (let y = 0; y < out.height; y++) {
    const from = ((y + minY) * raw.width + minX) * 4;
    raw.data.copy(out.data, y * out.width * 4, from, from + out.width * 4);
  }
  return out;
}

export const COVERAGE = Object.freeze({ min: 0.04, max: 0.9, maxBackgroundDistance: 140 });

export type CutoutResult = { ok: true; image: Raw; coverage: number } | { ok: false; reason: string };

/** Key out the background and trim. Fails when the background is not the flat key, or the result is empty/solid. */
export function cutout(raw: Raw, key: ChromaName): CutoutResult {
  const background = borderColor(raw);
  if (distance(background, CHROMA_KEYS[key]) > COVERAGE.maxBackgroundDistance) {
    return { ok: false, reason: `the background is not flat ${key}` };
  }
  const keyed = keyOut(raw, key, background);
  const coverage = alphaCoverage(keyed);
  if (coverage < COVERAGE.min) return { ok: false, reason: 'the subject is missing or too small' };
  if (coverage > COVERAGE.max) return { ok: false, reason: 'the background could not be removed' };
  const image = trim(keyed);
  if (!image) return { ok: false, reason: 'nothing is left after keying' };
  return { ok: true, image, coverage };
}
