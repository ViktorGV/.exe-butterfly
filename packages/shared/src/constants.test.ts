import { describe, expect, it } from 'bun:test';
import { Anim, LIMITS, PLAYER, POS_SCALE, WIRE } from './constants.ts';

const wire: Readonly<Record<keyof typeof WIRE, number>> = WIRE;

describe('constants', () => {
  it('are frozen', () => {
    for (const c of [PLAYER, LIMITS, Anim, WIRE]) expect(Object.isFrozen(c)).toBe(true);
  });

  it('wire sizes match the documented layouts', () => {
    // u8 type, u16 seq, u32 raceTimeMs, 3 x i16 pos, u8 yaw, u8 animFlags
    expect(wire.STATE_BYTES).toBe(1 + 2 + 4 + 3 * 2 + 1 + 1);
    // u8 type, u32 serverTimeMs, u16 count
    expect(wire.SNAPSHOT_HEADER_BYTES).toBe(1 + 4 + 2);
    // u16 id, 3 x i16 pos, u8 yaw, u8 animFlags
    expect(wire.SNAPSHOT_RECORD_BYTES).toBe(2 + 3 * 2 + 1 + 1);
  });

  it('anim values fit in the low 4 bits and flags do not overlap them', () => {
    for (const v of Object.values(Anim)) expect(v & ~WIRE.ANIM_MASK).toBe(0);
    for (const f of [WIRE.FLAG_GROUNDED, WIRE.FLAG_FINISHED, WIRE.FLAG_RESPAWNED]) expect(f & WIRE.ANIM_MASK).toBe(0);
  });

  it('int16 quantisation covers the largest course', () => {
    expect(32767 / POS_SCALE).toBeGreaterThan(LIMITS.maxCourseLength);
  });

  it('jump physics give the documented apex (~1.74 m)', () => {
    const apex = PLAYER.jumpVelocity ** 2 / (2 * -PLAYER.gravity);
    expect(apex).toBeCloseTo(1.74, 1);
  });
});
