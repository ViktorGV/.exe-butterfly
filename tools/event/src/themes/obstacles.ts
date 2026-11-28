// What the props artist needs to dress obstacles well: what each kind does and the shape and size of
// every part, read from the real obstacle registry so it can never drift from the game.
import { assembleCourse, getObstacleKind, resolveBuiltin } from '@wobble/shared';
import { OBSTACLE_KINDS } from '@wobble/shared/constants';
import { DEFAULT_COURSE_ID } from '@wobble/shared/course/recipes/index';
import type { CourseRecipe, EntityDef } from '@wobble/shared/types';

/** What the obstacle does in play, so the dressing can turn it into something themed with the same job. */
const ROLE: Record<(typeof OBSTACLE_KINDS)[number], string> = {
  platform: 'a static floor tile players run on',
  ramp: 'a sloped floor players run up',
  sweeper: 'a hub with long arms spinning flat over the floor; players jump the arms',
  movingPlatform: 'a floor tile sliding back and forth; players ride it',
  bumper: 'a round pad that bounces players away',
  bridge: 'a long narrow walkway over a gap',
  spinnerDisc: 'a big flat spinning disc players cross',
  pendulum: 'a heavy ball swinging on a rod; players dodge the ball',
  gate: 'two posts and a top bar; players run through the gap',
  wall: 'a low barrier players jump over',
  bouncePad: 'a flat pad set into the floor that launches players up and forward over a gap',
  slidingWall: 'a row of wall panels between two posts, each sliding up and down in turn; some panel is always raised',
  carousel: 'four separate pads on a slowly rotating cross over a gap; players hop onto a pad, ride it and hop off',
  arrowTile:
    'a floor tile with arrows that dashes players along the arrows, toward the finish or back toward the start',
  snowBlower: 'a big fan at the side of the floor that blows players sideways while it is on',
};

const PART_ROLE: Partial<Record<(typeof OBSTACLE_KINDS)[number], string[]>> = {
  sweeper: ['hub', 'arm', 'arm'],
  pendulum: ['ball', 'rod (no collision)'],
  gate: ['left post', 'right post', 'top bar'],
  slidingWall: ['left post', 'right post', 'panel', 'panel', 'panel', 'panel', 'panel'],
  snowBlower: ['fan housing', 'rotor (no collision)'],
};

const round = (v: number) => Math.round(v * 100) / 100;

export interface ObstacleBrief {
  kind: string;
  role: string;
  parts: { part: number; name: string; shape: string; slot: string; halfExtents: [number, number, number] }[];
}

/** Obstacle kinds the default (event) course actually uses, in course order. */
function courseKinds(): string[] {
  try {
    const course = assembleCourse(resolveBuiltin(DEFAULT_COURSE_ID)!.data as CourseRecipe);
    return [...new Set(course.entities.map((e) => e.kind))];
  } catch {
    return [];
  }
}

/**
 * Every obstacle kind with its parts at default parameters (sizes are half extents in metres). Kinds on the
 * event course come first, so when the 24-entry dressing limit cuts the list, only unused kinds are lost.
 */
export function obstacleBriefs(): ObstacleBrief[] {
  const used = courseKinds();
  const rank = (k: string) => (used.includes(k) ? used.indexOf(k) : used.length + OBSTACLE_KINDS.indexOf(k as never));
  return [...OBSTACLE_KINDS]
    .sort((a, b) => rank(a) - rank(b))
    .map((k) => {
      const def: EntityDef = { id: 1, kind: k, pos: [0, 0, 0], yaw: 0, params: {} };
      const parts = getObstacleKind(k)?.parts(def) ?? [];
      return {
        kind: k,
        role: ROLE[k],
        parts: parts.map((p, i) => {
          const [a, b, c] = p.size;
          const half: [number, number, number] =
            p.shape === 'box' ? [a, b, c] : p.shape === 'cylinder' ? [a, b, a] : [a, a, a];
          return {
            part: i,
            name: PART_ROLE[k]?.[i] ?? 'body',
            shape: p.shape,
            slot: p.slot,
            halfExtents: half.map(round) as never,
          };
        }),
      };
    });
}

/** Seen the most, so dressed first: the floor, the gates and the ramp. */
const FIRST = ['platform', 'gate', 'ramp', 'movingPlatform', 'bridge'];

/**
 * The parts that fit the contract's 24 dressing entries: course kinds only, the most visible first, then in
 * course order. A kind may be cut part-way; its undressed parts keep their themed material.
 */
export function dressableBriefs(max = 24): ObstacleBrief[] {
  const used = courseKinds();
  const pool = obstacleBriefs().filter((b) => used.length === 0 || used.includes(b.kind));
  const rank = (k: string) => (FIRST.includes(k) ? FIRST.indexOf(k) : FIRST.length + used.indexOf(k));
  const out: ObstacleBrief[] = [];
  let left = max;
  for (const b of pool.sort((a, z) => rank(a.kind) - rank(z.kind))) {
    if (left <= 0) break;
    const parts = b.parts.slice(0, left);
    out.push({ ...b, parts });
    left -= parts.length;
  }
  return out;
}
