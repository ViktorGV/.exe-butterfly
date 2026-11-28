// Built-in course packs (#15), read by resolveBuiltin() in ../../builtins.ts. Original layouts.
import { fixtureCoursePack } from '../../fixtures/index.ts';
import type { CourseRecipe, Pack } from '../../types.ts';

const CREATED = '2026-11-27T00:00:00.000Z';

const course = (slug: string, data: CourseRecipe): Pack => ({
  id: `b:${slug}`,
  kind: 'course',
  name: data.name,
  createdAt: CREATED,
  data,
});

/**
 * The polished default and the event course (#110): 9 obstacles, easy to hard. A mix of timing (sweepers,
 * rising walls), hopping (platforms, a carousel, spinning discs), launch pads, arrow tiles that dash you
 * forward or back, and narrow bridges. The snow blower field comes last: it is wide floor, where the event
 * villain (#84) throws.
 */
export const GUMDROP_GAUNTLET = course('gumdrop-gauntlet', {
  version: 1,
  name: 'Gumdrop Gauntlet',
  seed: 7,
  segments: [
    { type: 'sweeperRun', length: 'medium', intensity: 3 },
    { type: 'bouncePads', length: 'medium', intensity: 3 },
    { type: 'arrowFloor', length: 'medium', intensity: 3 },
    { type: 'movingPlatforms', length: 'medium', intensity: 4 },
    { type: 'carousels', length: 'medium', intensity: 3 },
    { type: 'spinnerDiscs', length: 'medium', intensity: 4 },
    { type: 'narrowBridges', length: 'medium', intensity: 4 },
    { type: 'slidingWalls', length: 'medium', intensity: 4 },
    { type: 'snowBlowerField', length: 'medium', intensity: 4 },
  ],
});

/** Short and gentle, for first-time players. */
export const FIRST_WOBBLE = course('first-wobble', {
  version: 1,
  name: 'First Wobble',
  seed: 11,
  segments: [
    { type: 'plainRun', length: 'short', intensity: 1 },
    { type: 'sweeperRun', length: 'short', intensity: 1 },
    { type: 'bumperField', length: 'short', intensity: 1 },
    { type: 'narrowBridges', length: 'short', intensity: 1 },
  ],
});

/** Hard: heavy on spinners and pendulums. */
export const SPIN_CYCLE = course('spin-cycle', {
  version: 1,
  name: 'Spin Cycle',
  seed: 23,
  segments: [
    { type: 'spinnerDiscs', length: 'medium', intensity: 3 },
    { type: 'pendulumAlley', length: 'medium', intensity: 4 },
    { type: 'sweeperRun', length: 'medium', intensity: 4 },
    { type: 'spinnerDiscs', length: 'long', intensity: 5 },
    { type: 'pendulumAlley', length: 'medium', intensity: 5 },
    { type: 'gateDash', length: 'medium', intensity: 4 },
  ],
});

export const DEFAULT_COURSE_ID = GUMDROP_GAUNTLET.id;

export const BUILTIN_COURSE_PACKS: Pack[] = [GUMDROP_GAUNTLET, FIRST_WOBBLE, SPIN_CYCLE, fixtureCoursePack];
