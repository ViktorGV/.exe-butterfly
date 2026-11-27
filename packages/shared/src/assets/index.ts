// SEAM. Seeded by #2 with stubs; replaced by #16 (sanitizer and pattern rasteriser).
import { PACK_DATA_SCHEMAS } from '../schemas/packs.ts';
import type { PackData, PackKind, Pattern, SanitizeResult } from '../types.ts';

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

/**
 * Make untrusted pack data safe. Never throws.
 * STUB: strict schema parse only, no clamping.
 */
export function sanitizePack(kind: PackKind, data: unknown): SanitizeResult {
  const schema = PACK_DATA_SCHEMAS[kind];
  if (!schema) return { ok: false, data: null, issues: [`unknown pack kind: ${String(kind)}`] };
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data as PackData, issues: [] };
  return { ok: false, data: null, issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/**
 * Draw a tileable pattern into a Canvas 2D context.
 * STUB: fills the square with colors[0].
 */
export function drawPattern(
  ctx: Pick<PatternContext, 'fillStyle' | 'fillRect'>,
  pattern: Pattern,
  sizePx: number,
): void {
  ctx.fillStyle = pattern?.colors?.[0] ?? '#ffffff';
  ctx.fillRect(0, 0, sizePx, sizePx);
}
