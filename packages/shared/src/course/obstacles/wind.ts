// Snow blower wind zones (#110). The controller compiles them once from the course entities and
// calls windAt() every step; the theme calls windPhase() to start snow and wind lines before a push.
import type { EntityDef, Vec3 } from '../../types.ts';
import { blowerPhase, snowBlowerSchema, WIND_ON, type SnowBlowerParams, type WindPhase } from './kinds.ts';

export { WIND_OFF, WIND_ON, WIND_WARN, type WindPhase } from './kinds.ts';

export interface WindZone {
  readonly entityId: number;
  readonly params: SnowBlowerParams;
  readonly pos: Vec3;
  /** cos and sin of the entity's yaw */
  readonly c: number;
  readonly s: number;
}

const cache = new WeakMap<EntityDef, SnowBlowerParams>();
function paramsOf(def: EntityDef): SnowBlowerParams {
  let p = cache.get(def);
  if (!p) {
    p = snowBlowerSchema.parse(def.params ?? {});
    cache.set(def, p);
  }
  return p;
}

/** Every snow blower in the course, ready for windAt(). Call once per course. */
export function compileWindZones(entities: readonly EntityDef[]): WindZone[] {
  return entities
    .filter((e) => e.kind === 'snowBlower')
    .map((e) => ({ entityId: e.id, params: paramsOf(e), pos: e.pos, c: Math.cos(e.yaw), s: Math.sin(e.yaw) }));
}

/** Off, warning or on for one snow blower entity at race time t. */
export function windPhase(def: EntityDef, t: number): WindPhase {
  return blowerPhase(paramsOf(def), t);
}

/** True when the feet position (x, y, z) is inside the zone's wind box, whether or not it is on. */
export function inWindZone(zone: WindZone, x: number, y: number, z: number): boolean {
  const dx = x - zone.pos[0];
  const dz = z - zone.pos[2];
  // Into the entity's frame (undo the yaw).
  const lx = dx * zone.c - dz * zone.s;
  const lz = dx * zone.s + dz * zone.c;
  const ly = y - zone.pos[1];
  const p = zone.params;
  return lx >= 0 && lx <= p.reach && Math.abs(lz) <= p.width / 2 && ly >= -1 && ly <= p.height + 2;
}

/**
 * Sum of the wind (m/s, horizontal) of every zone that is on at time t and contains pos.
 * Writes into `out` and returns how many zones blow on the point. No allocation.
 */
export function windAt(zones: readonly WindZone[], pos: Vec3, t: number, out: Vec3): number {
  out[0] = out[1] = out[2] = 0;
  let n = 0;
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    if (blowerPhase(zone.params, t) !== WIND_ON || !inWindZone(zone, pos[0], pos[1], pos[2])) continue;
    // Local +X turned by the yaw is (cos, 0, -sin).
    out[0] += zone.c * zone.params.windSpeed;
    out[2] -= zone.s * zone.params.windSpeed;
    n++;
  }
  return n;
}
