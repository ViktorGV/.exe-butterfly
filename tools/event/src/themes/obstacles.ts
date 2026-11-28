// What the props artist needs to dress obstacles well: what each kind does and the shape and size of
// every part, read from the real obstacle registry so it can never drift from the game.
import { getObstacleKind } from '@wobble/shared';
import { OBSTACLE_KINDS } from '@wobble/shared/constants';
import type { EntityDef } from '@wobble/shared/types';

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
};

const PART_ROLE: Partial<Record<(typeof OBSTACLE_KINDS)[number], string[]>> = {
  sweeper: ['hub', 'arm', 'arm'],
  pendulum: ['ball', 'rod (no collision)'],
  gate: ['left post', 'right post', 'top bar'],
};

const round = (v: number) => Math.round(v * 100) / 100;

export interface ObstacleBrief {
  kind: string;
  role: string;
  parts: { part: number; name: string; shape: string; halfExtents: [number, number, number] }[];
}

/** Every obstacle kind with its parts at default parameters (sizes are half extents in metres). */
export function obstacleBriefs(): ObstacleBrief[] {
  return OBSTACLE_KINDS.map((k) => {
    const def: EntityDef = { id: 1, kind: k, pos: [0, 0, 0], yaw: 0, params: {} };
    const parts = getObstacleKind(k)?.parts(def) ?? [];
    return {
      kind: k,
      role: ROLE[k],
      parts: parts.map((p, i) => {
        const [a, b, c] = p.size;
        const half: [number, number, number] =
          p.shape === 'box' ? [a, b, c] : p.shape === 'cylinder' ? [a, b, a] : [a, a, a];
        return { part: i, name: PART_ROLE[k]?.[i] ?? 'body', shape: p.shape, halfExtents: half.map(round) as never };
      }),
    };
  });
}
