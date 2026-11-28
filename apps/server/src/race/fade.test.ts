import { describe, expect, it } from 'bun:test';
import { FADE } from '@wobble/shared/course/obstacles/fade';
import type { CourseDef, ServerMessage, Vec3 } from '@wobble/shared/types';
import { createFadeWatch } from './fade.ts';

const course = {
  entities: [
    { id: 4, kind: 'arrowTile', pos: [0, 1, -10], yaw: 0, params: { size: [6, 0.12, 6], dir: 1, fade: true } },
    { id: 5, kind: 'arrowTile', pos: [6, 1, -10], yaw: 0, params: { size: [6, 0.12, 6], dir: 1 } },
  ],
} as unknown as CourseDef;

describe('fading tiles on the server', () => {
  it('tells the room once when someone steps on a fading tile, and again only after it came back', () => {
    const sent: ServerMessage[] = [];
    const watch = createFadeWatch(course, (m) => sent.push(m));
    const pos = new Map<number, Vec3>([
      [1, [0.5, 1, -10]], // on the fading tile
      [2, [6, 1, -10]], // on a normal tile
    ]);
    const get = (id: number, out: Vec3) => {
      const p = pos.get(id);
      if (!p) return false;
      out[0] = p[0];
      out[1] = p[1];
      out[2] = p[2];
      return true;
    };
    watch.tick(12.3456, [1, 2], get);
    expect(sent).toEqual([{ t: 'fade', id: 4, at: 12346 }]);
    watch.tick(13, [1, 2], get);
    expect(sent).toHaveLength(1); // still counting down
    watch.tick(12.3456 + FADE.WARN_S + FADE.GONE_S + 0.1, [1], get);
    expect(sent).toHaveLength(2);
  });

  it('ignores players in the air above the tile and courses without fading tiles', () => {
    const sent: ServerMessage[] = [];
    const watch = createFadeWatch(course, (m) => sent.push(m));
    watch.tick(5, [1], (_id, out) => {
      out[0] = 0;
      out[1] = 4;
      out[2] = -10;
      return true;
    });
    expect(sent).toEqual([]);
    const none = createFadeWatch({ entities: [] } as unknown as CourseDef, (m) => sent.push(m));
    none.tick(5, [1], () => true);
    expect(sent).toEqual([]);
  });
});
