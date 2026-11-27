import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { LIMITS, SEGMENT_TYPES } from '../../constants.ts';
import { resolveBuiltin } from '../../builtins.ts';
import { CourseDefSchema, CourseRecipeSchema } from '../../schemas/course.ts';
import type { CourseRecipe } from '../../types.ts';
import { lintCourse } from '../lint.ts';
import { BUILTIN_COURSE_PACKS, DEFAULT_COURSE_ID } from '../recipes/index.ts';
import { assembleCourse, createRng } from './index.ts';

function randomRecipe(seed: number): CourseRecipe {
  const rand = createRng(seed * 7919 + 1);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const count = 4 + Math.floor(rand() * 9); // 4..12
  return CourseRecipeSchema.parse({
    version: 1,
    name: `Fuzz ${seed}`,
    seed: Math.floor(rand() * 1e9),
    segments: Array.from({ length: count }, () => ({
      type: pick(SEGMENT_TYPES),
      length: pick(['short', 'medium', 'long'] as const),
      intensity: pick([1, 2, 3, 4, 5] as const),
    })),
  });
}

describe('assembleCourse', () => {
  it('1,000 random recipes all assemble into valid courses that lint clean', () => {
    for (let i = 0; i < 1000; i++) {
      const recipe = randomRecipe(i);
      const course = assembleCourse(recipe);
      expect(CourseDefSchema.safeParse(course).success).toBe(true);
      const lint = lintCourse(course);
      if (!lint.ok) throw new Error(`recipe ${i} ${JSON.stringify(recipe.segments)}: ${lint.errors.join('; ')}`);
      expect(course.checkpoints.length).toBe(recipe.segments.length);
      expect(course.entities.length).toBeLessThanOrEqual(LIMITS.maxEntities);
    }
  });

  it('is deterministic: the same recipe gives a byte-identical course', () => {
    const recipe = randomRecipe(42);
    expect(JSON.stringify(assembleCourse(recipe))).toBe(JSON.stringify(assembleCourse(structuredClone(recipe))));
    expect(JSON.stringify(assembleCourse({ ...recipe, seed: recipe.seed + 1 }))).not.toBe(
      JSON.stringify(assembleCourse(recipe)),
    );
  });

  it('matches the committed golden hash for the default course (catches engine or code drift)', () => {
    const json = JSON.stringify(assembleCourse(resolveBuiltin(DEFAULT_COURSE_ID)!.data as CourseRecipe));
    expect(createHash('sha256').update(json).digest('hex').slice(0, 16)).toBe(GOLDEN_GUMDROP);
  });

  it('follows the crowd rules: 300-slot spawn grid, wide open sections, 4+ bridge lanes, big pads', () => {
    const course = assembleCourse({
      version: 1,
      name: 'Crowd',
      seed: 1,
      segments: [
        { type: 'narrowBridges', length: 'short', intensity: 5 },
        { type: 'sweeperRun', length: 'short', intensity: 1 },
        { type: 'movingPlatforms', length: 'short', intensity: 3 },
        { type: 'plainRun', length: 'short', intensity: 1 },
      ],
    });
    expect(course.spawn.cols * Math.ceil(300 / course.spawn.cols)).toBeGreaterThanOrEqual(300);
    const bridges = course.entities.filter((e) => e.kind === 'bridge');
    expect(bridges.length).toBeGreaterThanOrEqual(4);
    const platforms = course.entities.filter((e) => e.kind === 'platform');
    for (const p of platforms) expect((p.params.size as number[])[0]).toBeGreaterThanOrEqual(14);
    for (const cp of course.checkpoints) {
      expect(cp.volume.half[0] * 2).toBeGreaterThanOrEqual(14);
      expect(cp.volume.half[2] * 2).toBeGreaterThanOrEqual(8);
    }
    const lanes = new Set(course.entities.filter((e) => e.kind === 'movingPlatform').map((e) => e.pos[0]));
    expect(lanes.size).toBeGreaterThanOrEqual(4);
  });

  it('fills bounds, killY and times', () => {
    const course = assembleCourse(randomRecipe(3));
    expect(course.bounds.min[2]).toBeLessThan(course.finish.pos[2]);
    expect(course.killY).toBeLessThan(0);
    expect(course.timeLimitMs).toBeGreaterThan(course.parTimeMs);
  });
});

describe('built-in courses', () => {
  it('assemble, lint clean and resolve by id', () => {
    for (const id of ['b:gumdrop-gauntlet', 'b:first-wobble', 'b:spin-cycle']) {
      const pack = resolveBuiltin(id);
      expect(pack?.kind).toBe('course');
      const course = assembleCourse(pack!.data as CourseRecipe);
      expect(lintCourse(course)).toEqual({ ok: true, errors: [], warnings: [] });
    }
    expect(BUILTIN_COURSE_PACKS.map((p) => p.id)).toContain(DEFAULT_COURSE_ID);
  });

  it('the default course has the brief: sweepers, moving platforms, bumpers, narrow bridges, ramp and gate', () => {
    const course = assembleCourse(resolveBuiltin(DEFAULT_COURSE_ID)!.data as CourseRecipe);
    const kinds = course.entities.map((e) => e.kind);
    const order = ['sweeper', 'movingPlatform', 'bumper', 'bridge', 'ramp', 'gate'].map((k) => kinds.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // 60-90 s for a decent player: the par estimate sits in the lower half of that.
    expect(course.parTimeMs).toBeGreaterThan(45_000);
    expect(course.parTimeMs).toBeLessThan(90_000);
  });
});

const GOLDEN_GUMDROP = 'ffeaba958ca6a7d0';
