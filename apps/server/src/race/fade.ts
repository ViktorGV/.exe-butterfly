// Fading platforms on the server: every tick, anyone standing on a fading platform starts its countdown, and the
// room is told once (`fade`), so every client drops the same platform at the same race time. See
// packages/shared/src/course/obstacles/fade.ts for the rules.
import { createFadeClock } from '@wobble/shared/course/obstacles/fade';
import { compileFadePads, fadePadAt } from '@wobble/shared/course/obstacles/fadeTouch';
import type { CourseDef, ServerMessage, Vec3 } from '@wobble/shared/types';

export interface FadeWatch {
  /** Check everyone who is racing at race time `raceSec`. */
  tick(raceSec: number, ids: Iterable<number>, getPosition: (id: number, out: Vec3) => boolean): void;
}

export function createFadeWatch(course: CourseDef, publish: (msg: ServerMessage) => void): FadeWatch {
  const pads = compileFadePads(course.entities);
  const clock = createFadeClock();
  const p: Vec3 = [0, 0, 0];
  return {
    tick(raceSec, ids, getPosition) {
      if (pads.length === 0 || raceSec < 0) return;
      for (const id of ids) {
        if (!getPosition(id, p)) continue;
        const pad = fadePadAt(pads, raceSec, p[0], p[1], p[2]);
        if (pad && clock.trigger(pad.id, raceSec)) {
          publish({ t: 'fade', id: pad.id, at: Math.round(raceSec * 1000) });
        }
      }
    },
  };
}
