import { describe, expect, it } from 'bun:test';
import type { EntityDef, Vec3 } from '../../types.ts';
import { BOOST_BACK_FACTOR, boostSpeed, boostTileAt, compileBoostTiles, maxBoostSpeed } from './boost.ts';

const tile = (params: Record<string, unknown> = {}, pos: Vec3 = [0, 0, 0], yaw = 0, id = 1): EntityDef => ({
  id,
  kind: 'arrowTile',
  pos,
  yaw,
  params,
});

describe('compileBoostTiles', () => {
  it('ignores everything that is not an arrow tile', () => {
    const other: EntityDef = { id: 2, kind: 'platform', pos: [0, 0, 0], yaw: 0, params: {} };
    expect(compileBoostTiles([other, tile()])).toHaveLength(1);
    expect(compileBoostTiles([other])).toEqual([]);
  });

  it('a forward tile dashes toward the finish (-Z), a back tile toward the start, harder', () => {
    const [f, b] = compileBoostTiles([tile({ dir: 1, boost: 10 }), tile({ dir: -1, boost: 10 })]);
    expect(f!.vx).toBeCloseTo(0, 9);
    expect(f!.vz).toBeCloseTo(-10, 9);
    expect(b!.vx).toBeCloseTo(0, 9);
    expect(b!.vz).toBeCloseTo(10 * BOOST_BACK_FACTOR, 9);
    expect(BOOST_BACK_FACTOR).toBeGreaterThan(1);
  });

  it('the dash follows the tile yaw like the camera does: yaw 90 degrees faces -X', () => {
    const [t] = compileBoostTiles([tile({ dir: 1, boost: 8 }, [0, 0, 0], Math.PI / 2)]);
    expect(t!.vx).toBeCloseTo(-8, 9);
    expect(t!.vz).toBeCloseTo(0, 9);
  });

  it('uses the kind defaults for missing or invalid params', () => {
    const [t] = compileBoostTiles([tile({ size: 'big', dir: 'x', boost: NaN })]);
    expect(t!.hx).toBe(2);
    expect(t!.hz).toBe(2);
    expect(t!.dir).toBe(1);
    expect(t!.vz).toBeCloseTo(-11, 9);
  });

  it('clamps the speed to the kind range', () => {
    const [slow, fast] = compileBoostTiles([tile({ boost: 0.1 }), tile({ boost: 500 })]);
    expect(-slow!.vz).toBeCloseTo(4, 9);
    expect(-fast!.vz).toBeCloseTo(18, 9);
  });
});

describe('boostTileAt', () => {
  const tiles = compileBoostTiles([tile({ size: [4, 0.12, 6], dir: 1 }, [10, 1, -20])]);

  it('finds the tile under a player standing on it, and nothing off its edge', () => {
    expect(boostTileAt(tiles, 10, 1, -20)).toBe(tiles[0]!);
    expect(boostTileAt(tiles, 11.9, 1, -22.9)).toBe(tiles[0]!); // inside the corner
    expect(boostTileAt(tiles, 12.1, 1, -20)).toBeNull();
    expect(boostTileAt(tiles, 10, 1, -23.1)).toBeNull();
    expect(boostTileAt(tiles, 7.9, 1, -17.1)).toBeNull();
  });

  it('needs the player near the surface, so flying over or being underneath does nothing', () => {
    expect(boostTileAt(tiles, 10, 1.5, -20)).toBe(tiles[0]!); // a small hop still counts
    expect(boostTileAt(tiles, 10, 3, -20)).toBeNull();
    expect(boostTileAt(tiles, 10, -1, -20)).toBeNull();
  });

  it('follows the tile when it is rotated', () => {
    // 4 wide (x) by 10 long (z), turned a quarter turn: now 10 wide in world x and 4 deep in z
    const turned = compileBoostTiles([tile({ size: [4, 0.12, 10] }, [0, 0, 0], Math.PI / 2)]);
    expect(boostTileAt(turned, 4.5, 0, 0)).toBe(turned[0]!);
    expect(boostTileAt(turned, 0, 0, 4.5)).toBeNull();
    expect(boostTileAt(turned, 0, 0, 1.9)).toBe(turned[0]!);
  });

  it('is empty-safe', () => {
    expect(boostTileAt([], 0, 0, 0)).toBeNull();
  });
});

describe('boost speed', () => {
  it('maxBoostSpeed is the strongest dash on the course, for the server limits', () => {
    expect(maxBoostSpeed([])).toBe(0);
    expect(maxBoostSpeed([tile({ boost: 10, dir: 1 })])).toBe(10);
    expect(maxBoostSpeed([tile({ boost: 10, dir: 1 }), tile({ boost: 10, dir: -1 })])).toBeCloseTo(
      10 * BOOST_BACK_FACTOR,
      9,
    );
    expect(boostSpeed(10, -1)).toBeCloseTo(10 * BOOST_BACK_FACTOR, 9);
  });
});
