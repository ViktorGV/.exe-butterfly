import { describe, expect, it } from 'bun:test';
import { BUTTERFLY, GUNS } from '../constants.ts';
import type { GunKind } from '../types.ts';
import { createButterfly, type ButterflyEvent } from './index.ts';

/** Tests arm a gun every EVERY hits; the real GUN_LADDER is tested in guns.test.ts. */
const EVERY = 2;
const every = (kind: GunKind) => (n: number) => (n % EVERY === 0 ? kind : null);

const pushN = (b: ReturnType<typeof createButterfly>, target: number, n: number) => {
  const all: ButterflyEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...b.push(100 + (i % 3), target, i * 10, []));
  return all.filter((e) => e.type === 'gun');
};

describe('gun', () => {
  it(`is earned at the ${EVERY}th push received, with ${GUNS.blaster.shots} shots`, () => {
    const b = createButterfly({ gunAt: every('blaster') });
    expect(pushN(b, 1, EVERY - 1)).toEqual([]);
    expect(b.shots(1)).toBe(0);
    expect(b.push(100, 1, 999, [])).toContainEqual({ type: 'gun', id: 1, kind: 'blaster', shots: GUNS.blaster.shots });
    expect(b.shots(1)).toBe(GUNS.blaster.shots);
  });

  it('counts per target, not per pusher', () => {
    const b = createButterfly({ gunAt: every('blaster') });
    pushN(b, 1, EVERY - 1);
    pushN(b, 2, EVERY - 1);
    expect(b.shots(1)).toBe(0);
    expect(b.shots(2)).toBe(0);
    expect(b.shots(100)).toBe(0);
  });

  it('spends one shot per shoot and refuses when empty', () => {
    const b = createButterfly({ gunAt: every('blaster') });
    expect(b.shoot(1, 2, [])).toBe(false);
    pushN(b, 1, EVERY);
    for (let i = 0; i < GUNS.blaster.shots; i++) expect(b.shoot(1, 2, [])).toBe(true);
    expect(b.shots(1)).toBe(0);
    expect(b.shoot(1, 2, [])).toBe(false);
  });

  it('refills the gun every further EVERY pushes received', () => {
    const b = createButterfly({ gunAt: every('blaster') });
    pushN(b, 1, EVERY);
    b.shoot(1, 2, []);
    b.shoot(1, 2, []);
    expect(pushN(b, 1, EVERY)).toHaveLength(1);
    expect(b.shots(1)).toBe(GUNS.blaster.shots);
  });

  it('a shot is a bad deed: the first one marks the shooter, every one raises the storm', () => {
    const b = createButterfly({ gunAt: every('blaster') });
    pushN(b, 1, EVERY);
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

describe('gun kinds', () => {
  it('a pickup gives the rolled kind with its own shot count', () => {
    const b = createButterfly({ gunAt: every('rocket') });
    const ev = pushN(b, 1, EVERY);
    expect(ev).toEqual([{ type: 'gun', id: 1, kind: 'rocket', shots: GUNS.rocket.shots }]);
    expect(b.gunKind(1)).toBe('rocket');
    expect(b.shots(1)).toBe(GUNS.rocket.shots);
  });
  it('a shotgun shot raises the storm by its own amount', () => {
    const b = createButterfly({ gunAt: every('shotgun') });
    pushN(b, 1, EVERY);
    const before = b.storm;
    b.shoot(1, 2, []);
    expect(b.storm).toBe(Math.min(BUTTERFLY.STORM_MAX, before + GUNS.shotgun.storm));
  });
});

describe('getting shot', () => {
  it('counts toward your gun like a push received', () => {
    const b = createButterfly({ gunAt: every('shotgun') });
    pushN(b, 1, EVERY - 1);
    expect(b.shots(1)).toBe(0);
    expect(b.gotShot(1, [])).toEqual([{ type: 'gun', id: 1, kind: 'shotgun', shots: GUNS.shotgun.shots }]);
    expect(b.shots(1)).toBe(GUNS.shotgun.shots);
  });
});

describe('gun ladder (default)', () => {
  it('3 hits: blaster, 5 more: shotgun, 5 more: rocket launcher', () => {
    const b = createButterfly();
    const kinds = pushN(b, 1, 13).map((e) => (e.type === 'gun' ? e.kind : ''));
    expect(kinds).toEqual(['blaster', 'shotgun', 'rocket']);
    expect(b.shots(1)).toBe(GUNS.rocket.shots);
  });
});
