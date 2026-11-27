// Colour helpers for the sanitizer and swatches. Pure, allocation-light, no DOM.
import type { Hex } from '../types.ts';

const HEX6 = /^#?([0-9a-fA-F]{6})$/;
const HEX3 = /^#?([0-9a-fA-F]{3})$/;

/** `#rgb`, `#rrggbb` or the same without `#` -> lower-case `#rrggbb`; anything else -> null. */
export function normalizeHex(value: unknown): Hex | null {
  if (typeof value !== 'string' || value.length > 9) return null;
  const s = value.trim();
  const six = HEX6.exec(s);
  if (six) return `#${six[1].toLowerCase()}`;
  const three = HEX3.exec(s);
  if (three) {
    const [r, g, b] = three[1].toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function channel(hex: Hex, i: number): number {
  const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** OKLab coordinates of a `#rrggbb` colour. L is 0..1. */
export function toOklab(hex: Hex): [number, number, number] {
  const r = channel(hex, 0);
  const g = channel(hex, 1);
  const b = channel(hex, 2);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual distance (Euclidean in OKLab). 0 = identical, 1 = black vs white. */
export function colorDistance(a: Hex, b: Hex): number {
  const p = toOklab(a);
  const q = toOklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
