// Fading tiles on the server: every tick, anyone standing on a fading tile starts its countdown, and the room is
// told once (`fade`), so every client drops the same tile at the same race time. See
// packages/shared/src/course/obstacles/fade.ts for the rules.
import { boostTileAt, compileBoostTiles } from '@wobble/shared/course/obstacles/boost';
import { createFadeClock } from '@wobble/shared/course/obstacles/fade';
import type { CourseDef, ServerMessage, Vec3 } from '@wobble/shared/types';

export interface FadeWatch {
  /** Check everyone who is racing at race time `raceSec`. */
  tick(raceSec: number, ids: Iterable<number>, getPosition: (id: number, out: Vec3) => boolean): void;
}

export function createFadeWatch(course: CourseDef, publish: (msg: ServerMessage) => void): FadeWatch {
  const tiles = compileBoostTiles(course.entities).filter((t) => t.fade);
  const clock = createFadeClock();
  const p: Vec3 = [0, 0, 0];
  return {
    tick(raceSec, ids, getPosition) {
      if (tiles.length === 0 || raceSec < 0) return;
      for (const id of ids) {
        if (!getPosition(id, p)) continue;
        const tile = boostTileAt(tiles, p[0], p[1], p[2]);
        if (tile && clock.trigger(tile.id, raceSec)) {
          publish({ t: 'fade', id: tile.id, at: Math.round(raceSec * 1000) });
        }
      }
    },
  };
}
