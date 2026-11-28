import { describe, expect, it } from 'bun:test';
import { Anim, PLAYER } from '@wobble/shared/constants';
import type { PlayerState, RemoteState } from '@wobble/shared/types';
import { CROWD, createCrowdCollision } from './crowdCollision.ts';

const DT = 1 / 60;

function me(x = 0, y = 0, z = 0): PlayerState {
  return { pos: [x, y, z], vel: [0, 0, 0], yaw: 0, anim: Anim.RUN, grounded: true, checkpoint: -1, finished: false };
}
function other(x: number, y: number, z: number): RemoteState {
  return { pos: [x, y, z], yaw: 0, anim: Anim.IDLE, flags: 0 };
}

describe('createCrowdCollision', () => {
  const reach = PLAYER.radius * 2;

  it('ignores players out of reach', () => {
    const c = createCrowdCollision();
    const p = me();
    expect(c.apply(p, new Map([[1, other(reach + 0.01, 0, 0)]]), DT)).toBe(0);
    expect(p.pos).toEqual([0, 0, 0]);
  });

  it('pushes the local player softly away from an overlap, capped and without height', () => {
    const c = createCrowdCollision();
    const p = me(0, 0, 0);
    const remote = new Map([[1, other(0.1, 0, 0)]]);
    expect(c.apply(p, remote, DT)).toBe(1);
    expect(p.pos[0]).toBeLessThan(0);
    expect(-p.pos[0]).toBeLessThanOrEqual(CROWD.maxPushSpeed * DT + 1e-9);
    expect(p.pos[1]).toBe(0);
    expect(p.pos[2]).toBeCloseTo(0, 9);
  });

  it('two overlapping players separate over time and stop moving (no jitter)', () => {
    const c = createCrowdCollision();
    const p = me(0, 0, 0);
    const remote = new Map([[1, other(0.05, 0, 0)]]);
    for (let i = 0; i < 120; i++) c.apply(p, remote, DT);
    expect(0.05 - p.pos[0]).toBeCloseTo(reach, 2);
    const x = p.pos[0];
    c.apply(p, remote, DT);
    expect(Math.abs(p.pos[0] - x)).toBeLessThan(1e-3);
  });

  it('never adds height when landing on a head', () => {
    const c = createCrowdCollision();
    const p = me(0.05, PLAYER.height * 0.8, 0);
    p.vel[1] = -1;
    c.apply(p, new Map([[1, other(0, 0, 0)]]), DT);
    expect(p.pos[1]).toBe(PLAYER.height * 0.8);
    expect(p.vel[1]).toBe(-1);
    expect(p.pos[0]).toBeGreaterThan(0.05);
  });

  it('separates players standing exactly on the same spot', () => {
    const c = createCrowdCollision();
    const p = me();
    c.apply(p, new Map([[3, other(0, 0, 0)]]), DT);
    expect(Math.hypot(p.pos[0], p.pos[2])).toBeGreaterThan(0);
  });

  it('resolves only the nearest maxNeighbours in a big pile', () => {
    const c = createCrowdCollision();
    const remote = new Map<number, RemoteState>();
    for (let i = 0; i < 300; i++) {
      const a = i * 0.37;
      const d = 0.05 + (i % 10) * 0.05;
      remote.set(i, other(Math.cos(a) * d, 0, Math.sin(a) * d));
    }
    const p = me();
    expect(c.apply(p, remote, DT)).toBe(CROWD.maxNeighbours);
    expect(Math.hypot(p.pos[0], p.pos[2])).toBeLessThanOrEqual(CROWD.maxPushSpeed * DT + 1e-9);
  });

  it('bounces a diver back', () => {
    const c = createCrowdCollision();
    const p = me();
    p.anim = Anim.DIVE;
    p.vel[2] = -8;
    c.apply(p, new Map([[1, other(0, 0, -0.3)]]), DT);
    expect(p.vel[2]).toBeCloseTo(CROWD.diveBounce, 5);
  });
});
