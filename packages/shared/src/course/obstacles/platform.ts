// `platform`: a static box. `pos` is the centre of the TOP surface; `size` is the full size [w, h, d].
import { z } from 'zod';
import { defineKind, part, place, slot, vec3 } from './common.ts';

export const platform = defineKind({
  kind: 'platform',
  schema: z.object({
    size: vec3([4, 1, 4], [0.5, 0.2, 0.5], [60, 10, 60]),
    slot: slot('platformA'),
  }),
  parts: (_d, p) => [part('box', [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2], p.slot)],
  pose: (def, p, _t, out) => place(def, 0, -p.size[1] / 2, 0, null, out[0]),
  period: () => 0,
  maxSpeed: () => 0,
});
