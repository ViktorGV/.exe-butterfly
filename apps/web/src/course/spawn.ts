// Spawn-grid maths (docs/CONTRACTS.md §4 "Spawn grids"). Pure, no Three.js.
import { rotateYaw } from '@wobble/shared/course/obstacles/math';
import type { CheckpointDef, SpawnGrid, Vec3 } from '@wobble/shared/types';

export interface SpawnPoint {
  pos: Vec3;
  yaw: number;
}

const off: Vec3 = [0, 0, 0];

/**
 * World point of `slot` in a grid: row floor(n / cols), column n % cols. Columns are centred on
 * `pos` across the row (column 0 on the left, local -X); row 0 sits at `pos` and later rows step
 * back along local +Z (behind the facing direction), `spacing` metres apart.
 */
export function gridPoint(grid: SpawnGrid, slot: number, out: SpawnPoint = { pos: [0, 0, 0], yaw: 0 }): SpawnPoint {
  const n = Number.isFinite(slot) && slot > 0 ? Math.floor(slot) : 0;
  const cols = Math.max(1, Math.floor(grid.cols));
  const row = Math.floor(n / cols);
  const col = n % cols;
  rotateYaw((col - (cols - 1) / 2) * grid.spacing, 0, row * grid.spacing, grid.yaw, off);
  out.pos[0] = grid.pos[0] + off[0];
  out.pos[1] = grid.pos[1] + off[1];
  out.pos[2] = grid.pos[2] + off[2];
  out.yaw = grid.yaw;
  return out;
}

/**
 * Grid to respawn on after reaching `checkpoint` (PlayerState.checkpoint: -1 before the first).
 * Indexes past the end use the last checkpoint.
 */
export function respawnGrid(spawn: SpawnGrid, checkpoints: readonly CheckpointDef[], checkpoint: number): SpawnGrid {
  if (!(checkpoint >= 0) || checkpoints.length === 0) return spawn;
  return checkpoints[Math.min(Math.floor(checkpoint), checkpoints.length - 1)].respawn;
}
