// Virtualised list: a fixed pool of absolutely positioned rows recycled while scrolling.
// Only the rows in view (plus overscan) exist in the DOM, so 300+ rows scroll smoothly.
import { computeWindow, poolSize, scrollTopToReveal, type WindowRange } from './windowing.ts';

export interface VirtualListOptions<R> {
  rowHeight: number;
  overscan?: number;
  /** Builds one reusable row element. */
  createRow(doc: Document): R & { el: HTMLElement };
  /** Fills a pooled row with item `index`. Called only when a row shows a different index. */
  bindRow(row: R & { el: HTMLElement }, index: number): void;
}

export interface VirtualList {
  readonly el: HTMLElement;
  setCount(count: number): void;
  /** Re-binds every visible row (e.g. after the data changed). */
  refresh(): void;
  scrollToIndex(index: number): void;
}

export function createVirtualList<R>(doc: Document, opts: VirtualListOptions<R>): VirtualList {
  const { rowHeight } = opts;
  const overscan = opts.overscan ?? 4;
  const spacer = doc.createElement('div');
  spacer.className = 'wr-vlist-spacer';
  const el = doc.createElement('div');
  el.className = 'wr-vlist';
  el.setAttribute('tabindex', '0');
  el.appendChild(spacer);

  type Row = R & { el: HTMLElement; index: number };
  const pool: Row[] = [];
  const range: WindowRange = { start: 0, end: 0, totalHeight: 0 };
  const input = { scrollTop: 0, viewportHeight: 0, rowHeight, count: 0, overscan };
  let frame = 0;
  let viewport = 0;

  const ensurePool = (n: number) => {
    while (pool.length < n) {
      const row = opts.createRow(doc) as Row;
      row.index = -1;
      row.el.style.height = `${rowHeight}px`;
      row.el.hidden = true;
      spacer.appendChild(row.el);
      pool.push(row);
    }
  };

  const render = (force: boolean) => {
    frame = 0;
    input.scrollTop = el.scrollTop;
    input.viewportHeight = viewport || el.clientHeight;
    computeWindow(input, range);
    ensurePool(Math.min(input.count, poolSize(input.viewportHeight, rowHeight, overscan)));
    // Each index maps to a fixed pool slot (index % pool size), so a row only rebinds when it scrolls out.
    const n = pool.length;
    for (let i = 0; i < n; i++) pool[i].el.hidden = true;
    for (let idx = range.start; idx < range.end; idx++) {
      const row = pool[idx % n];
      row.el.hidden = false;
      if (force || row.index !== idx) {
        row.index = idx;
        row.el.style.transform = `translateY(${idx * rowHeight}px)`;
        opts.bindRow(row, idx);
      }
    }
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(() => render(false));
  };
  el.addEventListener('scroll', schedule, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver((entries) => {
      viewport = entries[0]?.contentRect.height ?? 0;
      schedule();
    }).observe(el);
  }

  return {
    el,
    setCount(count) {
      input.count = Math.max(0, count | 0);
      spacer.style.height = `${input.count * rowHeight}px`;
      for (const row of pool) row.index = -1;
      render(true);
    },
    refresh() {
      render(true);
    },
    scrollToIndex(index) {
      el.scrollTop = scrollTopToReveal(index, rowHeight, viewport || el.clientHeight, input.count);
      render(false);
    },
  };
}
