// Accent colour and HUD font helpers. Pure.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parses "#rgb" or "#rrggbb" (the # is optional). Returns null for anything else. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mixes toward black (amount < 0) or white (amount > 0); amount in -1..1. */
export function shade(rgb: Rgb, amount: number): Rgb {
  const target = amount < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(amount));
  return {
    r: rgb.r + (target - rgb.r) * k,
    g: rgb.g + (target - rgb.g) * k,
    b: rgb.b + (target - rgb.b) * k,
  };
}

/** WCAG relative luminance, 0..1. */
export function luminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export const INK_DARK = '#1d1b2f';
export const INK_LIGHT = '#ffffff';

/** The text colour (dark ink or white) with the better contrast on `rgb`. */
export function inkOn(rgb: Rgb): string {
  const l = luminance(rgb);
  const darkL = luminance(parseHex(INK_DARK) as Rgb);
  const contrastDark = (l + 0.05) / (darkL + 0.05);
  const contrastLight = 1.05 / (l + 0.05);
  return contrastDark >= contrastLight ? INK_DARK : INK_LIGHT;
}

/** CSS variables for an accent colour, or null if the hex is invalid. */
export function accentVars(
  hex: string,
): Record<'--accent' | '--accent-dark' | '--accent-light' | '--accent-ink', string> | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return {
    '--accent': toHex(rgb),
    '--accent-dark': toHex(shade(rgb, -0.3)),
    '--accent-light': toHex(shade(rgb, 0.6)),
    '--accent-ink': inkOn(rgb),
  };
}

/** The five bundled HUD font styles (#54). System font stacks: nothing is downloaded. */
export const HUD_FONTS = Object.freeze({
  rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Varela Round", system-ui, sans-serif',
  blocky: '"Arial Black", "Helvetica Neue", Impact, system-ui, sans-serif',
  handwritten: '"Comic Sans MS", "Chalkboard SE", "Segoe Print", "Bradley Hand", cursive',
  pixel: 'ui-monospace, "Courier New", "Lucida Console", monospace',
  serif: 'Georgia, "Times New Roman", ui-serif, serif',
} as const);

export type HudFont = keyof typeof HUD_FONTS;

export function hudFontStack(name: string): string | null {
  return Object.hasOwn(HUD_FONTS, name) ? HUD_FONTS[name as HudFont] : null;
}
