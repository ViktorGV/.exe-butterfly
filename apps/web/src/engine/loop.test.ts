import { describe, expect, it } from 'bun:test';
import { SIM_HZ } from '@wobble/shared/constants';
import { createFixedLoop } from './loop.ts';

/** Deterministic PRNG so the jitter test is repeatable. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('fixed-step loop', () => {
  it.each([
    ['60 Hz display', () => 1 / 60],
    ['144 Hz display', () => 1 / 144],
    ['30 Hz display', () => 1 / 30],
  ])('runs exactly SIM_HZ steps per second on a %s', (_name, frame) => {
    let steps = 0;
    const loop = createFixedLoop({ hz: SIM_HZ, onStep: () => steps++ });
    let elapsed = 0;
    while (elapsed < 20) {
      const dt = frame();
      elapsed += dt;
      loop.advance(dt);
    }
    expect(Math.abs(steps - Math.floor(elapsed * SIM_HZ))).toBeLessThanOrEqual(1);
  });

  it('runs N x SIM_HZ (+-1) steps under jittery frame times, with monotonic simTime', () => {
    const rand = mulberry32(42);
    const times: number[] = [];
    const loop = createFixedLoop({ hz: SIM_HZ, onStep: (_dt, t) => times.push(t) });
    const N = 30;
    let elapsed = 0;
    while (elapsed < N) {
      // 4..45 ms frames: every frame stays under the 5-step catch-up limit (83 ms)
      const dt = 0.004 + rand() * 0.041;
      const take = Math.min(dt, N - elapsed);
      elapsed += take;
      loop.advance(take);
    }
    expect(Math.abs(times.length - N * SIM_HZ)).toBeLessThanOrEqual(1);
    expect(loop.droppedSteps).toBe(0);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(loop.simTime).toBeCloseTo(times.length / SIM_HZ, 9);
  });

  it('passes the fixed dt and the post-step simTime to every step', () => {
    const calls: [number, number][] = [];
    const loop = createFixedLoop({ hz: 60, onStep: (dt, t) => calls.push([dt, t]) });
    loop.advance(3 / 60 + 0.001);
    expect(calls).toEqual([
      [1 / 60, 1 / 60],
      [1 / 60, 2 / 60],
      [1 / 60, 3 / 60],
    ]);
    expect(loop.alpha).toBeGreaterThan(0);
    expect(loop.alpha).toBeLessThan(1);
  });

  it('caps catch-up at maxSteps and drops the rest without spiralling', () => {
    let steps = 0;
    const loop = createFixedLoop({ hz: 60, maxSteps: 5, onStep: () => steps++ });
    expect(loop.advance(1)).toBe(5);
    expect(steps).toBe(5);
    expect(loop.droppedSteps).toBe(55);
    expect(loop.alpha).toBeLessThan(1);
    expect(loop.advance(1 / 60)).toBe(1); // back to normal on the next frame
  });

  it('allows a larger per-call limit (hidden tab catch-up)', () => {
    let steps = 0;
    const loop = createFixedLoop({ hz: 60, maxSteps: 5, onStep: () => steps++ });
    loop.advance(1, 120);
    expect(steps).toBe(60);
    expect(loop.droppedSteps).toBe(0);
  });

  it('ignores negative, NaN and infinite frame times', () => {
    let steps = 0;
    const loop = createFixedLoop({ hz: 60, onStep: () => steps++ });
    for (const bad of [-1, NaN, Infinity]) loop.advance(bad);
    expect(steps).toBe(0);
  });

  it('allocates nothing per step and resets cleanly', () => {
    const loop = createFixedLoop({ hz: 60, onStep: () => {} });
    loop.advance(0.5);
    loop.reset();
    expect([loop.simTime, loop.stepCount, loop.alpha, loop.droppedSteps]).toEqual([0, 0, 0, 0]);
  });

  it('rejects a non-positive rate', () => {
    expect(() => createFixedLoop({ hz: 0, onStep: () => {} })).toThrow();
  });
});
