import { afterEach, describe, expect, it } from 'bun:test';
import type { EntityDef, Pose } from '../../types.ts';
import { compileBoostTiles } from './boost.ts';
import { createFadeClock, FADE, fadeGone, setFadeSource } from './fade.ts';
import { getObstacleKind, periodOf } from './index.ts';

const tile = (fade: boolean, id = 7): EntityDef => ({
  id,
  kind: 'arrowTile',
  pos: [0, 2, -30],
  yaw: 0,
  params: { size: [6, 0.12, 6], dir: 1, boost: 11, fade },
});
const topY = (def: EntityDef, t: number) => {
  const kind = getObstacleKind('arrowTile')!;
  const out = kind.parts(def).map((): Pose => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
  kind.pose(def, t, out);
  return out[0]!.pos[1] + 0.06;
};

afterEach(() => setFadeSource(null));

describe('fading tiles', () => {
  it('a fade clock counts one touch at a time: warn, gone, then solid again', () => {
    const c = createFadeClock();
    expect(c.since(1, 10)).toBe(-1);
    expect(c.trigger(1, 10)).toBe(true);
    expect(c.trigger(1, 11)).toBe(false); // already counting down
    expect(c.since(1, 12)).toBeCloseTo(2, 9);
    expect(c.since(1, 10 + FADE.WARN_S + FADE.GONE_S)).toBe(-1); // back
    expect(c.trigger(1, 10 + FADE.WARN_S + FADE.GONE_S)).toBe(true); // and can fade again
    c.reset();
    expect(c.since(1, 20)).toBe(-1);
  });

  it('only tiles with fade: true move, and only once touched', () => {
    const c = createFadeClock();
    setFadeSource((id, t) => c.since(id, t));
    expect(periodOf(tile(false))).toBe(0);
    expect(periodOf(tile(true))).toBeGreaterThan(0);
    expect(topY(tile(true), 5)).toBeCloseTo(2, 6);
    c.trigger(7, 5);
    expect(topY(tile(false), 6)).toBeCloseTo(2, 6); // a normal tile with the same id ignores the clock
    expect(Math.abs(topY(tile(true), 7) - 2)).toBeLessThan(0.2); // wobbling, still there
    expect(fadeGone(7, 7)).toBe(false);
    expect(topY(tile(true), 5 + FADE.WARN_S + 0.1)).toBeLessThan(-100); // dropped away
    expect(fadeGone(7, 5 + FADE.WARN_S + 0.1)).toBe(true);
    expect(topY(tile(true), 5 + FADE.WARN_S + FADE.GONE_S + 0.1)).toBeCloseTo(2, 6); // back
  });

  it('without a fade source (server, lint) a fading tile is a plain tile', () => {
    expect(topY(tile(true), 100)).toBeCloseTo(2, 6);
    expect(fadeGone(7, 100)).toBe(false);
  });

  it('boost tiles carry the entity id and the fade flag for touch detection', () => {
    const [plain, fading] = compileBoostTiles([tile(false, 3), tile(true, 4)]);
    expect(plain).toMatchObject({ id: 3, fade: false });
    expect(fading).toMatchObject({ id: 4, fade: true });
  });
});
