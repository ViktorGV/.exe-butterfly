// Arrow tiles (#84 follow-up): stepping on one dashes the player along its arrows for a moment. Like the snow
// blowers' wind this is applied by the local player controller (it reads `course.entities`), not by physics, so
// it needs no new surface type. Pure helpers shared by the controller, the server's speed limits and bots.
import type { EntityDef } from '../../types.ts';

/** How long a dash lasts, seconds. */
export const BOOST_SEC = 0.6;
/** A tile whose arrows point back pushes this much harder than a forward one of the same `boost`. */
export const BOOST_BACK_FACTOR = 1.4;
/** Tile sizes and speeds when the entity leaves them out (the kind's defaults). */
const DEFAULT_SIZE: readonly [number, number, number] = [4, 0.12, 4];
const DEFAULT_BOOST = 11;
/** The player must be this close to the tile's top (metres) to trigger it: standing on it, not flying over. */
const TRIGGER_HEIGHT = 0.7;

export interface BoostTile {
  x: number;
  z: number;
  /** cos / sin of the tile's yaw */
  c: number;
  s: number;
  /** half extents along the tile's local X and Z */
  hx: number;
  hz: number;
  /** height of the top surface */
  y: number;
  /** +1 points to the finish (the tile's local -Z), -1 back toward the start */
  dir: 1 | -1;
  /** velocity (m/s) added to the player's steering target while the dash lasts, world xz */
  vx: number;
  vz: number;
}

const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);

/** Speed of a tile's dash (m/s): a back-pointing tile is stronger, so running straight into it still sends you back. */
export const boostSpeed = (boost: number, dir: number) => (dir < 0 ? boost * BOOST_BACK_FACTOR : boost);

/** Every arrow tile of a course, ready for per-step lookups. */
export function compileBoostTiles(entities: readonly EntityDef[]): BoostTile[] {
  const out: BoostTile[] = [];
  for (const e of entities) {
    if (e.kind !== 'arrowTile') continue;
    const size = Array.isArray(e.params.size) ? (e.params.size as unknown[]) : [];
    const dir = num(e.params.dir, 1) < 0 ? -1 : 1;
    const speed = boostSpeed(Math.min(18, Math.max(4, num(e.params.boost, DEFAULT_BOOST))), dir);
    const c = Math.cos(e.yaw);
    const s = Math.sin(e.yaw);
    // the tile's local -Z turned by its yaw is (-sin, -cos); dir flips it
    out.push({
      x: e.pos[0],
      z: e.pos[2],
      c,
      s,
      hx: num(size[0], DEFAULT_SIZE[0]) / 2,
      hz: num(size[2], DEFAULT_SIZE[2]) / 2,
      y: e.pos[1],
      dir,
      vx: -s * dir * speed,
      vz: -c * dir * speed,
    });
  }
  return out;
}

/** The tile under (x, y, z), or null. y is the player's feet. */
export function boostTileAt(tiles: readonly BoostTile[], x: number, y: number, z: number): BoostTile | null {
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]!;
    if (Math.abs(y - t.y) > TRIGGER_HEIGHT) continue;
    const dx = x - t.x;
    const dz = z - t.z;
    // into the tile's own frame (the inverse of the yaw used to place it)
    const lx = dx * t.c - dz * t.s;
    const lz = dx * t.s + dz * t.c;
    if (lx >= -t.hx && lx <= t.hx && lz >= -t.hz && lz <= t.hz) return t;
  }
  return null;
}

/** The strongest dash speed any tile of a course can add (for the server's speed limits). */
export function maxBoostSpeed(entities: readonly EntityDef[]): number {
  let m = 0;
  for (const e of entities) {
    if (e.kind !== 'arrowTile') continue;
    const dir = num(e.params.dir, 1) < 0 ? -1 : 1;
    m = Math.max(m, boostSpeed(Math.min(18, Math.max(4, num(e.params.boost, DEFAULT_BOOST))), dir));
  }
  return m;
}
