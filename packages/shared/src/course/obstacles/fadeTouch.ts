// Which fading platform (fade.ts) someone is standing on. Shared by the server (everyone online) and the game (solo:
// you and the bots), so both agree on a touch.
import type { EntityDef, ObstacleKind, Pose } from '../../types.ts';
import { getObstacleKind } from './index.ts';

/** How far above a platform's top someone still counts as standing on it, and how far below. */
const ABOVE = 0.7;
const BELOW = 0.3;

export interface FadePad {
  /** the entity id (the fade clock's key) */
  id: number;
  def: EntityDef;
  /** half the platform's width and depth */
  hx: number;
  hz: number;
  /** half its thickness */
  hy: number;
  pose: Pose[];
  kind: ObstacleKind;
}

/** The fading platforms of a course (none on most courses). */
export function compileFadePads(entities: readonly EntityDef[]): FadePad[] {
  const out: FadePad[] = [];
  for (const def of entities) {
    if (def.params.fade !== true) continue;
    const kind = getObstacleKind(def.kind);
    if (!kind) continue;
    const parts = kind.parts(def);
    const box = parts[0];
    if (!box) continue;
    out.push({
      id: def.id,
      def,
      hx: box.size[0],
      hy: box.size[1],
      hz: box.size[2],
      pose: parts.map((): Pose => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] })),
      kind,
    });
  }
  return out;
}

/** The fading platform under (x, y, z) at race time t, or null. */
export function fadePadAt(pads: readonly FadePad[], t: number, x: number, y: number, z: number): FadePad | null {
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i]!;
    // cheap reject on the footprint around where it was placed (platforms here only bob up and down)
    if (Math.abs(x - p.def.pos[0]) > p.hx + 1 || Math.abs(z - p.def.pos[2]) > p.hz + 1) continue;
    p.kind.pose(p.def, t, p.pose);
    const c = p.pose[0]!.pos;
    if (Math.abs(x - c[0]) > p.hx || Math.abs(z - c[2]) > p.hz) continue;
    const top = c[1] + p.hy;
    if (y >= top - BELOW && y <= top + ABOVE) return p;
  }
  return null;
}
