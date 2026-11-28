import { describe, expect, it } from 'bun:test';
import { LIMITS } from '../constants.ts';
import { fixtureCourse } from '../fixtures/index.ts';
import type { CourseDef, EntityDef } from '../types.ts';
import { bouncePadReach, lintCourse } from './lint.ts';

/** Fresh copy of the fixture course (platforms only, 2 m gaps) with an edit applied. */
function broken(edit: (c: CourseDef) => void): string[] {
  const c = structuredClone(fixtureCourse);
  edit(c);
  return lintCourse(c).errors;
}
const platform = (id: number, pos: [number, number, number], size: [number, number, number]): EntityDef => ({
  id,
  kind: 'platform',
  pos,
  yaw: 0,
  params: { size, slot: 'platformA' },
});

describe('lintCourse', () => {
  it('passes the fixture course', () => {
    expect(lintCourse(fixtureCourse)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('catches too many entities', () => {
    const errs = broken((c) => {
      for (let i = 0; i < LIMITS.maxEntities; i++) c.entities.push(platform(100 + i, [0, -5, 0], [1, 1, 1]));
    });
    expect(errs.join()).toContain('too many entities');
  });

  it('catches a course longer than maxCourseLength', () => {
    expect(broken((c) => c.entities.push(platform(99, [0, 0, -500], [4, 1, 4]))).join()).toContain('too long');
  });

  it('catches geometry outside the int16 position range', () => {
    expect(broken((c) => c.entities.push(platform(99, [700, 0, 0], [4, 1, 4]))).join()).toContain('int16');
  });

  it('catches killY that is not below all geometry', () => {
    expect(broken((c) => (c.killY = 0)).join()).toContain('killY');
  });

  it('catches checkpoints out of order and a finish before the last checkpoint', () => {
    expect(broken((c) => (c.checkpoints[0].volume.pos[2] = 5)).join()).toContain('not further along');
    expect(broken((c) => (c.finish.pos[2] = -30)).join()).toContain('finish is not beyond');
  });

  it('catches a lane narrower than minLaneWidth', () => {
    expect(broken((c) => ((c.entities[2].params.size as number[])[0] = 0.8)).join()).toContain('narrower');
  });

  it('catches spawn and respawn grids off solid ground', () => {
    expect(broken((c) => (c.spawn.cols = 40)).join()).toContain('spawn grid is not fully on solid ground');
    expect(broken((c) => (c.checkpoints[0].respawn.pos[0] = 10)).join()).toContain('respawn grid');
  });

  it('catches a gap wider than maxGap', () => {
    // Move platform 4 (between the checkpoint pad and the finish) 3 m further away.
    const errs = broken((c) => (c.entities[4].pos[2] -= 3));
    expect(errs.join()).toContain('finish is unreachable');
    expect(errs.join()).toContain(`maxGap ${LIMITS.maxGap}`);
  });

  it('catches a step up higher than maxStepUp', () => {
    expect(broken((c) => (c.entities[2].pos[1] = LIMITS.maxStepUp + 0.4)).join()).toContain(
      'checkpoint 0 is unreachable',
    );
  });

  it('needs a timing window on a moving platform that is the only way across', () => {
    const withLift = (travelY: number, base: number) =>
      broken((c) => {
        c.entities[2] = {
          id: 2,
          kind: 'movingPlatform',
          pos: [0, base, -23],
          yaw: 0,
          params: { size: [6, 0.5, 6], travel: [0, travelY, 0], periodSec: 4 },
        };
      });
    // Bobs between +2 m and +5 m: always too high to step onto.
    expect(withLift(3, 2).join()).toContain('unreachable');
    // Bobs between 0 m and 3 m: reachable whenever it is low.
    expect(withLift(3, 0)).toEqual([]);
  });

  it('lets a bounce pad cross a gap wider than maxGap (#110)', () => {
    // Platform 2 moved back 3 m: a 5 m gap after platform 1 (front edge at z = -18).
    const widen = (c: CourseDef) => (c.entities[2].pos[2] -= 3);
    const pad = (params: Record<string, unknown>): EntityDef => ({
      id: 50,
      kind: 'bouncePad',
      pos: [0, 0.05, -16.9],
      yaw: 0,
      params: { size: [3.4, 0.4, 1.6], ...params },
    });
    expect(broken(widen).join()).toContain('checkpoint 0 is unreachable');
    expect(broken((c) => (widen(c), c.entities.push(pad({ bounce: 14, tilt: 0.12 }))))).toEqual([]);
    // A weak pad is no better than a jump.
    expect(broken((c) => (widen(c), c.entities.push(pad({ bounce: 6, tilt: 0.5 })))).join()).toContain('unreachable');
  });

  it('bouncePadReach grows with bounce, shrinks with tilt and never drops below maxGap', () => {
    expect(bouncePadReach(14, Math.cos(0.12))).toBeGreaterThan(6);
    expect(bouncePadReach(14, Math.cos(0.4))).toBeLessThan(bouncePadReach(14, 1));
    expect(bouncePadReach(18, 1)).toBeGreaterThan(bouncePadReach(14, 1));
    expect(bouncePadReach(1, 1)).toBe(LIMITS.maxGap);
  });

  it('warns about unknown kinds instead of failing', () => {
    const c = structuredClone(fixtureCourse);
    c.entities.push({ id: 99, kind: 'trampolineOfDoom', pos: [0, 0, 0], yaw: 0, params: {} });
    const r = lintCourse(c);
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toContain('unknown kind');
  });
});
