import { describe, expect, it } from 'bun:test';
import {
  assembleCourse,
  CourseDefSchema,
  drawPattern,
  fixtureRecipe,
  fixtureSkin,
  lintCourse,
  listBuiltins,
  resolveBuiltin,
  sanitizePack,
  PACK_KINDS,
} from './index.ts';
import type { PackKind } from './types.ts';

describe('shared seams (stubs seeded by #2)', () => {
  it('assembleCourse returns a valid CourseDef', () => {
    const course = assembleCourse(fixtureRecipe);
    expect(CourseDefSchema.safeParse(course).success).toBe(true);
    expect(course.name).toBe(fixtureRecipe.name);
  });

  it('lintCourse returns a result', () => {
    expect(lintCourse(assembleCourse(fixtureRecipe))).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('sanitizePack accepts valid data and never throws on garbage', () => {
    expect(sanitizePack('skin', fixtureSkin)).toMatchObject({ ok: true, issues: [] });
    for (const bad of [null, 42, 'x', {}, [], { version: 2 }]) {
      expect(() => sanitizePack('skin', bad)).not.toThrow();
      expect(sanitizePack('skin', bad).ok).toBe(false);
    }
    expect(sanitizePack('music' as PackKind, {}).ok).toBe(false);
  });

  it('drawPattern draws through the Canvas 2D interface', () => {
    const calls: unknown[][] = [];
    const ctx = {
      set fillStyle(v: string) {
        calls.push(['fillStyle', v]);
      },
      fillRect: (...a: number[]) => calls.push(['fillRect', ...a]),
    };
    drawPattern(ctx as unknown as Parameters<typeof drawPattern>[0], fixtureSkin.body.pattern, 64);
    expect(calls).toEqual([
      ['fillStyle', '#ff8a3d'],
      ['fillRect', 0, 0, 64, 64],
    ]);
  });

  it('resolveBuiltin finds every built-in and rejects other ids', () => {
    for (const kind of PACK_KINDS) expect(listBuiltins(kind).length).toBeGreaterThan(0);
    for (const pack of listBuiltins()) expect(resolveBuiltin(pack.id)).toBe(pack);
    expect(resolveBuiltin('b:nope')).toBeNull();
    expect(resolveBuiltin('g:fixture-skin')).toBeNull();
  });
});
