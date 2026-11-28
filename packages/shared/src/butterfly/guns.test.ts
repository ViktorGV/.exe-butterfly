import { describe, expect, it } from 'bun:test';
import { GUN_KINDS, GUN_MAX_SHOTS, GUNS } from '../constants.ts';
import { inCone, isAhead, rollGun } from './guns.ts';

describe('gun table', () => {
  it('every kind has sane rules and fits the message limit', () => {
    for (const k of GUN_KINDS) {
      const g = GUNS[k];
      expect(g.shots).toBeGreaterThan(0);
      expect(g.shots).toBeLessThanOrEqual(GUN_MAX_SHOTS);
      expect(g.cooldownMs).toBeGreaterThan(0);
      expect(g.rangeM).toBeGreaterThan(0);
    }
    expect(GUNS.shotgun.shots).toBeLessThan(GUNS.blaster.shots);
    expect([...GUN_KINDS]).toEqual(['blaster', 'shotgun', 'rocket']);
  });
  it('rollGun covers every kind', () => {
    const seen = new Set(GUN_KINDS.map((_, i) => rollGun(() => (i + 0.5) / GUN_KINDS.length)));
    expect(seen.size).toBe(GUN_KINDS.length);
    expect(rollGun(() => 0.99999)).toBe('rocket');
  });
});

describe('cone', () => {
  const r = GUNS.shotgun.rangeM;
  const c = GUNS.shotgun.coneDeg;
  it('hits in front within range and half-angle', () => {
    expect(inCone(0, 0, 0, 0, -5, r, c)).toBe(true);
    expect(inCone(0, 0, 0, Math.tan((15 * Math.PI) / 180) * 5, -5, r, c)).toBe(true);
  });
  it('misses outside the angle, behind, out of range and the shooter spot', () => {
    expect(inCone(0, 0, 0, Math.tan((25 * Math.PI) / 180) * 5, -5, r, c)).toBe(false);
    expect(inCone(0, 0, 0, 0, 5, r, c)).toBe(false);
    expect(inCone(0, 0, 0, 0, -(r + 1), r, c)).toBe(false);
    expect(inCone(0, 0, 0, 0, 0, r, c)).toBe(false);
  });
  it('follows the facing', () => {
    // yaw π/2 faces −X
    expect(inCone(0, 0, Math.PI / 2, -5, 0, r, c)).toBe(true);
    expect(inCone(0, 0, Math.PI / 2, 0, -5, r, c)).toBe(false);
  });
  it('ahead means further toward −Z', () => {
    expect(isAhead(0, -1)).toBe(true);
    expect(isAhead(0, 1)).toBe(false);
  });
});
