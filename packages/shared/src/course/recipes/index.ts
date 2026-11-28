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
 * The polished default and the event course (#110): 7 obstacles, easy to hard, all short, so a good
 * player finishes in about 90 s. The snow blower field comes last: it is wide floor, where the
 * event villain (#84) throws.
 */
export const GUMDROP_GAUNTLET = course('gumdrop-gauntlet', {
  version: 1,
  name: 'Gumdrop Gauntlet',
  seed: 7,
  segments: [
    { type: 'sweeperRun', length: 'short', intensity: 2 },
    { type: 'bouncePads', length: 'short', intensity: 2 },
    { type: 'movingPlatforms', length: 'short', intensity: 2 },
    { type: 'spinnerDiscs', length: 'short', intensity: 2 },
    { type: 'narrowBridges', length: 'short', intensity: 3 },
    { type: 'slidingWalls', length: 'short', intensity: 3 },
    { type: 'snowBlowerField', length: 'short', intensity: 3 },
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
