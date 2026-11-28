// unwrapServerTime (#125): SNAPSHOT carries the server time as epoch ms modulo 2^32, and the client
// must rebuild the full epoch time from its synced clock. Before the fix every remote looked stale.
import { describe, expect, test } from 'bun:test';
import { unwrapServerTime } from './remoteBuffer.ts';

const U32 = 2 ** 32;
const NOW = 1_795_000_000_000; // an epoch time in late 2026, far above 2^32
const wire = (ms: number) => ms % U32; // what dv.getUint32 reads back

describe('unwrapServerTime', () => {
  test('returns the full epoch time for a snapshot from the recent past', () => {
    for (const age of [0, 1, 67, 250, 5_000, 60_000]) {
      expect(unwrapServerTime(wire(NOW - age), NOW)).toBe(NOW - age);
    }
  });

  test('handles a server clock slightly ahead of the synced estimate', () => {
    for (const ahead of [1, 20, 500]) {
      expect(unwrapServerTime(wire(NOW + ahead), NOW)).toBe(NOW + ahead);
    }
  });

  test('works across the 2^32 wrap in both directions', () => {
    const edge = Math.ceil(NOW / U32) * U32; // the next multiple of 2^32
    // snapshot just before the wrap, client clock just after
    expect(unwrapServerTime(wire(edge - 10), edge + 5)).toBe(edge - 10);
    // snapshot just after the wrap, client clock just before
    expect(unwrapServerTime(wire(edge + 10), edge - 5)).toBe(edge + 10);
  });

  test('never treats a fresh snapshot as years old (the #125 bug)', () => {
    const t = unwrapServerTime(wire(NOW - 70), NOW);
    expect(NOW - t).toBeLessThan(1_000);
    expect(NOW - wire(NOW - 70)).toBeGreaterThan(1e12); // comparing the raw u32 would be ~56 years stale
  });
});
