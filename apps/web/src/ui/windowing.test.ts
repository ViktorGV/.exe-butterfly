import { describe, expect, it } from 'bun:test';
import { computeWindow, poolSize, scrollTopToReveal } from './windowing.ts';

const base = { rowHeight: 48, count: 300, overscan: 4, viewportHeight: 480 };

describe('computeWindow', () => {
  it('renders the visible rows plus overscan at the top of the list', () => {
    const r = computeWindow({ ...base, scrollTop: 0 });
    expect(r).toEqual({ start: 0, end: 14, totalHeight: 300 * 48 });
  });

  it('follows the scroll position', () => {
    const r = computeWindow({ ...base, scrollTop: 48 * 100 + 10 });
    expect(r.start).toBe(96); // row 100 is the first visible, minus 4 overscan
    expect(r.end).toBe(115); // rows 100..110 visible (partially), plus 4 overscan
  });

  it('clamps at the bottom and never goes past count', () => {
    const r = computeWindow({ ...base, scrollTop: 1e9 });
    expect(r.end).toBe(300);
    expect(r.start).toBe(300 - 10 - 4);
  });

  it('clamps a negative or NaN scrollTop to the top', () => {
    expect(computeWindow({ ...base, scrollTop: -200 }).start).toBe(0);
    expect(computeWindow({ ...base, scrollTop: NaN }).start).toBe(0);
  });

  it('handles empty, short lists and a zero-height viewport', () => {
    expect(computeWindow({ ...base, count: 0, scrollTop: 0 })).toEqual({ start: 0, end: 0, totalHeight: 0 });
    expect(computeWindow({ ...base, count: 3, scrollTop: 0 })).toEqual({ start: 0, end: 3, totalHeight: 144 });
    const r = computeWindow({ ...base, viewportHeight: 0, scrollTop: 0 });
    expect(r.end - r.start).toBeGreaterThan(0);
  });

  it('never renders more rows than the pool holds, at any scroll position', () => {
    for (const vh of [200, 390, 480, 844, 2160]) {
      const pool = poolSize(vh, 48, 4);
      for (let top = 0; top < 300 * 48; top += 7) {
        const r = computeWindow({ ...base, viewportHeight: vh, scrollTop: top });
        expect(r.end - r.start).toBeLessThanOrEqual(pool);
        // every visible row is inside the rendered range
        const firstVisible = Math.floor(Math.min(top, 300 * 48 - vh) / 48);
        expect(r.start).toBeLessThanOrEqual(Math.max(0, firstVisible));
      }
    }
  });

  it('reuses the out object (no allocation while scrolling)', () => {
    const out = { start: 0, end: 0, totalHeight: 0 };
    expect(computeWindow({ ...base, scrollTop: 0 }, out)).toBe(out);
  });

  it('is fast enough to run on every scroll frame for 300 rows', () => {
    const out = { start: 0, end: 0, totalHeight: 0 };
    const input = { ...base, scrollTop: 0 };
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) {
      input.scrollTop = i % 14_400;
      computeWindow(input, out);
    }
    expect((performance.now() - t0) / 100_000).toBeLessThan(0.01);
  });
});

describe('poolSize', () => {
  it('is visible rows + 1 partial + both overscans', () => {
    expect(poolSize(480, 48, 4)).toBe(10 + 1 + 8);
    expect(poolSize(0, 48, 4)).toBe(9);
    expect(poolSize(480, 0, 4)).toBe(0);
  });
});

describe('scrollTopToReveal', () => {
  it('centres the row when possible and clamps at both ends', () => {
    expect(scrollTopToReveal(0, 48, 480, 300)).toBe(0);
    expect(scrollTopToReveal(100, 48, 480, 300)).toBe(100 * 48 - (480 - 48) / 2);
    expect(scrollTopToReveal(299, 48, 480, 300)).toBe(300 * 48 - 480);
    expect(scrollTopToReveal(2, 48, 480, 3)).toBe(0);
  });
});
