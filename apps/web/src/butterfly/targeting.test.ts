import { describe, expect, it } from 'bun:test';
import { Anim, BUTTERFLY } from '@wobble/shared/constants';
import type { PlayerState, RemoteState } from '@wobble/shared/types';
import { createGrabTargeting, situationOf } from './targeting.ts';

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

describe('createGrabTargeting', () => {
  const me = (): PlayerState => ({
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    yaw: 0, // facing -Z
    anim: Anim.RUN,
    grounded: true,
    checkpoint: -1,
    finished: false,
  });
  const at = (x: number, z: number, anim: number = Anim.IDLE): RemoteState => ({
    pos: [x, 0, z],
    yaw: 0,
    anim: anim as RemoteState['anim'],
    flags: 0,
  });

  it('finds someone beside you, so you can act while running past', () => {
    const t = createGrabTargeting();
    const hit = t.find(me(), new Map([[7, at(BUTTERFLY.GRAB_REACH_M - 0.2, 0)]]));
    expect(hit.id).toBe(7);
    expect(hit.kind).toBe('push');
  });

  it('ignores someone well behind you', () => {
    const t = createGrabTargeting();
    expect(t.find(me(), new Map([[7, at(0, 2)]])).id).toBe(-1);
  });

  it('prefers helping up a downed player over pushing', () => {
    const t = createGrabTargeting();
    const hit = t.find(
      me(),
      new Map([
        [1, at(0, -0.8)],
        [2, at(1, -1.5, Anim.KNOCKED)],
      ]),
    );
    expect(hit.id).toBe(2);
    expect(hit.kind).toBe('helpUp');
  });
});
