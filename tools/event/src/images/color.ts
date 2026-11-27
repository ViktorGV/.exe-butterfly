// Colour maths for palette matching (images) and legibility checks (themes) (#59).
import type { Raw, Rgb } from './raw.ts';
import { createRaw } from './raw.ts';

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb: Rgb): string {
  const part = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${rgb.map(part).join('')}`;
}

/** Linear blend of two hex colours; `t` = 0 gives `a`, 1 gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t) as Rgb);
}

/** Plain Euclidean RGB distance, 0..441. */
export function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** CIELAB (D65). */
export function rgbToLab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIE76 colour difference between two hex colours. About 2 is barely visible; 30 is clearly different. */
export function deltaE(a: string, b: string): number {
  const x = rgbToLab(hexToRgb(a));
  const y = rgbToLab(hexToRgb(b));
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** Alpha-weighted mean colour. */
export function averageColor(raw: Raw): Rgb {
  const sum: Rgb = [0, 0, 0];
  let weight = 0;
  for (let i = 0; i < raw.data.length; i += 4) {
    const a = raw.data[i + 3];
    for (let c = 0; c < 3; c++) sum[c] += raw.data[i + c] * a;
    weight += a;
  }
  return weight ? (sum.map((v) => v / weight) as Rgb) : [0, 0, 0];
}

export const PALETTE_SHIFT = Object.freeze({ threshold: 110, strength: 0.6 });

/** If the average colour is far from every palette colour, move all pixels part of the way to the nearest one. */
export function shiftToPalette(raw: Raw, palette: Rgb[]): Raw {
  if (!palette.length) return raw;
  const average = averageColor(raw);
  const nearest = palette.reduce((best, c) => (distance(average, c) < distance(average, best) ? c : best));
  const d = distance(average, nearest);
  if (d <= PALETTE_SHIFT.threshold) return raw;
  // Only close part of the gap beyond the threshold, so images just over it barely change.
  const k = PALETTE_SHIFT.strength * (1 - PALETTE_SHIFT.threshold / d);
  const offset = nearest.map((v, c) => (v - average[c]) * k);
  const out = createRaw(raw.width, raw.height);
  for (let i = 0; i < raw.data.length; i += 4) {
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.min(255, Math.max(0, Math.round(raw.data[i + c] + offset[c])));
    out.data[i + 3] = raw.data[i + 3];
  }
  return out;
}
