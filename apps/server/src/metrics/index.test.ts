import { describe, expect, it } from 'bun:test';
import { createMetrics } from './index.ts';

describe('metrics', () => {
  it('reports bytes and counts after N snapshots of known size', () => {
    let now = 0;
    const m = createMetrics({ clock: () => now });
    for (let i = 0; i < 50; i++) m.snapshotSent(200);
    for (let i = 0; i < 5; i++) m.snapshotDropped();
    for (let i = 0; i < 20; i++) m.messageReceived();
    const s = m.snapshot();
    expect(s.bytesPerSec).toBe(10_000);
    expect(s.snapshotsPerSec).toBe(50);
    expect(s.snapshotsDroppedPerSec).toBe(5);
    expect(s.messagesPerSec).toBe(20);
    now = 1000; // second 1: window now spans 2 s
    expect(m.snapshot().bytesPerSec).toBe(5_000);
  });

  it('forgets traffic older than the 10 s window', () => {
    let now = 0;
    const m = createMetrics({ clock: () => now });
    for (let i = 0; i < 10; i++) m.snapshotSent(100);
    now = 11_000;
    const s = m.snapshot();
    expect(s.bytesPerSec).toBe(0);
    expect(s.snapshotsPerSec).toBe(0);
  });

  it('averages over the whole window once it is full', () => {
    let now = 0;
    const m = createMetrics({ clock: () => now });
    for (let sec = 0; sec < 10; sec++) {
      now = sec * 1000;
      m.snapshotSent(1000);
    }
    expect(m.snapshot().bytesPerSec).toBe(1000);
  });

  it('exposes gauges and tick stats', () => {
    const m = createMetrics({ clock: () => 0 });
    m.setRooms(2);
    m.setPlayers(120);
    m.setTickStats(() => ({ avgMs: 1.5, maxMs: 4 }));
    const s = m.snapshot();
    expect([s.rooms, s.players, s.tickAvgMs, s.tickMaxMs]).toEqual([2, 120, 1.5, 4]);
  });

  it('has zero tick stats without a source', () => {
    const s = createMetrics({ clock: () => 0 }).snapshot();
    expect([s.tickAvgMs, s.tickMaxMs]).toEqual([0, 0]);
  });
});
