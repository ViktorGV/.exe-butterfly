import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { Anim, WIRE } from '@wobble/shared/constants';
import type { RemoteState, Vec3 } from '@wobble/shared/types';
import { createFx, FX } from './fx.ts';

const at: Vec3 = [0, 1, -5];
const setup = (reducedMotion = false) => {
  const scene = new THREE.Scene();
  const fx = createFx({ scene, reducedMotion, random: () => 0.5 });
  return { scene, fx };
};

describe('fx', () => {
  it('adds exactly one draw call (a single Points) to the scene', () => {
    const { scene, fx } = setup();
    expect(scene.children.length).toBe(1);
    expect(scene.children[0]).toBe(fx.object3d);
    expect(fx.object3d.visible).toBe(false);
  });

  it('spawns every effect and lets particles expire back to an empty pool', () => {
    const { fx } = setup();
    fx.dust(at);
    fx.ring(at);
    fx.stars(at);
    fx.sparkle(at);
    fx.poof(at);
    fx.confetti(at);
    fx.speedLines(at, [0, 0, -10]);
    expect(fx.count).toBeGreaterThan(100);
    fx.update(1 / 60);
    expect(fx.object3d.visible).toBe(true);
    expect(fx.object3d.geometry.drawRange.count).toBe(fx.count);
    for (let i = 0; i < 300; i++) fx.update(1 / 60);
    expect(fx.count).toBe(0);
    expect(fx.object3d.visible).toBe(false);
  });

  it('never exceeds the pool size', () => {
    const { fx } = setup();
    for (let i = 0; i < 50; i++) fx.confetti(at);
    expect(fx.count).toBe(FX.maxParticles);
    fx.update(1 / 60);
    expect(fx.count).toBeLessThanOrEqual(FX.maxParticles);
  });

  it('shakes the camera after its update, but not under reduced motion', () => {
    const cam = new THREE.PerspectiveCamera();
    const { fx } = setup();
    fx.shake(1);
    fx.update(1 / 60, cam);
    expect(cam.position.length()).toBeGreaterThan(0);
    const calm = setup(true).fx;
    const cam2 = new THREE.PerspectiveCamera();
    calm.shake(1);
    calm.update(1 / 60, cam2);
    expect(cam2.position.length()).toBe(0);
  });

  it('gives remote players a poof on respawn only when near', () => {
    const { fx } = setup();
    const near: RemoteState = { pos: [0, 0, 2], yaw: 0, anim: Anim.RUN, flags: 0 };
    const far: RemoteState = { pos: [0, 0, 200], yaw: 0, anim: Anim.RUN, flags: 0 };
    const remote = new Map([
      [1, near],
      [2, far],
    ]);
    const cam = { x: 0, y: 2, z: 5 };
    fx.watchRemote(remote, cam);
    expect(fx.count).toBe(0);
    far.flags = WIRE.FLAG_RESPAWNED;
    fx.watchRemote(remote, cam);
    expect(fx.count).toBe(0);
    near.flags = WIRE.FLAG_RESPAWNED;
    fx.watchRemote(remote, cam);
    expect(fx.count).toBeGreaterThan(0);
  });

  it('uses theme fx colors', () => {
    const { fx } = setup();
    fx.setColors({ confetti: ['#ff0000'], checkpoint: '#00ff00', hit: '#0000ff' });
    fx.confetti(at);
    const col = fx.object3d.geometry.getAttribute('color').array;
    expect(col[0]).toBeCloseTo(1);
    expect(col[1]).toBeCloseTo(0);
  });

  it('allocates (almost) nothing and stays well under 1 ms per frame in a busy race', () => {
    const { fx } = setup();
    const cam = new THREE.PerspectiveCamera();
    const remote = new Map<number, RemoteState>();
    for (let i = 0; i < 100; i++) remote.set(i + 1, { pos: [i % 10, 0, -i], yaw: 0, anim: Anim.RUN, flags: 0 });
    const frame = (i: number) => {
      if (i % 3 === 0) fx.dust(at, 0.5);
      if (i % 20 === 0) fx.stars(at);
      if (i % 30 === 0) fx.confetti(at);
      if (i % 7 === 0) fx.speedLines(at, [0, 0, -8]);
      for (const r of remote.values()) r.flags = i % 2 ? WIRE.FLAG_GROUNDED : 0;
      fx.watchRemote(remote, cam.position);
      fx.shake(0.3);
      fx.update(1 / 60, cam);
    };
    for (let i = 0; i < 120; i++) frame(i);
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const frames = 3000;
    for (let i = 0; i < frames; i++) frame(i);
    const ms = (performance.now() - t0) / frames;
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(1_000_000);
    expect(ms).toBeLessThan(1);
    expect(fx.count).toBeLessThanOrEqual(FX.maxParticles);
  });
});
