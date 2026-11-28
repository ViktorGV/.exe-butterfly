import { describe, expect, it } from 'bun:test';
import { Anim, BUTTERFLY } from '@wobble/shared/constants';
import { Animator, CH, CHANNELS, evalAnim } from './animation.ts';

const pose = (anim: number, t = 1, u = t) => {
  const o = new Float32Array(CHANNELS);
  evalAnim(anim, t, 0, 0, o, u);
  return o;
};

describe('knocked down and getting up (#84)', () => {
  it('KNOCKED lies flat on the back, the opposite way to PRONE (belly down)', () => {
    const knocked = pose(Anim.KNOCKED);
    const prone = pose(Anim.PRONE);
    expect(knocked[CH.pitch]).toBeCloseTo(Math.PI / 2, 5);
    expect(prone[CH.pitch]).toBeCloseTo(-Math.PI / 2, 5);
    expect(knocked[CH.lift]).toBeLessThan(0); // body pivot lowered to rest on the floor
    expect(knocked[CH.lift]).toBeCloseTo(prone[CH.lift]!, 5);
  });

  it('GETUP starts lying down and ends standing, easing through the middle', () => {
    const dur = BUTTERFLY.GETUP_MS / 1000;
    const start = pose(Anim.GETUP, 5, 0);
    const mid = pose(Anim.GETUP, 5, dur / 2);
    const end = pose(Anim.GETUP, 5, dur);
    expect(start[CH.pitch]).toBeCloseTo(Math.PI / 2, 5);
    expect(end[CH.pitch]).toBeCloseTo(0, 5);
    expect(end[CH.lift]).toBeCloseTo(0, 5);
    expect(mid[CH.pitch]!).toBeGreaterThan(0.2);
    expect(mid[CH.pitch]!).toBeLessThan(Math.PI / 2 - 0.2);
    // the body only ever comes up: pitch never increases over the get-up
    let prev = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 10; i++) {
      const p = pose(Anim.GETUP, 5, (dur * i) / 10)[CH.pitch]!;
      expect(p).toBeLessThanOrEqual(prev + 1e-6);
      prev = p;
    }
  });

  it('GETUP stays put after it ends (a late frame is the standing pose, not a restart)', () => {
    const late = pose(Anim.GETUP, 5, 9);
    expect(late[CH.pitch]).toBeCloseTo(0, 5);
    expect(late[CH.lift]).toBeCloseTo(0, 5);
  });

  it('GRAB winds back, thrusts the arms straight forward, holds, then relaxes', () => {
    const dur = BUTTERFLY.GRAB_ANIM_MS / 1000;
    const windup = pose(Anim.GRAB, 5, dur * 0.05);
    const peak = pose(Anim.GRAB, 5, dur * 0.45);
    const end = pose(Anim.GRAB, 5, dur);
    expect(peak[CH.armLRaise]).toBeGreaterThan(1.5);
    expect(peak[CH.armRRaise]).toBeGreaterThan(1.5);
    expect(peak[CH.pitch]).toBeLessThan(-0.3); // leaning into the push
    // arms drawn back first, reaching furthest at the peak, easing off after
    expect(windup[CH.armLRaise]!).toBeLessThan(peak[CH.armLRaise]!);
    expect(windup[CH.armLSwing]!).toBeLessThan(0); // swung back
    expect(end[CH.armLRaise]!).toBeLessThan(peak[CH.armLRaise]!);
    expect(end[CH.armLRaise]!).toBeGreaterThan(1.0); // still held out when the animation ends
    // both arms move together (a push, not a wave)
    expect(peak[CH.armLRaise]).toBeCloseTo(peak[CH.armRRaise]!, 6);
  });

  it('every pose is finite for any time since the state began', () => {
    for (const anim of Object.values(Anim)) {
      for (const u of [0, 0.1, 0.5, 3, 599]) for (const v of pose(anim, 1, u)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('Animator timing', () => {
  const settle = (a: Animator, anim: number, seconds: number) => {
    const dt = 1 / 120;
    for (let i = 0; i < Math.round(seconds / dt); i++) a.update(anim, 0, dt);
  };

  it('plays GETUP from the moment it is entered, whatever happened before', () => {
    const a = new Animator();
    settle(a, Anim.IDLE, 3.7); // the running clock is somewhere arbitrary
    settle(a, Anim.KNOCKED, 1);
    // first frames of GETUP: still mostly lying down
    a.update(Anim.GETUP, 0, 1 / 120);
    const early = a.pose[CH.pitch]!;
    expect(early).toBeGreaterThan(0.5);
    // after the full duration the body has come upright
    settle(a, Anim.GETUP, BUTTERFLY.GETUP_MS / 1000 + 0.3);
    expect(Math.abs(a.pose[CH.pitch]!)).toBeLessThan(0.1);
  });

  it('plays the get-up again from the start the next time', () => {
    const a = new Animator();
    settle(a, Anim.GETUP, 1);
    settle(a, Anim.IDLE, 1);
    settle(a, Anim.GETUP, 0.1); // past the first frames of the cross-fade
    expect(a.pose[CH.pitch]!).toBeGreaterThan(0.3); // restarted: rising from the floor, not already standing
  });
});
