import { describe, expect, it } from 'bun:test';
import { Anim } from '@wobble/shared/constants';
import { situationOf } from './targeting.ts';

describe('situationOf', () => {
  it('a knocked-down, belly-sliding or stumbling player can be helped up', () => {
    for (const anim of [Anim.KNOCKED, Anim.PRONE, Anim.STUMBLE]) expect(situationOf(anim, 0)).toBe('knockedDown');
  });

  it('a player already getting up, or standing, is just standing', () => {
    expect(situationOf(Anim.GETUP, 0)).toBe('standing');
    expect(situationOf(Anim.IDLE, 0)).toBe('standing');
    expect(situationOf(Anim.RUN, 0)).toBe('standing');
  });

  it('a player falling below the floor can be saved', () => {
    expect(situationOf(Anim.FALL, 2)).toBe('falling');
    expect(situationOf(Anim.FALL, 0)).toBe('standing');
  });
});
