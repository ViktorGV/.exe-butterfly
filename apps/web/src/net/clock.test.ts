import { describe, expect, it } from 'bun:test';
import { createClockSync } from './clock.ts';
import type { ClockSync, ClockSyncOptions } from './clock.ts';

/** Deterministic PRNG so the randomized tests are repeatable. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FakeEvent {
  id: number;
  at: number;
  fn: () => void;
}

/** Manual clock + timer queue. Time only moves when the test calls advance(). */
function createFakeClock(start = 1_000_000) {
  let t = start;
  let nextId = 1;
  const events: FakeEvent[] = [];
  const schedule = (fn: () => void, ms: number): number => {
    const id = nextId++;
    events.push({ id, at: t + Math.max(0, ms), fn });
    return id;
  };
  return {
    now: () => t,
    setTimer: schedule,
    clearTimer: (h: unknown) => {
      const i = events.findIndex((e) => e.id === h);
      if (i >= 0) events.splice(i, 1);
    },
    /** Run every event due within `ms`, in time order, calling `tick` before each one. */
    advance(ms: number, tick?: () => void) {
      const end = t + ms;
      for (;;) {
        let best = -1;
        for (let i = 0; i < events.length; i++) {
          const e = events[i];
          if (
            e.at <= end &&
            (best < 0 || e.at < events[best].at || (e.at === events[best].at && e.id < events[best].id))
          )
            best = i;
        }
        if (best < 0) break;
        const [e] = events.splice(best, 1);
        t = e.at;
        tick?.();
        e.fn();
      }
      t = end;
      tick?.();
    },
    get pending() {
      return events.length;
    },
  };
}

/** One-way delays [up, down] in ms for the n-th ping. */
type DelayFn = (n: number) => [number, number];

/**
 * Fake transport: each ping reaches a simulated server after `up` ms, which stamps
 * s = its own clock (local time + trueOffset), and the pong comes back after `down` ms.
 */
function createSim(delays: DelayFn, opts: Partial<ClockSyncOptions> = {}, trueOffset = 12345) {
  const clock = createFakeClock();
  const sim = {
    clock,
    trueOffset,
    pings: 0,
    sync: undefined as unknown as ClockSync,
    /** serverNow() minus the true server time right now. */
    error: () => sim.sync.serverNow() - (clock.now() + sim.trueOffset),
  };
  sim.sync = createClockSync({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...opts,
    sendPing(c) {
      const [up, down] = delays(sim.pings++);
      clock.setTimer(() => {
        const s = clock.now() + sim.trueOffset;
        clock.setTimer(() => sim.sync.onPong(c, s), down);
      }, up);
    },
  });
  return sim;
}

/**
 * Seeded "asymmetric-ish" internet path, every one-way delay within 20-200 ms:
 * a per-seed base latency (20-60 ms) shared by both directions, a small fixed asymmetry (0-4 ms)
 * on the uplink, and per-packet queueing jitter: 60% of packets see only a few ms, the rest up to
 * ~130 ms extra. No sync can beat rtt/2 when no packet in a burst gets a clean round trip, so the
 * 10 ms bound only holds when some do; see the many-seed test for how often that is.
 */
function internetPath(seed: number): DelayFn {
  const rand = mulberry32(seed);
  const base = 20 + rand() * 40;
  const asym = rand() * 4;
  const jitter = () => (rand() < 0.6 ? rand() * 4 : rand() * 130);
  return () => [base + asym + jitter(), base + jitter()];
}

const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 2024, 31337, 65535];

