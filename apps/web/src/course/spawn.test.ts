import { describe, expect, it } from 'bun:test';
import { MAX_PLAYERS_PER_ROOM } from '@wobble/shared/constants';
import type { CheckpointDef, SpawnGrid } from '@wobble/shared/types';
import { gridPoint, respawnGrid } from './spawn.ts';

const EPS = 1e-9;

describe('gridPoint', () => {
  for (const yaw of [0, Math.PI / 2, -0.7, Math.PI]) {
    it(`gives ${MAX_PLAYERS_PER_ROOM} distinct points at the right spacing (yaw ${yaw.toFixed(2)})`, () => {
      const grid: SpawnGrid = { pos: [3, 2, -9], yaw, cols: 20, spacing: 1.25 };
      const pts = Array.from({ length: MAX_PLAYERS_PER_ROOM }, (_, n) => gridPoint(grid, n));
      let minDist = Infinity;
      for (let i = 0; i < pts.length; i++) {
        expect(pts[i].yaw).toBe(yaw);
        expect(pts[i].pos[1]).toBe(2);
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i].pos[0] - pts[j].pos[0], pts[i].pos[2] - pts[j].pos[2]);
          minDist = Math.min(minDist, d);
        }
      }
      expect(minDist).toBeCloseTo(grid.spacing, 9);

      // Neighbouring columns are `spacing` apart along local +X; rows step back along local +Z.
      const right = [Math.cos(yaw), -Math.sin(yaw)];
      const back = [Math.sin(yaw), Math.cos(yaw)];
      const c = gridPoint(grid, 1).pos;
      const a = gridPoint(grid, 0).pos;
      expect(c[0] - a[0]).toBeCloseTo(right[0] * grid.spacing, 9);
      expect(c[2] - a[2]).toBeCloseTo(right[1] * grid.spacing, 9);
      const r = gridPoint(grid, grid.cols).pos;
      expect(r[0] - a[0]).toBeCloseTo(back[0] * grid.spacing, 9);
      expect(r[2] - a[2]).toBeCloseTo(back[1] * grid.spacing, 9);
      // Behind the facing direction: facing is -back.
      const facing = [-Math.sin(yaw), -Math.cos(yaw)];
      expect((r[0] - a[0]) * facing[0] + (r[2] - a[2]) * facing[1]).toBeLessThan(0);
    });
  }

  it('centres each row of columns on pos and puts row 0 at pos', () => {
    const grid: SpawnGrid = { pos: [5, 0, -20], yaw: 0.4, cols: 7, spacing: 2 };
    let x = 0;
    let z = 0;
    for (let col = 0; col < grid.cols; col++) {
      const p = gridPoint(grid, col).pos;
      x += p[0] / grid.cols;
      z += p[2] / grid.cols;
    }
    expect(x).toBeCloseTo(5, 9);
    expect(z).toBeCloseTo(-20, 9);
    // With an odd column count the middle column sits exactly on pos.
    const mid = gridPoint(grid, 3).pos;
    expect(Math.hypot(mid[0] - 5, mid[1], mid[2] + 20)).toBeLessThan(EPS);
  });

  it('maps slot n to row floor(n / cols), column n % cols', () => {
    const grid: SpawnGrid = { pos: [0, 0, 0], yaw: 0, cols: 4, spacing: 1 };
    const p = gridPoint(grid, 9).pos; // row 2, column 1
    expect(p[0]).toBeCloseTo(1 - 1.5, 9);
    expect(p[2]).toBeCloseTo(2, 9);
  });

  it('treats invalid slots as slot 0 and writes into `out`', () => {
    const grid: SpawnGrid = { pos: [1, 2, 3], yaw: 0, cols: 1, spacing: 1 };
    const out = { pos: [9, 9, 9] as [number, number, number], yaw: 9 };
    expect(gridPoint(grid, Number.NaN, out)).toBe(out);
    expect(out).toEqual({ pos: [1, 2, 3], yaw: 0 });
    expect(gridPoint(grid, -4).pos).toEqual([1, 2, 3]);
  });
});

describe('respawnGrid', () => {
  const spawn: SpawnGrid = { pos: [0, 0, 0], yaw: 0, cols: 20, spacing: 1 };
  const cp = (z: number): CheckpointDef => ({
    volume: { pos: [0, 1, z], yaw: 0, half: [5, 1, 5] },
    respawn: { pos: [0, 0, z], yaw: 0, cols: 10, spacing: 1 },
  });
  const checkpoints = [cp(-30), cp(-60)];

  it('uses the start grid before the first checkpoint', () => {
    expect(respawnGrid(spawn, checkpoints, -1)).toBe(spawn);
    expect(respawnGrid(spawn, [], 3)).toBe(spawn);
  });

  it('uses the reached checkpoint, clamped to the last', () => {
    expect(respawnGrid(spawn, checkpoints, 0)).toBe(checkpoints[0].respawn);
    expect(respawnGrid(spawn, checkpoints, 1)).toBe(checkpoints[1].respawn);
    expect(respawnGrid(spawn, checkpoints, 7)).toBe(checkpoints[1].respawn);
  });
});
