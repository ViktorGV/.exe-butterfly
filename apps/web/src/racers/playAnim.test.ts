import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { Anim } from '@wobble/shared/constants';
import { BONE_COUNT } from './bones.ts';
import type { BuiltRacer } from './index.ts';
import { applyPlayPose } from './play.ts';
import { CELEBRATION_COUNT, celebratePose, createPlayAnimator, newPose } from './playAnim.ts';
import type { Full } from './anim.ts';

const DIMS = { front: 0.3, back: 0.28, side: 0.25 };

function fakeRacer(): BuiltRacer {
  const body = new THREE.Group();
  const bones = Array.from({ length: BONE_COUNT }, () => new THREE.Bone());
  const rest = Array.from({ length: BONE_COUNT }, (_, i) => new THREE.Vector3(i * 0.05, 0.3 + i * 0.07, 0));
  return { ...DIMS, body, bones, rest, height: 1 } as unknown as BuiltRacer;
}

const numbers = (p: Full): number[] => [
  p.x,
  p.y,
  p.z,
  p.pitch,
  p.roll,
  p.yaw,
  p.squash,
  ...p.hips,
  ...p.spine,
  ...p.head,
  ...p.armR.u,
  ...p.armR.f,
  ...p.armL.u,
  ...p.armL.f,
  ...p.legR,
  ...p.legL,
];

const STATES = Object.values(Anim);

describe('racer play animation', () => {
  it('every state gives a finite pose over time and through transitions', () => {
    const a = createPlayAnimator(DIMS, 7);
    for (const s of STATES) {
      for (let i = 0; i < 120; i++) {
        for (const v of numbers(a.update(s, 6, 1 / 60))) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('cross-fades: the first frame after a state change stays close to the previous pose', () => {
    const a = createPlayAnimator(DIMS, 3);
    for (let i = 0; i < 60; i++) a.update(Anim.IDLE, 0, 1 / 60);
    const before = a.pose.pitch;
    a.update(Anim.DIVE, 8, 1 / 60);
    expect(Math.abs(a.pose.pitch - before)).toBeLessThan(0.3);
    for (let i = 0; i < 30; i++) a.update(Anim.DIVE, 8, 1 / 60);
    expect(a.pose.pitch).toBeLessThan(-1.2);
  });

  it('squashes on landing after a jump, then settles', () => {
    const a = createPlayAnimator(DIMS, 1);
    for (let i = 0; i < 30; i++) a.update(Anim.JUMP, 0, 1 / 60);
    a.update(Anim.IDLE, 0, 1 / 60);
    let max = 0;
    for (let i = 0; i < 6; i++) max = Math.max(max, a.update(Anim.IDLE, 0, 1 / 60).squash);
    expect(max).toBeGreaterThan(0.08);
    for (let i = 0; i < 60; i++) a.update(Anim.IDLE, 0, 1 / 60);
    expect(Math.abs(a.pose.squash)).toBeLessThan(0.05);
  });

  it('jump anticipates (crouch) then stretches', () => {
    const a = createPlayAnimator(DIMS, 1);
    a.update(Anim.IDLE, 0, 1 / 60);
    for (let i = 0; i < 12; i++) a.update(Anim.JUMP, 0, 1 / 60); // 0.2 s in
    expect(a.pose.squash).toBeLessThan(-0.05);
  });

  it('picks a different celebration each finish, and the podium can choose one', () => {
    const a = createPlayAnimator(DIMS, 5);
    const seen = new Set<number>();
    for (let k = 0; k < 4; k++) {
      seen.add(a.celebration);
      a.update(Anim.CELEBRATE, 0, 1 / 60);
      a.update(Anim.IDLE, 0, 1 / 60);
    }
    expect(seen.size).toBeGreaterThan(1);
    const o = newPose();
    for (let v = 0; v < CELEBRATION_COUNT; v++) {
      for (const t of [0, 0.3, 1.1, 5])
        for (const n of numbers(celebratePose(o, v, t))) expect(Number.isFinite(n)).toBe(true);
    }
    // celebrations differ from each other
    const a0 = numbers(celebratePose(newPose(), 0, 0.3)).join();
    const a1 = numbers(celebratePose(newPose(), 1, 0.3)).join();
    expect(a0).not.toBe(a1);
  });

  it('idle has fidgets: the head turns further than plain breathing at some point', () => {
    const a = createPlayAnimator(DIMS, 11);
    let maxYaw = 0;
    for (let i = 0; i < 60 * 60; i++) maxYaw = Math.max(maxYaw, Math.abs(a.update(Anim.IDLE, 0, 1 / 60).head[1]));
    expect(maxYaw).toBeGreaterThan(0.3);
  });

  it('allocates (almost) nothing per frame for 150 racers', () => {
    const racers = Array.from({ length: 150 }, (_, i) => ({ r: fakeRacer(), a: createPlayAnimator(DIMS, i) }));
    const frame = (f: number) => {
      for (let i = 0; i < racers.length; i++) {
        const { r, a } = racers[i]!;
        applyPlayPose(r, a.update(STATES[((f >> 5) + i) % STATES.length]!, 7, 1 / 60));
      }
    };
    for (let f = 0; f < 400; f++) frame(f);
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    for (let f = 0; f < 600; f++) frame(f);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(300_000);
  });
});
