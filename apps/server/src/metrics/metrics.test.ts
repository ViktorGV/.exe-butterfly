import { describe, expect, test } from 'bun:test';
import { createMetrics } from './index.ts';

function setup() {
  let now = 1_000_000;
  const m = createMetrics(() => now);
  return { m, advance: (ms: number) => (now += ms) };
}

describe('server metrics', () => {
  test('bytesPerSec and counts match N snapshots of known size', () => {
    const { m, advance } = setup();
    for (let s = 0; s < 4; s++) {
      for (let i = 0; i < 15; i++) m.sent(1000);
      for (let i = 0; i < 30; i++) m.received();
      m.dropped();
      advance(1000);
    }
    const s = m.snapshot();
    expect(s.bytesPerSec).toBe(15_000); // 60 000 bytes over 4 s
    expect(s.messagesPerSec).toBe(30);
    expect(s.snapshotsDroppedPerSec).toBe(1);
  });

  test('tick average and max, and the window forgets old seconds', () => {
    const { m, advance } = setup();
    m.tick(1);
    m.tick(3);
    expect(m.snapshot().tickAvgMs).toBe(2);
    expect(m.snapshot().tickMaxMs).toBe(3);
    advance(11_000);
    m.sent(10);
    const s = m.snapshot();
    expect(s.tickMaxMs).toBe(0);
    expect(s.tickAvgMs).toBe(0);
    expect(s.bytesPerSec).toBe(1); // 10 bytes over the 10 s window
  });

  test('idle server reports zeros', () => {
    const s = setup().m.snapshot();
    expect(s.bytesPerSec).toBe(0);
    expect(s.tickMaxMs).toBe(0);
  });
});
