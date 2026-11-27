// Checkpoint arches and the finish gate: plain primitives, visual only (they never collide; the
// trigger volumes in the CourseDef decide checkpoints and the finish). Each piece is placed on the
// volume's entry edge (local +Z, the side players arrive from) and merged with the static course.
import { quatFromYaw, rotateYaw } from '@wobble/shared/course/obstacles/math';
import type { MaterialSlot, Pose, Shape, Vec3, Volume } from '@wobble/shared/types';

export interface MarkerPiece {
  shape: Shape;
  /** Same convention as PartDef.size. */
  size: Vec3;
  slot: MaterialSlot;
  pose: Pose;
}

const POST_RADIUS = 0.3;
const off: Vec3 = [0, 0, 0];

function piece(v: Volume, shape: Shape, size: Vec3, slot: MaterialSlot, lx: number, ly: number, lz: number) {
  rotateYaw(lx, ly, lz, v.yaw, off);
  const pose: Pose = {
    pos: [v.pos[0] + off[0], v.pos[1] + off[1], v.pos[2] + off[2]],
    quat: quatFromYaw(v.yaw, [0, 0, 0, 1]),
  };
  return { shape, size, slot, pose };
}

/** Two posts and a bar across the volume's entry edge; returns the bar's local height. */
function arch(v: Volume, out: MarkerPiece[], postSlot: MaterialSlot, bar: Vec3, barSlot: MaterialSlot) {
  const [hx, hy, hz] = v.half;
  const height = Math.max(4, hy * 2 + 1.5);
  const floor = -hy;
  const x = hx + POST_RADIUS;
  for (const side of [-1, 1]) {
    out.push(piece(v, 'cylinder', [POST_RADIUS, height / 2, 0], postSlot, side * x, floor + height / 2, hz));
    out.push(piece(v, 'sphere', [POST_RADIUS * 1.6, 0, 0], barSlot, side * x, floor + height + bar[1], hz));
  }
  out.push(piece(v, 'box', [x + POST_RADIUS, bar[1], bar[2]], barSlot, 0, floor + height, hz));
  return floor + height;
}

/** Checkpoint: an arch with a row of alternating flags under the bar and a stripe on the floor. */
export function checkpointMarker(v: Volume, out: MarkerPiece[] = []): MarkerPiece[] {
  const top = arch(v, out, 'rail', [0, 0.3, 0.3], 'accent');
  const [hx, hy, hz] = v.half;
  const flags = Math.max(2, Math.floor((hx * 2) / 1.5));
  for (let i = 0; i < flags; i++) {
    const x = -hx + ((i + 0.5) * hx * 2) / flags;
    out.push(piece(v, 'box', [0.3, 0.4, 0.05], i % 2 ? 'bouncy' : 'hazard', x, top - 0.7, hz));
  }
  out.push(piece(v, 'box', [hx, 0.02, 0.25], 'accent', 0, -hy + 0.02, hz));
  return out;
}

/** Finish: a tall banner on posts and a two-row checkered strip on the floor. */
export function finishMarker(v: Volume, out: MarkerPiece[] = []): MarkerPiece[] {
  arch(v, out, 'accent', [0, 0.8, 0.15], 'finish');
  const [hx, hy, hz] = v.half;
  const tiles = Math.max(2, Math.round(hx * 2));
  const tile = (hx * 2) / tiles;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < tiles; i++) {
      const slot: MaterialSlot = (i + row) % 2 ? 'finish' : 'hazard';
      const x = -hx + (i + 0.5) * tile;
      out.push(piece(v, 'box', [tile / 2, 0.02, tile / 2], slot, x, -hy + 0.02, hz - (row + 0.5) * tile));
    }
  }
  return out;
}
