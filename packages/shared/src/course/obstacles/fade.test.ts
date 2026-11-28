import { afterEach, describe, expect, it } from 'bun:test';
import type { EntityDef, Pose } from '../../types.ts';
import { createFadeClock, FADE, fadeGone, setFadeSource } from './fade.ts';
import { compileFadePads, fadePadAt, resetFadePads } from './fadeTouch.ts';
import { getObstacleKind } from './index.ts';

// a platform that does not bob (travel 0), so its top stays at y = 2
const pad = (fade: boolean, id = 7): EntityDef => ({
  id,
  kind: 'movingPlatform',
  pos: [0, 2, -30],
  yaw: 0,
  params: { size: [3.4, 0.5, 3.4], travel: [0, 0, 0], periodSec: 4, phase: 0, ease: 'sine', fade },
});
const topY = (def: EntityDef, t: number) => {
  const kind = getObstacleKind('movingPlatform')!;
  const out = kind.parts(def).map((): Pose => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
  kind.pose(def, t, out);
  return out[0]!.pos[1] + 0.25;
};

afterEach(() => setFadeSource(null));

describe('fading platforms', () => {
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

  it('only platforms with fade: true drop, and only once touched', () => {
    const c = createFadeClock();
    setFadeSource((id, t) => c.since(id, t));
    expect(topY(pad(true), 5)).toBeCloseTo(2, 6);
    c.trigger(7, 5);
    expect(topY(pad(false), 6)).toBeCloseTo(2, 6); // a normal platform with the same id ignores the clock
    expect(Math.abs(topY(pad(true), 7) - 2)).toBeLessThan(0.2); // wobbling, still there
    expect(fadeGone(7, 7)).toBe(false);
    expect(topY(pad(true), 5 + FADE.WARN_S + 0.1)).toBeLessThan(-100); // dropped away
    expect(fadeGone(7, 5 + FADE.WARN_S + 0.1)).toBe(true);
    expect(topY(pad(true), 5 + FADE.WARN_S + FADE.GONE_S + 0.1)).toBeCloseTo(2, 6); // back
  });

  it('without a fade source (server, lint) a fading platform is a plain one', () => {
    expect(topY(pad(true), 100)).toBeCloseTo(2, 6);
    expect(fadeGone(7, 100)).toBe(false);
  });

  it('finds the fading platform someone stands on, not plain ones, nor anyone in the air or once it is gone', () => {
    const pads = compileFadePads([pad(false, 3), pad(true, 4)]);
    expect(pads.map((p) => p.id)).toEqual([4]);
    expect(fadePadAt(pads, 1, 1, 2, -30)?.id).toBe(4);
    expect(fadePadAt(pads, 1, 1, 4, -30)).toBeNull(); // in the air
    expect(fadePadAt(pads, 1, 3, 2, -30)).toBeNull(); // beside it
    const c = createFadeClock();
    setFadeSource((id, t) => c.since(id, t));
    c.trigger(4, 1);
    expect(fadePadAt(pads, 1 + FADE.WARN_S + 0.1, 1, 2, -30)).toBeNull(); // dropped away
  });

  it('the other platforms of a run can fall only once a chosen one has dropped', () => {
    const chosen = pad(true, 1);
    chosen.params.fadeRun = 5;
    const other: EntityDef = { ...pad(false, 2), pos: [10, 2, -30] };
    other.params = { ...other.params, fadeLate: true, fadeRun: 5 };
    const pads = compileFadePads([chosen, other]);
    expect(pads).toHaveLength(2);
    expect(fadePadAt(pads, 1, 10, 2, -30)).toBeNull(); // run still closed
    expect(fadePadAt(pads, 2, 0, 2, -30)?.id).toBe(1); // someone lands on the chosen one
    expect(fadePadAt(pads, 2 + FADE.WARN_S - 0.1, 10, 2, -30)).toBeNull(); // not dropped yet
    expect(fadePadAt(pads, 2 + FADE.WARN_S, 10, 2, -30)?.id).toBe(2); // dropped: the rest can fall
    resetFadePads(pads);
    expect(fadePadAt(pads, 50, 10, 2, -30)).toBeNull(); // a new race closes it again
  });
});
