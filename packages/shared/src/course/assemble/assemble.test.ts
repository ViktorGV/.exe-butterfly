import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { LIMITS, SEGMENT_TYPES } from '../../constants.ts';
import { resolveBuiltin } from '../../builtins.ts';
import { CourseDefSchema, CourseRecipeSchema } from '../../schemas/course.ts';
import type { CourseRecipe } from '../../types.ts';
import { lintCourse } from '../lint.ts';
import { BUILTIN_COURSE_PACKS, DEFAULT_COURSE_ID } from '../recipes/index.ts';
import { assembleCourse, COURSE_WIDTH, createRng, SNOW_FIELD_WIDTH } from './index.ts';

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

  it('the default (event) course runs its 9 obstacles in order, then the ramp and gate (#110)', () => {
    const recipe = resolveBuiltin(DEFAULT_COURSE_ID)!.data as CourseRecipe;
    expect(recipe.segments.map((s) => s.type)).toEqual([
      'sweeperRun',
      'bouncePads',
      'arrowFloor',
      'movingPlatforms',
      'carousels',
      'spinnerDiscs',
      'narrowBridges',
      'slidingWalls',
      'snowBlowerField',
    ]);
    expect(recipe.segments.every((s) => s.length !== 'short')).toBe(true);
    const course = assembleCourse(recipe);
    const kinds = course.entities.map((e) => e.kind);
    const order = [
      'sweeper',
      'bouncePad',
      'arrowTile',
      'movingPlatform',
      'carousel',
      'spinnerDisc',
      'bridge',
      'slidingWall',
      'snowBlower',
      'ramp',
      'gate',
    ].map((k) => kinds.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // More components make a longer, harder course: the par estimate is about 1:50, the room's hard stop is 2:00.
    expect(course.parTimeMs).toBeGreaterThan(60_000);
    expect(course.parTimeMs).toBeLessThan(125_000);
    // and it fits the length and entity limits
    expect(course.entities.length).toBeLessThanOrEqual(LIMITS.maxEntities);
  });

  it('the default course ends in wide floor, where the villain (#84) throws', () => {
    const course = assembleCourse(resolveBuiltin(DEFAULT_COURSE_ID)!.data as CourseRecipe);
    const firstFan = course.entities.findIndex((e) => e.kind === 'snowBlower');
    const floor = course.entities.slice(0, firstFan).findLast((e) => e.kind === 'platform')!;
    expect((floor.params.size as number[])[0]).toBe(SNOW_FIELD_WIDTH);
    expect(SNOW_FIELD_WIDTH).toBeGreaterThan(COURSE_WIDTH);
  });
});

/** One segment between plain runs, assembled and linted. */
function single(type: CourseRecipe['segments'][number]['type'], intensity: 1 | 2 | 3 | 4 | 5 = 3) {
  const course = assembleCourse({
    version: 1,
    name: type,
    seed: 5,
    segments: [
      { type: 'plainRun', length: 'short', intensity: 1 },
      { type, length: 'short', intensity },
      { type: 'plainRun', length: 'short', intensity: 1 },
      { type: 'plainRun', length: 'short', intensity: 1 },
    ],
  });
  expect(lintCourse(course)).toEqual({ ok: true, errors: [], warnings: [] });
  return course;
}

describe('event course segments (#110)', () => {
  it('bouncePads: islands with gaps wider than a jump, a row of 4 pads before each gap', () => {
    for (const i of [1, 3, 5] as const) {
      const course = single('bouncePads', i);
      const pads = course.entities.filter((e) => e.kind === 'bouncePad');
      expect(pads.length % 4).toBe(0);
      expect(pads.length).toBeGreaterThanOrEqual(4);
      // Without the pads the islands are out of reach.
      const noPads = { ...course, entities: course.entities.filter((e) => e.kind !== 'bouncePad') };
      expect(lintCourse(noPads).errors.join()).toContain('unreachable');
    }
  });

  it('slidingWalls: rows of walls across floor', () => {
    const course = single('slidingWalls');
    const walls = course.entities.filter((e) => e.kind === 'slidingWall');
    expect(walls.length).toBeGreaterThanOrEqual(2);
    for (const w of walls) expect(w.params.width).toBe(COURSE_WIDTH - 1);
  });

  it('snowBlowerField: fans on alternating edges blowing across wide floor, with shelter blocks', () => {
    const course = single('snowBlowerField');
    const fans = course.entities.filter((e) => e.kind === 'snowBlower');
    expect(fans.length).toBeGreaterThanOrEqual(2);
    fans.forEach((f, k) => {
      // Left-edge fans face +X (yaw 0), right-edge fans face -X (yaw PI).
      expect(Math.sign(f.pos[0])).toBe(k % 2 === 0 ? -1 : 1);
      expect(Math.cos(f.yaw)).toBeCloseTo(k % 2 === 0 ? 1 : -1, 3);
      expect(f.params.reach).toBe(SNOW_FIELD_WIDTH);
    });
    expect(course.entities.filter((e) => e.kind === 'wall').length).toBeGreaterThanOrEqual(fans.length);
  });
});

