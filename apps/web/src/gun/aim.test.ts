import { describe, expect, it } from 'bun:test';
import { BUTTERFLY, WIRE } from '@wobble/shared/constants';
import type { RemoteState, Vec3 } from '@wobble/shared/types';
import { nearestTarget } from './aim.ts';

const at = (x: number, z: number, flags = 0): RemoteState => ({ pos: [x, 0, z] as Vec3, yaw: 0, anim: 0, flags });
const me = { pos: [0, 0, 0] as Vec3 };

describe('gun auto-aim', () => {
  it('picks the nearest racer, in any direction', () => {
    const remote = new Map([
      [1, at(0, -10)],
      [2, at(3, 4)],
      [3, at(-20, 0)],
    ]);
    expect(nearestTarget(me, remote)).toBe(2);
  });

  it('skips yourself, finished racers and anyone out of range', () => {
    const remote = new Map([
      [7, at(0, 1)],
      [8, at(1, 0, WIRE.FLAG_FINISHED)],
      [9, at(BUTTERFLY.GUN_RANGE_M + 1, 0)],
    ]);
    expect(nearestTarget(me, remote, 7)).toBe(-1);
    expect(nearestTarget(me, remote)).toBe(7);
  });

  it('returns -1 with nobody around', () => {
    expect(nearestTarget(me, new Map())).toBe(-1);
  });
});
