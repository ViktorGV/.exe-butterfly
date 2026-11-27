import { afterEach, describe, expect, it } from 'bun:test';
import { createTickLoop } from './tickLoop.ts';
import type { TickLoop } from './tickLoop.ts';

const nowMs = (): number => Bun.nanoseconds() / 1e6;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const busyWait = (ms: number): void => {
  const end = nowMs() + ms;
  while (nowMs() < end) {
    // spin
  }
};

let loop: TickLoop | undefined;
afterEach(() => {
  loop?.stop();
  loop = undefined;
});

describe('createTickLoop', () => {
  it('ticks 30 +/- 1 times in 2 s at 15 Hz with an even ~66.7 ms interval', async () => {
    const times: number[] = [];
    loop = createTickLoop({ hz: 15, onTick: () => times.push(nowMs()) });
    loop.start();
    await sleep(2000);
    loop.stop();

    expect(Math.abs(times.length - 30)).toBeLessThanOrEqual(1);
    const first = times[0] as number;
    const last = times[times.length - 1] as number;
    const meanInterval = (last - first) / (times.length - 1);
    expect(Math.abs(meanInterval - 1000 / 15)).toBeLessThan(2);
    expect(loop.stats().skipped).toBe(0);
  }, 4000);

  it('skips ahead after a slow 100 ms onTick instead of bursting', async () => {
    const hz = 50; // 20 ms interval, so one 100 ms tick puts the loop > 3 ticks behind
    const interval = 1000 / hz;
    const times: number[] = [];
    let slowAt = -1;
    loop = createTickLoop({
      hz,
      onTick: () => {
        times.push(nowMs());
        if (times.length === 5) {
          slowAt = times.length;
          busyWait(100);
        }
      },
    });
    loop.start();
    await sleep(600);
    loop.stop();

    expect(slowAt).toBe(5);
    expect(loop.stats().skipped).toBeGreaterThanOrEqual(1);
    // From the slow tick onward, no two ticks are closer than half an interval.
    for (let i = slowAt; i < times.length; i++) {
      expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThan(interval / 2);
    }
  }, 3000);

  it('does not burst when every onTick takes 100 ms at 15 Hz', async () => {
    const half = 1000 / 15 / 2;
    const times: number[] = [];
    loop = createTickLoop({
      hz: 15,
      onTick: () => {
        times.push(nowMs());
        busyWait(100);
      },
    });
    loop.start();
    await sleep(1200);
    loop.stop();

    // Falls 33 ms further behind per tick, so it passes 3 ticks behind and skips.
    expect(loop.stats().skipped).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < times.length; i++) {
      expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThan(half);
    }
    expect(loop.stats().avgMs).toBeGreaterThanOrEqual(99);
  }, 3000);

  it('skips ahead when the injected clock jumps forward', async () => {
    let offset = 0;
    const ticksSeen: number[] = [];
    loop = createTickLoop({
      hz: 100,
      clock: () => nowMs() + offset,
      onTick: (_now, tick) => {
        ticksSeen.push(tick);
        if (ticksSeen.length === 3) offset += 1000; // 100 ticks behind
      },
    });
    loop.start();
    await sleep(100);
    loop.stop();

    const skipped = loop.stats().skipped;
    expect(skipped).toBeGreaterThanOrEqual(95);
    expect(skipped).toBeLessThanOrEqual(101);
    // The tick index jumps over the skipped ticks.
    expect(ticksSeen[3] as number).toBe((ticksSeen[2] as number) + 1 + skipped);
  });

  it('stop() stops ticking and start() resumes', async () => {
    let count = 0;
    loop = createTickLoop({ hz: 100, onTick: () => count++ });
    expect(loop.running).toBe(false);
    loop.start();
    expect(loop.running).toBe(true);
    await sleep(100);
    loop.stop();
    expect(loop.running).toBe(false);
    const atStop = count;
    expect(atStop).toBeGreaterThan(0);
    await sleep(100);
    expect(count).toBe(atStop);

    loop.start();
    await sleep(50);
    loop.stop();
    expect(count).toBeGreaterThan(atStop);
  });

  it('stop() from inside onTick prevents further ticks', async () => {
    let count = 0;
    const l = createTickLoop({
      hz: 100,
      onTick: () => {
        count++;
        if (count === 2) l.stop();
      },
    });
    loop = l;
    l.start();
    await sleep(100);
    expect(count).toBe(2);
    expect(l.running).toBe(false);
  });

  it('reports sane stats and reuses the stats object', async () => {
    loop = createTickLoop({ hz: 100, onTick: () => busyWait(2) });
    const empty = loop.stats();
    expect(empty).toEqual({ ticks: 0, skipped: 0, avgMs: 0, maxMs: 0 });

    loop.start();
    await sleep(150);
    loop.stop();
    const s = loop.stats();
    expect(s).toBe(empty);
    expect(s.ticks).toBeGreaterThan(5);
    expect(s.skipped).toBe(0);
    expect(s.avgMs).toBeGreaterThanOrEqual(2);
    expect(s.avgMs).toBeLessThan(10);
    expect(s.maxMs).toBeGreaterThanOrEqual(s.avgMs);
  });

  it('rejects invalid options', () => {
    expect(() => createTickLoop({ hz: 0, onTick: () => {} })).toThrow(RangeError);
    expect(() => createTickLoop({ hz: 15, maxBehindTicks: -1, onTick: () => {} })).toThrow(RangeError);
  });
});
