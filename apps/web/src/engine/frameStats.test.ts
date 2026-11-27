import { describe, expect, it } from 'bun:test';
import { createFrameStats } from './frameStats.ts';

describe('frame stats', () => {
  it('reports fps and percentiles over the window', () => {
    const s = createFrameStats(100);
    for (let i = 1; i <= 100; i++) s.push(i); // 1..100 ms
    expect(s.percentile(50)).toBe(50);
    expect(s.percentile(95)).toBe(95);
    expect(s.percentile(100)).toBe(100);
    expect(s.fps()).toBeCloseTo((1000 * 100) / 5050, 6);
  });

  it('keeps only the most recent samples', () => {
    const s = createFrameStats(4);
    for (const v of [100, 100, 100, 100, 10, 10, 10, 10]) s.push(v);
    expect(s.count).toBe(4);
    expect(s.percentile(95)).toBe(10);
    expect(s.fps()).toBeCloseTo(100, 6);
  });

  it('handles a partly filled window and bad samples', () => {
    const s = createFrameStats(10);
    expect(s.fps()).toBe(0);
    expect(s.percentile(50)).toBe(0);
    s.push(NaN);
    s.push(-5);
    s.push(16);
    s.push(17);
    expect(s.count).toBe(2);
    expect(s.percentile(50)).toBe(16);
  });

  it('does not reorder its own samples when computing percentiles', () => {
    const s = createFrameStats(3);
    s.push(30);
    s.push(10);
    s.push(20);
    s.percentile(50);
    s.push(5); // overwrites the oldest sample (30), not the smallest
    expect(s.percentile(100)).toBe(20);
  });
});