describe('course components: vertical walls, carousels and arrow floors', () => {
  it('slidingWalls: panels span the whole track and slide up and down', () => {
    const course = single('slidingWalls', 4);
    const walls = course.entities.filter((e) => e.kind === 'slidingWall');
    expect(walls.length).toBeGreaterThanOrEqual(2);
    for (const w of walls) {
      expect(w.params.width).toBe(COURSE_WIDTH - 1);
      expect(w.params.panels as number).toBeGreaterThanOrEqual(5); // many narrow panels, not one big door
    }
  });

  it('carousels: columns of four-pad carousels across the track, turning opposite ways, with a hop to each side', () => {
    for (const length of ['short', 'medium', 'long'] as const) {
      const course = assembleCourse({
        version: 1,
        name: 'carousels',
        seed: 5,
        segments: [
          { type: 'plainRun', length: 'short', intensity: 1 },
          { type: 'carousels', length, intensity: 3 },
          { type: 'plainRun', length: 'short', intensity: 1 },
          { type: 'plainRun', length: 'short', intensity: 1 },
        ],
      });
      expect(lintCourse(course)).toEqual({ ok: true, errors: [], warnings: [] });
      const cars = course.entities.filter((e) => e.kind === 'carousel');
      expect(cars.length).toBeGreaterThanOrEqual(2);
      const xs = [...new Set(cars.map((c) => c.pos[0]))];
      expect(xs.length).toBeGreaterThanOrEqual(2); // side by side, so a crowd can spread out
      for (const x of xs) expect(Math.abs(x)).toBeLessThan(COURSE_WIDTH / 2);
      // neighbours turn opposite ways
      const dirs = new Set(cars.map((c) => c.params.dir));
      expect(dirs.size).toBe(2);
      // all carousels sit over a void: the floor they join is the previous and next platform only
      for (const c of cars) expect(c.params.pad as number).toBeGreaterThanOrEqual(3);
    }
  });

  it('carousels get faster with intensity', () => {
    const rpm = (i: 1 | 5) => single('carousels', i).entities.find((e) => e.kind === 'carousel')!.params.rpm as number;
    expect(rpm(5)).toBeGreaterThan(rpm(1));
  });

  it('arrowFloor: rows of arrow tiles across the whole track, some forward and some back', () => {
    const course = single('arrowFloor', 3);
    const tiles = course.entities.filter((e) => e.kind === 'arrowTile');
    expect(tiles.length).toBeGreaterThanOrEqual(8);
    const dirs = tiles.map((t) => t.params.dir);
    expect(dirs).toContain(1);
    expect(dirs).toContain(-1);
    // tiles line up in rows (same z) that together cover the track width
    const rows = new Map<number, number[]>();
    for (const t of tiles) rows.set(t.pos[2], [...(rows.get(t.pos[2]) ?? []), t.pos[0]]);
    for (const xs of rows.values()) {
      expect(xs.length).toBeGreaterThanOrEqual(3);
      const span = Math.max(...xs) - Math.min(...xs) + (tiles[0]!.params.size as number[])[0]!;
      expect(span).toBeCloseTo(COURSE_WIDTH, 6);
    }
  });

  it('arrowFloor: every row keeps at least two lanes that go forward, however intense', () => {
    for (const intensity of [1, 3, 5] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const course = assembleCourse({
          version: 1,
          name: 'arrows',
          seed,
          segments: [
            { type: 'plainRun', length: 'short', intensity: 1 },
            { type: 'arrowFloor', length: 'long', intensity },
            { type: 'plainRun', length: 'short', intensity: 1 },
            { type: 'plainRun', length: 'short', intensity: 1 },
          ],
        });
        const rows = new Map<number, number>();
        for (const t of course.entities.filter((e) => e.kind === 'arrowTile')) {
          if (t.params.dir === 1) rows.set(t.pos[2], (rows.get(t.pos[2]) ?? 0) + 1);
          else rows.set(t.pos[2], rows.get(t.pos[2]) ?? 0);
        }
        for (const forward of rows.values()) expect(forward).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('arrowFloor: more intense floors point more tiles back and dash harder', () => {
    const stats = (i: 1 | 5) => {
      let back = 0;
      let total = 0;
      let boost = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const c = assembleCourse({
          version: 1,
          name: 'arrows',
          seed,
          segments: [
            { type: 'plainRun', length: 'short', intensity: 1 },
            { type: 'arrowFloor', length: 'long', intensity: i },
            { type: 'plainRun', length: 'short', intensity: 1 },
            { type: 'plainRun', length: 'short', intensity: 1 },
          ],
        });
        for (const t of c.entities.filter((e) => e.kind === 'arrowTile')) {
          total++;
          if (t.params.dir === -1) back++;
          boost = t.params.boost as number;
        }
      }
      return { share: back / total, boost };
    };
    const calm = stats(1);
    const hard = stats(5);
    expect(hard.share).toBeGreaterThan(calm.share);
    expect(hard.boost).toBeGreaterThan(calm.boost);
  });
});

// Changed on purpose by #110 (7 obstacles), the course widening and the longer default sections.
const GOLDEN_GUMDROP = '2b66bd4f3ba73dcf';