describe('clock sync', () => {
  it.each(SEEDS)('estimates the offset within 10 ms after the initial burst (seed %i)', (seed) => {
    const sim = createSim(internetPath(seed));
    expect(sim.sync.synced).toBe(false);
    sim.sync.start();
    // 8 pings over 700 ms, last pong back by ~1.1 s; settle well before the first re-sync at ~10.7 s
    sim.clock.advance(2000);
    expect(sim.sync.synced).toBe(true);
    expect(sim.pings).toBe(8);
    expect(Math.abs(sim.error())).toBeLessThan(10);
    expect(sim.sync.rttMs()).toBeGreaterThanOrEqual(40);
    expect(sim.sync.rttMs()).toBeLessThanOrEqual(400);
  });

  it('is within 10 ms after the burst for >= 97% of 500 seeded paths, never worse than rtt/2', () => {
    let within = 0;
    let worst = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const sim = createSim(internetPath(seed * 7919));
      sim.sync.start();
      sim.clock.advance(2000);
      const err = Math.abs(sim.error());
      expect(err).toBeLessThanOrEqual(sim.sync.rttMs() / 2);
      if (err < 10) within++;
      worst = Math.max(worst, err);
    }
    expect(within / 500).toBeGreaterThanOrEqual(0.97);
    expect(worst).toBeLessThan(60);
  });

  it('keeps the error under half the best RTT even with fully independent 20-200 ms delays', () => {
    for (const seed of SEEDS) {
      const rand = mulberry32(seed);
      const sim = createSim(() => [20 + rand() * 180, 20 + rand() * 180]);
      sim.sync.start();
      sim.clock.advance(2000);
      expect(Math.abs(sim.error())).toBeLessThanOrEqual(sim.sync.rttMs() / 2 - 20 + 1e-9);
    }
  });

  it.each(SEEDS)('never lets serverNow() go backwards across re-syncs and offset jumps (seed %i)', (seed) => {
    const sim = createSim(internetPath(seed));
    let last = -Infinity;
    let checks = 0;
    const check = () => {
      if (!sim.sync.synced) return;
      const v = sim.sync.serverNow();
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
      checks++;
    };
    sim.sync.start();
    for (let i = 0; i < 60; i++) sim.clock.advance(1000, check); // ~6 re-syncs
    expect(Math.abs(sim.error())).toBeLessThan(10);

    sim.trueOffset -= 300; // server clock steps back 300 ms: must slew, never jump back
    for (let i = 0; i < 30; i++) sim.clock.advance(1000, check);
    // slewing at <= 5 ms/s: after 30 s we have moved at most ~150 ms of the 300
    expect(sim.error()).toBeGreaterThan(140);
    // <= 30 s until stale low-RTT samples leave the window, then <= 60 s of slewing
    for (let i = 0; i < 90; i++) sim.clock.advance(1000, check);
    expect(Math.abs(sim.error())).toBeLessThan(10);

    sim.trueOffset += 200; // server clock steps forward
    for (let i = 0; i < 90; i++) sim.clock.advance(1000, check);
    expect(Math.abs(sim.error())).toBeLessThan(10);
    expect(checks).toBeGreaterThan(400);
  });

  it('runs a burst of 8 pings 100 ms apart, then 3 pings every 10 s', () => {
    const sent: number[] = [];
    const clock = createFakeClock(0);
    const sync = createClockSync({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      sendPing: (c) => sent.push(c),
    });
    sync.start();
    clock.advance(10_699);
    expect(sent).toEqual([0, 100, 200, 300, 400, 500, 600, 700]);
    clock.advance(1);
    // no pong ever arrived, so it is still unsynced and retries a full burst
    expect(sent.length).toBe(9);
    sent.length = 0;
    sync.onPong(10_700, 50); // answer the first ping of the retry burst
    expect(sync.synced).toBe(true);
    clock.advance(10_900);
    expect(sent).toEqual([10_800, 10_900, 11_000, 11_100, 11_200, 11_300, 11_400, 21_400, 21_500, 21_600]);
  });

  it('ignores re-sync samples with RTT over 2x the best recent RTT', () => {
    // burst: clean 20 ms each way. Later: a congested, lopsided path (290 ms up, 10 ms down)
    // whose naive offset sample would be 140 ms off.
    let congested = false;
    const sim = createSim(() => (congested ? [290, 10] : [20, 20]));
    sim.sync.start();
    sim.clock.advance(2000);
    expect(Math.abs(sim.error())).toBeLessThan(1e-6);
    expect(sim.sync.rttMs()).toBe(40);

    congested = true;
    // 3 re-sync rounds, every sample rejected. (After ~16 slow samples the RTT window forgets the
    // 40 ms baseline and adapts, so a path that stays slow is eventually trusted again.)
    sim.clock.advance(30_000);
    expect(Math.abs(sim.error())).toBeLessThan(1e-6);
    expect(sim.sync.rttMs()).toBe(40);
  });

  it('accepts a moderately slower path within 2x and targets the lowest-RTT recent sample', () => {
    let n = 0;
    const sim = createSim((i) => {
      n = i;
      if (i < 8) return [20, 20]; // burst: 40 ms
      return i % 3 === 0 ? [30, 40] : [50, 25]; // re-syncs: 70 ms (best, 5 ms skew) and 75 ms (12.5 ms skew)
    });
    sim.sync.start();
    sim.clock.advance(15_000);
    expect(n).toBeGreaterThanOrEqual(10);
    expect(sim.sync.rttMs()).toBe(40); // burst samples still in the 8-sample window
    sim.clock.advance(17_000); // 3 rounds later the window holds only re-sync samples
    expect(sim.sync.rttMs()).toBe(70);
    sim.clock.advance(5_000); // let the 5 ms slew finish
    expect(sim.error()).toBeCloseTo(-5, 6);
  });

  it('ignores pongs whose c matches no outstanding ping, and duplicate pongs', () => {
    const sent: number[] = [];
    const clock = createFakeClock(5000);
    const sync = createClockSync({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      sendPing: (c) => sent.push(c),
    });
    sync.onPong(5000, 999_999); // nothing sent yet
    expect(sync.synced).toBe(false);
    expect(sync.serverNow()).toBe(5000);

    sync.start();
    clock.advance(20);
    sync.onPong(4321, 999_999); // unknown c
    expect(sync.synced).toBe(false);

    sync.onPong(sent[0], 5010 + 100); // rtt 20 -> offset 100
    expect(sync.synced).toBe(true);
    expect(sync.serverNow()).toBe(5020 + 100);
    sync.onPong(sent[0], 5010 + 900); // same c again
    expect(sync.serverNow()).toBe(5020 + 100);
  });

  it('stop() cancels timers, drops outstanding pings and stops pinging', () => {
    const sim = createSim(() => [30, 30]);
    sim.sync.start();
    sim.clock.advance(250); // 3 pings sent, burst still going
    expect(sim.pings).toBe(3);
    sim.sync.stop();
    const offsetAtStop = sim.error();
    sim.clock.advance(120_000);
    expect(sim.pings).toBe(3);
    expect(sim.clock.pending).toBe(0); // in-flight pongs drained, no timers left
    expect(sim.error()).toBe(offsetAtStop); // late pongs for stopped pings were ignored

    sim.sync.start(); // restart resumes with a re-sync round
    sim.clock.advance(1000);
    expect(sim.pings).toBe(6);
  });

  it('rttMs() is 0 before sync and serverNow() falls back to local time', () => {
    const sim = createSim(() => [25, 25]);
    expect(sim.sync.rttMs()).toBe(0);
    expect(sim.sync.serverNow()).toBe(sim.clock.now());
    sim.sync.start();
    sim.clock.advance(100);
    expect(sim.sync.rttMs()).toBe(50);
  });
});
