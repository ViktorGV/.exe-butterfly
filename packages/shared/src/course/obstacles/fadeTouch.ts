// Which fading platform (fade.ts) someone is standing on. Shared by the server (everyone online) and the game (solo:
// you and the bots), so both agree on a touch.
import type { EntityDef, ObstacleKind, Pose } from '../../types.ts';
import { FADE } from './fade.ts';
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
  /** a late pad only counts once its run is open: a chosen pad of the run was stood on and has dropped */
  late: boolean;
  run: FadeRun;
}

/** Shared by the pads of one run: the race time its late pads start counting (Infinity until a chosen pad drops). */
export interface FadeRun {
  openAt: number;
}

/** The fading platforms of a course (none on most courses). */
export function compileFadePads(entities: readonly EntityDef[]): FadePad[] {
  const out: FadePad[] = [];
  const runs = new Map<number, FadeRun>();
  for (const def of entities) {
    const late = def.params.fade !== true && def.params.fadeLate === true;
    if (def.params.fade !== true && !late) continue;
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
      late,
      run: runOf(runs, typeof def.params.fadeRun === 'number' ? def.params.fadeRun : 0),
    });
  }
  return out;
}

function runOf(runs: Map<number, FadeRun>, key: number): FadeRun {
  let r = runs.get(key);
  if (!r) runs.set(key, (r = { openAt: Infinity }));
  return r;
}

/** A new race: every run closed again (late pads solid until a chosen pad drops). */
export function resetFadePads(pads: readonly FadePad[]): void {
  for (const p of pads) p.run.openAt = Infinity;
}

/**
 * The fading platform under (x, y, z) at race time t, or null. Finding someone on a chosen pad opens its run: the
 * run's late pads can be triggered from the moment that pad drops (FADE.WARN_S later).
 */
export function fadePadAt(pads: readonly FadePad[], t: number, x: number, y: number, z: number): FadePad | null {
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i]!;
    // cheap reject on the footprint around where it was placed (platforms here only bob up and down)
    if (Math.abs(x - p.def.pos[0]) > p.hx + 1 || Math.abs(z - p.def.pos[2]) > p.hz + 1) continue;
    if (p.late && t < p.run.openAt) continue;
    p.kind.pose(p.def, t, p.pose);
    const c = p.pose[0]!.pos;
    if (Math.abs(x - c[0]) > p.hx || Math.abs(z - c[2]) > p.hz) continue;
    const top = c[1] + p.hy;
    if (y >= top - BELOW && y <= top + ABOVE) {
      if (!p.late && t + FADE.WARN_S < p.run.openAt) p.run.openAt = t + FADE.WARN_S;
      return p;
    }
  }
  return null;
}
