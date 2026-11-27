// Windowing maths for the virtualised results list. Pure.

export interface WindowInput {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  count: number;
  /** Extra rows rendered above and below the visible ones. */
  overscan: number;
}

export interface WindowRange {
  /** First rendered row (inclusive). */
  start: number;
  /** Last rendered row (exclusive). */
  end: number;
  /** Total scrollable height in px. */
  totalHeight: number;
}

/** Which rows to render for a scroll position. Writes into `out` when given, so scrolling does not allocate. */
export function computeWindow(
  input: WindowInput,
  out: WindowRange = { start: 0, end: 0, totalHeight: 0 },
): WindowRange {
  const { rowHeight, count, overscan } = input;
  const total = count > 0 && rowHeight > 0 ? count * rowHeight : 0;
  out.totalHeight = total;
  if (total === 0) {
    out.start = 0;
    out.end = 0;
    return out;
  }
  const maxTop = Math.max(0, total - input.viewportHeight);
  const top = Math.min(Math.max(0, input.scrollTop || 0), maxTop);
  const vh = Math.max(0, input.viewportHeight);
  const first = Math.floor(top / rowHeight);
  const last = Math.ceil((top + vh) / rowHeight);
  out.start = Math.max(0, first - overscan);
  out.end = Math.min(count, Math.max(last, first + 1) + overscan);
  return out;
}

/** How many row elements the pool needs so any scroll position is covered. */
export function poolSize(viewportHeight: number, rowHeight: number, overscan: number): number {
  if (!(rowHeight > 0)) return 0;
  return Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1 + 2 * overscan;
}

/** scrollTop that centres row `index` in the viewport, clamped to the scrollable range. */
export function scrollTopToReveal(index: number, rowHeight: number, viewportHeight: number, count: number): number {
  const maxTop = Math.max(0, count * rowHeight - viewportHeight);
  const top = index * rowHeight - (viewportHeight - rowHeight) / 2;
  return Math.round(Math.min(Math.max(0, top), maxTop));
}
