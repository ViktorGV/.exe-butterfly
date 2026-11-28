import { describe, expect, it } from 'bun:test';
import type { EntityDef } from '@wobble/shared/types';
import { compileWindZones } from '@wobble/shared/course/obstacles/wind';
import { createWindField, STREAKS_PER_ZONE, VISUAL_SPEED } from './field.ts';
import { cssRotation, windOnScreen } from './screen.ts';

/** A seeded random so the streaks are the same every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fan = (id: number, pos: [number, number, number], yaw = 0, params: Record<string, unknown> = {}): EntityDef => ({
  id,
  kind: 'snowBlower',
  pos,
  yaw,
  // on for 3 s, off for 2 s (the last 0.5 s of that is the warning): ON 0-3, off 3-4.5, warn 4.5-5
  params: { reach: 40, width: 8, height: 3, windSpeed: 5, onSec: 3, offSec: 2, warnSec: 0.5, phase: 0, ...params },
});

const run = (field: ReturnType<typeof createWindField>, from: number, to: number, dt = 1 / 60) => {
  for (let t = from; t < to; t += dt) field.update(t, dt);
};
const visible = (f: ReturnType<typeof createWindField>, z = 0) => {
  let n = 0;
  for (let k = 0; k < STREAKS_PER_ZONE; k++) if (f.alpha[z * STREAKS_PER_ZONE + k]! > 0.05) n++;
  return n;
};

describe('wind field', () => {
  it('has no streaks without a fan', () => {
    const f = createWindField(compileWindZones([]));
    expect(f.count).toBe(0);
    f.update(1, 0.016);
  });

  it('has a fixed number of streaks per fan', () => {
    const f = createWindField(compileWindZones([fan(1, [0, 0, 0]), fan(2, [0, 0, -10])]), rng(1));
    expect(f.count).toBe(2 * STREAKS_PER_ZONE);
    expect(f.intensity).toHaveLength(2);
  });

  it('shows nothing while the fan is off, plenty while it blows, and some while it warns', () => {
    const zones = compileWindZones([fan(1, [0, 0, 0])]);
    const f = createWindField(zones, rng(2));
    run(f, 0, 2.5); // blowing
    const blowing = visible(f);
    expect(blowing).toBeGreaterThan(STREAKS_PER_ZONE * 0.4);
    expect(f.intensity[0]).toBeCloseTo(1, 1);
    run(f, 2.5, 4.3); // off (the warning starts at 4.5)
    expect(visible(f)).toBe(0);
    expect(f.intensity[0]).toBe(0);
    run(f, 4.3, 4.95); // warning: building toward the push
    const warning = visible(f);
    expect(warning).toBeGreaterThan(0);
    expect(warning).toBeLessThan(blowing);
    expect(f.intensity[0]!).toBeGreaterThan(0.2);
    expect(f.intensity[0]!).toBeLessThan(0.95);
  });

  it('the warning builds up: later in it there are more streaks than at its start', () => {
    const zones = compileWindZones([fan(1, [0, 0, 0], 0, { warnSec: 1.5, offSec: 3 })]);
    // off 3-4.5? with offSec 3 and warn 1.5 the warning is 4.5-6
    const f = createWindField(zones, rng(3));
    run(f, 0, 4.4);
    run(f, 4.4, 4.7);
    const early = f.intensity[0]!;
    run(f, 4.7, 5.9);
    expect(f.intensity[0]!).toBeGreaterThan(early);
  });

  it("streaks blow downwind: along the fan's +X for yaw 0, turned with the fan otherwise", () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, 2.2]) {
      const f = createWindField(compileWindZones([fan(1, [10, 1, -20], yaw)]), rng(4));
      run(f, 0, 1);
      for (let i = 0; i < f.count; i++) {
        expect(f.dir[i * 2]!).toBeCloseTo(Math.cos(yaw), 5);
        expect(f.dir[i * 2 + 1]!).toBeCloseTo(-Math.sin(yaw), 5);
        expect(Math.hypot(f.dir[i * 2]!, f.dir[i * 2 + 1]!)).toBeCloseTo(1, 5);
      }
    }
  });

  it("streaks stay inside the fan's wind box (along, across, and above the floor)", () => {
    const e = fan(1, [10, 1, -20], 0.7);
    const f = createWindField(compileWindZones([e]), rng(5));
    const c = Math.cos(0.7);
    const s = Math.sin(0.7);
    for (let t = 0; t < 2.9; t += 1 / 60) {
      f.update(t, 1 / 60);
      for (let i = 0; i < f.count; i++) {
        if (f.alpha[i]! === 0) continue;
        const dx = f.pos[i * 3]! - 10;
        const dz = f.pos[i * 3 + 2]! + 20;
        const lx = dx * c - dz * s; // along the wind
        const lz = dx * s + dz * c; // across
        expect(lx).toBeGreaterThanOrEqual(-4);
        expect(lx).toBeLessThanOrEqual(40 + 6);
        expect(Math.abs(lz)).toBeLessThanOrEqual(4 + 1e-4);
        expect(f.pos[i * 3 + 1]! - 1).toBeGreaterThan(0.2);
        expect(f.pos[i * 3 + 1]! - 1).toBeLessThan(4.1);
      }
    }
  });

  it('streaks move at the wind speed (a little faster, so it reads)', () => {
    const zones = compileWindZones([fan(1, [0, 0, 0], 0, { windSpeed: 6 })]);
    const f = createWindField(zones, rng(6));
    run(f, 0, 0.5);
    // follow one visible streak for a moment
    const i = Array.from({ length: f.count }, (_, k) => k).find((k) => f.alpha[k]! > 0.2)!;
    const x0 = f.pos[i * 3]!;
    f.update(0.5, 0.1);
    const moved = f.pos[i * 3]! - x0;
    expect(moved).toBeGreaterThan(0);
    expect(moved / 0.1).toBeGreaterThan(6 * 0.75 * 0.9); // at least the slowest streak at full intensity
    expect(moved / 0.1).toBeLessThan(6 * VISUAL_SPEED * 1.35 + 0.5);
  });

  it('a streak that reaches the far end starts again at the fan, so the wind never runs dry', () => {
    const zones = compileWindZones([fan(1, [0, 0, 0], 0, { onSec: 20, offSec: 1, reach: 20, windSpeed: 8 })]);
    const f = createWindField(zones, rng(7));
    run(f, 0, 1);
    const before = visible(f);
    run(f, 1, 15); // far longer than a streak takes to cross
    expect(visible(f)).toBeGreaterThan(before * 0.6);
    expect(visible(f)).toBeGreaterThan(STREAKS_PER_ZONE * 0.4);
  });

  it('fans take turns: each follows its own phase', () => {
    // fan 2 is shifted by 1.5 s: while fan 1 blows (race time 0-3 s) fan 2 is in its off time (3-4.5 s of its cycle)
    const zones = compileWindZones([fan(1, [0, 0, 0]), fan(2, [0, 0, -10], 0, { phase: 1.5 })]);
    const f = createWindField(zones, rng(8));
    run(f, 0, 2.7);
    expect(visible(f, 0)).toBeGreaterThan(10);
    expect(f.intensity[0]!).toBeGreaterThan(0.9);
    expect(visible(f, 1)).toBe(0);
    expect(f.intensity[1]!).toBe(0);
    // later fan 2 takes its turn while fan 1 rests: at 4.0 s fan 1 is off (3-4.5 s) and fan 2's cycle is at 0.5 s (on)
    run(f, 2.7, 4.0);
    expect(f.intensity[1]!).toBeGreaterThan(0.9);
    expect(f.intensity[0]!).toBeLessThan(0.05);
    expect(visible(f, 1)).toBeGreaterThan(10);
    expect(visible(f, 0)).toBe(0);
  });

  it('is deterministic for a given seed', () => {
    const make = () => {
      const f = createWindField(compileWindZones([fan(1, [0, 0, 0])]), rng(9));
      run(f, 0, 2);
      return Array.from(f.pos);
    };
    expect(make()).toEqual(make());
  });

  it('never produces NaN, even with a zero or negative step', () => {
    const f = createWindField(compileWindZones([fan(1, [0, 0, 0])]), rng(10));
    f.update(1, 0);
    f.update(1, -1);
    f.update(1e6, 0.016);
    for (const arr of [f.pos, f.dir, f.size, f.alpha, f.intensity])
      for (const x of arr) expect(Number.isFinite(x)).toBe(true);
  });
});

describe('wind on the screen', () => {
  it('wind blowing to the right of a camera facing -Z points right', () => {
    const w = windOnScreen(6, 0, 0);
    expect(w.angle).toBeCloseTo(0, 9);
    expect(w.speed).toBeCloseTo(6, 9);
    expect(cssRotation(w.angle)).toBeCloseTo(0, 9);
  });

  it('wind blowing away from you points up the screen, toward you points down, to the left points left', () => {
    expect(windOnScreen(0, -5, 0).angle).toBeCloseTo(Math.PI / 2, 9);
    expect(windOnScreen(0, 5, 0).angle).toBeCloseTo(-Math.PI / 2, 9);
    expect(Math.abs(windOnScreen(-5, 0, 0).angle)).toBeCloseTo(Math.PI, 9);
  });

  it('turns with the camera: the same wind looks different once you turn round', () => {
    // wind blowing toward +X; the camera turned a quarter turn left now faces -X, so the wind is behind you
    const behind = windOnScreen(5, 0, Math.PI / 2);
    expect(behind.angle).toBeCloseTo(-Math.PI / 2, 9);
    // turned to face +X, the same wind blows straight ahead
    const ahead = windOnScreen(5, 0, -Math.PI / 2);
    expect(ahead.angle).toBeCloseTo(Math.PI / 2, 9);
    // a full turn round makes no difference
    expect(windOnScreen(5, 0, 2 * Math.PI).angle).toBeCloseTo(windOnScreen(5, 0, 0).angle, 9);
  });

  it('css rotation turns the arrow the way the screen shows: up is a quarter turn anticlockwise', () => {
    expect(cssRotation(Math.PI / 2)).toBeCloseTo(-90, 9);
    expect(cssRotation(-Math.PI / 2)).toBeCloseTo(90, 9);
  });

  it('reuses the object it is given', () => {
    const o = { angle: 0, speed: 0 };
    expect(windOnScreen(1, 1, 0, o)).toBe(o);
  });
});
