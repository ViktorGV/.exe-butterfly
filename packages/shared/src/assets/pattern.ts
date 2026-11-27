// Pattern rasteriser (#16): draws a seamless square tile through the Canvas 2D interface only.
// Every motif repeats a whole number of times across the tile, and anything that crosses an edge
// is drawn again on the opposite side, so the tile wraps without a seam.
import type { Hex, Pattern, TileShape } from '../types.ts';
import { sanitizePattern } from './sanitize.ts';

/** The subset of the Canvas 2D API that drawPattern may use. */
export type PatternContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'fillRect'
  | 'beginPath'
  | 'arc'
  | 'rect'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'fill'
  | 'save'
  | 'restore'
  | 'translate'
  | 'rotate'
>;

/** Largest tile drawPattern will draw, in pixels. */
export const PATTERN_MAX_PX = 256;

/** Motif repeats per tile for geometric patterns: scale 1 = 4, scale 0.25 = 16, scale 4 = 1. */
export const patternRepeats = (scale: number): number => Math.min(16, Math.max(1, Math.round(4 / scale)));
/** Motif repeats per tile for custom patterns: scale >= 0.75 = 1, down to 4 at scale 0.25. */
export const customRepeats = (scale: number): number => Math.min(4, Math.max(1, Math.round(1 / scale)));

const WAVE_STEPS = 8;

function band(ctx: PatternContext, s: number, n: number, y0: number, h: number, wave: boolean): void {
  const period = s / n;
  const amp = h / 2;
  const edge = (x: number): number => {
    const t = (x % period) / period;
    return wave ? Math.sin(t * Math.PI * 2) * amp : (Math.abs(t - 0.5) * 2 - 0.5) * amp * 2;
  };
  const steps = n * (wave ? WAVE_STEPS : 2);
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const x = (s * i) / steps;
    if (i === 0) ctx.moveTo(x, y0 + edge(x));
    else ctx.lineTo(x, y0 + edge(x));
  }
  for (let i = steps; i >= 0; i--) {
    const x = (s * i) / steps;
    ctx.lineTo(x, y0 + h + edge(x));
  }
  ctx.closePath();
  ctx.fill();
}

function bands(ctx: PatternContext, s: number, p: Pattern, wave: boolean): void {
  const n = patternRepeats(p.scale);
  const k = p.colors.length > 1 ? p.colors.length : 2;
  const h = s / (n * k);
  for (let i = -1; i <= n * k; i++) {
    const idx = ((i % k) + k) % k;
    if (idx === 0) continue;
    ctx.fillStyle = p.colors[idx] ?? '#ffffff';
    band(ctx, s, n, i * h, h, wave);
  }
}

function stripes(ctx: PatternContext, s: number, p: Pattern): void {
  // 45-degree stripes: each band shifts by exactly one tile over the tile height.
  const n = patternRepeats(p.scale);
  const k = Math.max(2, p.colors.length);
  const w = s / (n * k);
  for (let i = -1; i < 2 * n * k; i++) {
    const idx = ((i % k) + k) % k;
    if (idx === 0) continue;
    ctx.fillStyle = p.colors[idx] ?? '#ffffff';
    const x0 = i * w;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + w, 0);
    ctx.lineTo(x0 + w - s, s);
    ctx.lineTo(x0 - s, s);
    ctx.closePath();
    ctx.fill();
  }
}

function dots(ctx: PatternContext, s: number, p: Pattern): void {
  const n = patternRepeats(p.scale);
  const cell = s / n;
  const a = p.colors[1] ?? '#ffffff';
  const b = p.colors[2] ?? a;
  for (const [ox, oy, color] of [
    [0.25, 0.25, a],
    [0.75, 0.75, b],
  ] as [number, number, Hex][]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cx = (i + ox) * cell;
        const cy = (j + oy) * cell;
        ctx.moveTo(cx + cell * 0.18, cy);
        ctx.arc(cx, cy, cell * 0.18, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
}

function checker(ctx: PatternContext, s: number, p: Pattern): void {
  const cells = patternRepeats(p.scale) * 2;
  const c = s / cells;
  ctx.fillStyle = p.colors[1] ?? '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) if ((i + j) % 2 === 1) ctx.rect(i * c, j * c, c, c);
  ctx.fill();
  if (p.colors[2]) {
    ctx.fillStyle = p.colors[2];
    ctx.beginPath();
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) if ((i + j) % 2 === 0) ctx.rect((i + 0.35) * c, (j + 0.35) * c, c * 0.3, c * 0.3);
    }
    ctx.fill();
  }
}

/** Radius (unit square) of the circle that contains a tile shape. */
function reach(t: TileShape): number {
  if (t.kind === 'circle') return t.r ?? 0;
  if (t.kind === 'rect') return Math.hypot(t.w ?? 0, t.h ?? 0) / 2;
  return Math.max(0, ...(t.points ?? []).map(([x, y]) => Math.hypot(x, y)));
}

function shape(ctx: PatternContext, t: TileShape, cx: number, cy: number, unit: number): void {
  ctx.fillStyle = t.fill;
  ctx.save();
  ctx.translate(cx, cy);
  if (t.rot) ctx.rotate(t.rot);
  ctx.beginPath();
  if (t.kind === 'circle') ctx.arc(0, 0, (t.r ?? 0) * unit, 0, Math.PI * 2);
  else if (t.kind === 'rect')
    ctx.rect((-(t.w ?? 0) / 2) * unit, (-(t.h ?? 0) / 2) * unit, (t.w ?? 0) * unit, (t.h ?? 0) * unit);
  else {
    (t.points ?? []).forEach(([x, y], i) =>
      i === 0 ? ctx.moveTo(x * unit, y * unit) : ctx.lineTo(x * unit, y * unit),
    );
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

function custom(ctx: PatternContext, s: number, p: Pattern): void {
  const n = customRepeats(p.scale);
  const unit = s / n;
  for (const t of p.tile ?? []) {
    const r = reach(t);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // Draw the shape and its wrapped copies that overlap this tile.
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const x = i + t.x + dx * n;
            const y = j + t.y + dy * n;
            if (x + r <= 0 || x - r >= n || y + r <= 0 || y - r >= n) continue;
            shape(ctx, t, x * unit, y * unit, unit);
          }
        }
      }
    }
  }
}

/**
 * Draw a seamless tile of `pattern` into the square (0, 0, sizePx, sizePx).
 * sizePx is rounded and clamped to 1..256. The pattern is sanitised first, so any input is safe.
 * A context with only fillStyle/fillRect gets the flat base colour.
 */
export function drawPattern(
  ctx: PatternContext | Pick<PatternContext, 'fillStyle' | 'fillRect'>,
  pattern: Pattern,
  sizePx: number,
): void {
  const p = sanitizePattern(pattern);
  const s = Number.isFinite(sizePx) ? Math.min(PATTERN_MAX_PX, Math.max(1, Math.round(sizePx))) : 64;
  ctx.fillStyle = p.colors[0];
  ctx.fillRect(0, 0, s, s);
  if (p.type === 'none' || typeof (ctx as Partial<PatternContext>).beginPath !== 'function') return;
  const full = ctx as PatternContext;
  if (p.type === 'stripes') stripes(full, s, p);
  else if (p.type === 'dots') dots(full, s, p);
  else if (p.type === 'checker') checker(full, s, p);
  else if (p.type === 'zigzag') bands(full, s, p, false);
  else if (p.type === 'waves') bands(full, s, p, true);
  else custom(full, s, p);
}
