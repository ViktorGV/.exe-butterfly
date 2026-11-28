import { describe, expect, it } from 'bun:test';
import { BUTTERFLY } from '../constants.ts';
import { createButterfly, type ButterflyEvent } from './index.ts';

const pushN = (b: ReturnType<typeof createButterfly>, target: number, n: number) => {
  const all: ButterflyEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...b.push(100 + (i % 3), target, i * 10, []));
  return all.filter((e) => e.type === 'gun');
};

describe('gun', () => {
  it(`is earned at the ${BUTTERFLY.GUN_PUSHES}th push received, with ${BUTTERFLY.GUN_SHOTS} shots`, () => {
    const b = createButterfly();
    expect(pushN(b, 1, BUTTERFLY.GUN_PUSHES - 1)).toEqual([]);
    expect(b.shots(1)).toBe(0);
    expect(b.push(100, 1, 999, [])).toContainEqual({ type: 'gun', id: 1, shots: BUTTERFLY.GUN_SHOTS });
    expect(b.shots(1)).toBe(BUTTERFLY.GUN_SHOTS);
  });

  it('counts per target, not per pusher', () => {
    const b = createButterfly();
    pushN(b, 1, BUTTERFLY.GUN_PUSHES - 1);
    pushN(b, 2, BUTTERFLY.GUN_PUSHES - 1);
    expect(b.shots(1)).toBe(0);
    expect(b.shots(2)).toBe(0);
    expect(b.shots(100)).toBe(0);
  });

  it('spends one shot per shoot and refuses when empty', () => {
    const b = createButterfly();
    expect(b.shoot(1, 2, [])).toBe(false);
    pushN(b, 1, BUTTERFLY.GUN_PUSHES);
    for (let i = 0; i < BUTTERFLY.GUN_SHOTS; i++) expect(b.shoot(1, 2, [])).toBe(true);
    expect(b.shots(1)).toBe(0);
    expect(b.shoot(1, 2, [])).toBe(false);
  });

  it('refills the gun every further GUN_PUSHES pushes received', () => {
    const b = createButterfly();
    pushN(b, 1, BUTTERFLY.GUN_PUSHES);
    b.shoot(1, 2, []);
    b.shoot(1, 2, []);
    expect(pushN(b, 1, BUTTERFLY.GUN_PUSHES)).toHaveLength(1);
    expect(b.shots(1)).toBe(BUTTERFLY.GUN_SHOTS);
  });

  it('a shot is a bad deed: the first one marks the shooter, every one raises the storm', () => {
    const b = createButterfly();
    pushN(b, 1, BUTTERFLY.GUN_PUSHES);
    const before = b.storm;
    expect(b.isMarked(1)).toBe(false);
    const out: ButterflyEvent[] = [];
    expect(b.shoot(1, 2, out)).toBe(true);
    expect(out).toContainEqual({ type: 'marked', id: 1, by: 2 });
    expect(b.isMarked(1)).toBe(true);
    expect(b.storm).toBe(before + 1);
    b.shoot(1, 2, out);
    expect(out.some((e) => e.type === 'marked')).toBe(false); // marked only once
    expect(b.storm).toBe(before + 2);
  });
});
