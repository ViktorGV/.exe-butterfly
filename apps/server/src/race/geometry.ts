// Pure geometry for the race session: spawn-grid areas and swept tests against oriented boxes.
import type { SpawnGrid, Vec3, Volume } from '@wobble/shared/types';

/** Slots a grid must hold (rooms of up to 300 players). */
export const GRID_SLOTS = 300;

const tmp: Vec3 = [0, 0, 0];
const la: Vec3 = [0, 0, 0];
const lb: Vec3 = [0, 0, 0];

/** local = R(-yaw) * (world - origin), written into `out`. */
function toLocal(x: number, y: number, z: number, origin: Vec3, yaw: number, out: Vec3): Vec3 {
  const dx = x - origin[0];
  const dz = z - origin[2];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out[0] = dx * c - dz * s;
  out[1] = y - origin[1];
  out[2] = dx * s + dz * c;
  return out;
}

/** World position of `slot` in a grid (row-major, centred across the row, rows step back along local +Z). */
export function gridPoint(grid: SpawnGrid, slot: number, out: Vec3): Vec3 {
  const cols = Math.max(1, Math.floor(grid.cols));
  const n = slot > 0 ? Math.floor(slot) : 0;
  const lx = ((n % cols) - (cols - 1) / 2) * grid.spacing;
  const lz = Math.floor(n / cols) * grid.spacing;
  const c = Math.cos(grid.yaw);
  const s = Math.sin(grid.yaw);
  out[0] = grid.pos[0] + lx * c + lz * s;
  out[1] = grid.pos[1];
  out[2] = grid.pos[2] - lx * s + lz * c;
  return out;
}

/** True when (x, y, z) lies on the grid's footprint grown by `margin`, at most `up` metres above it. */
export function inGrid(grid: SpawnGrid, x: number, y: number, z: number, margin: number, up: number): boolean {
  const cols = Math.max(1, Math.floor(grid.cols));
  const rows = Math.ceil(GRID_SLOTS / cols);
  const halfW = ((cols - 1) * grid.spacing) / 2;
  const back = (rows - 1) * grid.spacing;
  const l = toLocal(x, y, z, grid.pos, grid.yaw, tmp);
  return (
    l[0] >= -halfW - margin &&
    l[0] <= halfW + margin &&
    l[2] >= -margin &&
    l[2] <= back + margin &&
    l[1] >= -2 &&
    l[1] <= up
  );
}

/**
 * Swept test of the segment p0 -> p1 against an oriented box. Returns the entry fraction in [0, 1]
 * (0 when p0 is already inside), or -1 when the segment misses the box.
 */
export function sweepVolume(v: Volume, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  toLocal(x0, y0, z0, v.pos, v.yaw, la);
  toLocal(x1, y1, z1, v.pos, v.yaw, lb);
  let tMin = 0;
  let tMax = 1;
  for (let k = 0; k < 3; k++) {
    const d = lb[k] - la[k];
    const h = v.half[k];
    if (Math.abs(d) < 1e-12) {
      if (la[k] < -h || la[k] > h) return -1;
      continue;
    }
    let t0 = (-h - la[k]) / d;
    let t1 = (h - la[k]) / d;
    if (t0 > t1) {
      const t = t0;
      t0 = t1;
      t1 = t;
    }
    if (t0 > tMin) tMin = t0;
    if (t1 < tMax) tMax = t1;
    if (tMin > tMax) return -1;
  }
  return tMin;
}

/** Horizontal distance from a point to a volume's centre. */
export function distToVolume(v: Volume, x: number, z: number): number {
  return Math.hypot(x - v.pos[0], z - v.pos[2]);
}
