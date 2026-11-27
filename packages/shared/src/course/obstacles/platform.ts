// `platform`: a static box. `pos` is the centre of the TOP surface; `size` is the full size [w, h, d].
import { z } from 'zod';
import { MATERIAL_SLOTS } from '../../constants.ts';
import type { EntityDef, ObstacleKind, Vec3 } from '../../types.ts';
import { quatFromYaw } from './math.ts';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const paramsSchema = z.object({
  size: z
    .tuple([z.number(), z.number(), z.number()])
    .default([4, 1, 4])
    .transform(([w, h, d]): Vec3 => [clamp(w, 0.5, 60), clamp(h, 0.2, 10), clamp(d, 0.5, 60)]),
  slot: z.enum(MATERIAL_SLOTS).catch('platformA').default('platformA'),
});

type PlatformParams = z.output<typeof paramsSchema>;

/** Parsed params, cached per entity so pose() allocates nothing after the first call. */
const cache = new WeakMap<EntityDef, PlatformParams>();

function params(def: EntityDef): PlatformParams {
  let p = cache.get(def);
  if (!p) {
    p = paramsSchema.parse(def.params ?? {});
    cache.set(def, p);
  }
  return p;
}

export const platform: ObstacleKind = {
  kind: 'platform',
  paramsSchema,
  parts(def) {
    const { size, slot } = params(def);
    return [
      {
        shape: 'box',
        size: [size[0] / 2, size[1] / 2, size[2] / 2],
        surface: 'solid',
        slot,
        collide: true,
        visible: true,
      },
    ];
  },
  pose(def, _t, out) {
    // Static: the part's centre sits half its height below the top surface.
    const p = out[0];
    const h = params(def).size[1];
    p.pos[0] = def.pos[0];
    p.pos[1] = def.pos[1] - h / 2;
    p.pos[2] = def.pos[2];
    quatFromYaw(def.yaw, p.quat);
  },
};
