import { describe, expect, it } from 'bun:test';
import type { Vec3 } from '@wobble/shared/types';
import { DEFAULT_FRAMING, computeFraming, horizontalFov, type Framing } from './framing.ts';
import {
  angleDelta,
  damp,
  dampLinear,
  impulseForPeak,
  stepImpulseSpring,
  stepSpring,
  wrapAngle,
  type SpringState,
} from './math.ts';
import { sampleSpline } from './path.ts';

const RATES = [30, 60, 144];

describe('angles', () => {
  it('wraps into (-PI, PI] and takes the short way round', () => {
    for (const a of [-10, -Math.PI, -1, 0, 1, Math.PI, 7, 100]) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-12);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 9);
    }
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 9);
  });
});

describe('critically damped spring', () => {
  it('converges to a step target with no overshoot beyond 2%', () => {
    for (const hz of RATES) {
      const s: SpringState = { x: 0, v: 0 };
      let max = 0;
      for (let i = 0; i < hz * 3; i++) {
        stepSpring(s, 1, 1, 7, 1 / hz);
        max = Math.max(max, s.x);
      }
      expect(max).toBeLessThanOrEqual(1.02);
      expect(Math.abs(s.x - 1)).toBeLessThan(1e-4);
    }
  });

  it('gives the same result at 30, 60 and 144 Hz for a fixed and a moving target', () => {
    const results = RATES.map((hz) => {
      const s: SpringState = { x: -3, v: 2 };
      const dt = 1 / hz;
      for (let i = 0; i < hz * 5; i++) {
        const t0 = i * dt;
        stepSpring(s, 4 * t0, 4 * (t0 + dt), 7, dt);
      }
      return s.x;
    });
    expect(Math.abs(results[0] - results[1])).toBeLessThan(1e-9);
    expect(Math.abs(results[2] - results[1])).toBeLessThan(1e-9);
    // Velocity feed-forward: a constant-speed target is tracked with no lag.
    expect(results[1]).toBeCloseTo(20, 4);
  });

  it('kicks to an exact peak and settles back to rest', () => {
    const s: SpringState = { x: 0, v: impulseForPeak(0.2, 9) };
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      stepImpulseSpring(s, 9, 1 / 600);
      peak = Math.max(peak, s.x);
    }
    expect(peak).toBeCloseTo(0.2, 4);
    for (let i = 0; i < 120; i++) stepImpulseSpring(s, 9, 1 / 60);
    expect(Math.abs(s.x)).toBeLessThan(1e-3);
  });
});

describe('exponential damping', () => {
  it('is exact toward a linearly moving target regardless of step size', () => {
    const run = (hz: number) => {
      let a = 0;
      const dt = 1 / hz;
      for (let i = 0; i < hz * 2; i++) a = dampLinear(a, i * dt, (i + 1) * dt, 3, dt);
      return a;
    };
    expect(Math.abs(run(30) - run(144))).toBeLessThan(1e-9);
    let a = 0;
    a = damp(a, 1, 2, 0.5);
    a = damp(a, 1, 2, 0.5);
    expect(a).toBeCloseTo(damp(0, 1, 2, 1), 12);
  });
});

describe('framing', () => {
  const out = (): Framing => ({ fov: 0, distance: 0, pitch: 0, ahead: 0 });

  it('uses the base framing in landscape', () => {
    const f = computeFraming(16 / 9, DEFAULT_FRAMING, out());
    expect(f.fov).toBe(DEFAULT_FRAMING.baseFov);
    expect(f.distance).toBe(DEFAULT_FRAMING.distance);
    expect(f.pitch).toBe(DEFAULT_FRAMING.pitch);
    expect(f.ahead).toBe(0);
  });

  it('pulls back, raises and widens in portrait', () => {
    const land = computeFraming(16 / 9, DEFAULT_FRAMING, out());
    const port = computeFraming(9 / 19.5, DEFAULT_FRAMING, out());
    expect(port.distance).toBeGreaterThan(land.distance * 1.25);
    expect(port.pitch).toBeGreaterThan(land.pitch);
    expect(port.ahead).toBeGreaterThan(1);
    expect(port.fov).toBeGreaterThan(land.fov);
    expect(port.fov).toBeLessThanOrEqual(DEFAULT_FRAMING.maxFov);
    // A mildly portrait screen keeps the minimum horizontal FOV.
    const tablet = computeFraming(0.75, DEFAULT_FRAMING, out());
    expect(horizontalFov(tablet.fov, 0.75)).toBeCloseTo(DEFAULT_FRAMING.minHorizontalFov, 6);
  });

  it('survives a zero or broken aspect', () => {
    const f = computeFraming(0, DEFAULT_FRAMING, out());
    expect(Number.isFinite(f.fov) && Number.isFinite(f.distance)).toBe(true);
  });
});

describe('spline', () => {
  it('passes through every control point, start to end', () => {
    const pts: Vec3[] = [
      [0, 0, 0],
      [10, 5, 0],
      [10, 5, -10],
      [0, 2, -20],
    ];
    const o: Vec3 = [0, 0, 0];
    expect(sampleSpline(pts, 4, 0, o)).toEqual([0, 0, 0]);
    expect(sampleSpline(pts, 4, 1, o)).toEqual([0, 2, -20]);
    sampleSpline(pts, 4, 1 / 3, o);
    expect(o[0]).toBeCloseTo(10, 9);
    expect(o[2]).toBeCloseTo(0, 9);
    sampleSpline(pts, 1, 0.5, o);
    expect(o).toEqual([0, 0, 0]);
  });
});
