import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import type { RemoteState } from '@wobble/shared';
import { Anim, WIRE } from '@wobble/shared/constants';
import { fixtureSkin } from '@wobble/shared';
import { createCrowd, type CrowdWobbler } from './crowd.ts';
import { createSlotPool } from './pool.ts';
import { assignTiers, createTierScratch } from './tiers.ts';

function tiers(n: number, nearMax: number, maxPromote = 1000) {
  const dist2 = new Float32Array(n);
  const was = new Uint8Array(n);
  const out = new Uint8Array(n);
  const s = createTierScratch(n);
  const run = () => {
    const c = assignTiers(n, dist2, was, out, nearMax, maxPromote, s);
    was.set(out);
    return c;
  };
  return { dist2, was, out, run };
}

describe('assignTiers', () => {
  test('picks the nearest and skips hidden players', () => {
    const t = tiers(10, 3);
    for (let i = 0; i < 10; i++) t.dist2[i] = (10 - i) ** 2;
    t.dist2[9] = Infinity;
    expect(t.run()).toBe(3);
    expect([...t.out]).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 0]);
  });

  test('hysteresis: a near player is not swapped out by a slightly closer one', () => {
    const t = tiers(2, 1);
    t.dist2[0] = 10 ** 2;
    t.dist2[1] = 11 ** 2;
    t.run();
    expect(t.out[0]).toBe(1);
    t.dist2[1] = 9.7 ** 2; // within the sticky margin
    t.run();
    expect(t.out[0]).toBe(1);
    t.dist2[1] = 8 ** 2; // clearly closer
    t.run();
    expect([...t.out]).toEqual([0, 1]);
  });

  test('no flicker when two players hover at the boundary', () => {
    const t = tiers(2, 1);
    let flips = 0;
    let prev = -1;
    for (let f = 0; f < 200; f++) {
      t.dist2[0] = (10 + 0.3 * Math.sin(f * 0.7)) ** 2;
      t.dist2[1] = (10 + 0.3 * Math.cos(f * 0.9)) ** 2;
      t.run();
      const who = t.out[0] ? 0 : 1;
      if (prev >= 0 && who !== prev) flips++;
      prev = who;
    }
    expect(flips).toBe(0);
  });

  test('promotions are capped per call, closest first', () => {
    const t = tiers(30, 24, 3);
    for (let i = 0; i < 30; i++) t.dist2[i] = i + 1;
    expect(t.run()).toBe(3);
    expect([...t.out.slice(0, 4)]).toEqual([1, 1, 1, 0]);
    let frames = 2; // the call above plus the one that reaches 24
    while (t.run() < 24) frames++;
    expect(frames).toBe(8);
  });
});

describe('createSlotPool', () => {
  test('no leaks after 1,000 join/leave cycles', () => {
    const p = createSlotPool(300);
    for (let i = 0; i < 300; i++) expect(p.acquire(i)).toBeGreaterThanOrEqual(0);
    expect(p.acquire(999)).toBe(-1);
    let next = 300;
    for (let c = 0; c < 1000; c++) {
      const victim = p.idAt(c % 300);
      p.release(victim);
      expect(p.acquire(next++)).toBe(c % 300);
    }
    expect(p.size).toBe(300);
    for (let s = 0; s < 300; s++) p.release(p.idAt(s));
    expect(p.size).toBe(0);
    expect(p.span).toBe(0);
  });
});

function fakeFactory() {
  let live = 0;
  let built = 0;
  const factory = (skin: unknown): CrowdWobbler => {
    live++;
    built++;
    const object3d = new THREE.Group();
    object3d.userData.skin = skin;
    let disposed = false;
    return {
      object3d,
      setPose(pose) {
        object3d.position.set(pose.pos[0]!, pose.pos[1]!, pose.pos[2]!);
      },
      dispose() {
        if (!disposed) live--;
        disposed = true;
      },
    };
  };
  return { factory, live: () => live, built: () => built };
}

function state(x: number, z: number): RemoteState {
  return { pos: [x, 0, z], yaw: 0, anim: Anim.RUN, flags: WIRE.FLAG_GROUNDED };
}

describe('createCrowd', () => {
  const cam = { x: 0, y: 0, z: 0 };

  test('splits 300 players into near and far tiers and hides missing ones', () => {
    const scene = new THREE.Scene();
    const f = fakeFactory();
    const crowd = createCrowd({ scene, max: 300, wobblerFactory: f.factory, nearMax: 6, maxPromotePerFrame: 6 });
    const list = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, name: `p${i}` }));
    crowd.setPlayers(list);
    const states = new Map<number, RemoteState>();
    for (let i = 0; i < 300; i++) states.set(i + 1, state(i + 1, 0));
    states.delete(300);
    crowd.update(states, cam, 1 / 60);
    expect(crowd.stats()).toMatchObject({ players: 300, near: 6, far: 293, hidden: 1 });
    expect(crowd.farMesh.count).toBe(293);
    expect(crowd.shadowMesh.count).toBe(299);
    expect(f.live()).toBe(6);
    crowd.dispose();
    expect(f.live()).toBe(0);
    expect(scene.children.length).toBe(0);
  });

  test('late setSkin swaps in place and updates far colours', () => {
    const scene = new THREE.Scene();
    const f = fakeFactory();
    const crowd = createCrowd({ scene, max: 4, wobblerFactory: f.factory, nearMax: 1 });
    crowd.setPlayers([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ]);
    const states = new Map([
      [1, state(1, 0)],
      [2, state(5, 0)],
    ]);
    crowd.update(states, cam, 1 / 60);
    const before = (crowd.farMesh.geometry.getAttribute('iPrimary').array as Float32Array).slice(0, 3);
    crowd.setSkin(1, fixtureSkin);
    crowd.setSkin(2, { ...fixtureSkin, body: { ...fixtureSkin.body, color: '#00ff00' } });
    crowd.update(states, cam, 1 / 60);
    const after = (crowd.farMesh.geometry.getAttribute('iPrimary').array as Float32Array).slice(0, 3);
    expect([...after]).not.toEqual([...before]);
    const near = scene.children.find((c) => c.userData.skin === fixtureSkin);
    expect(near).toBeDefined();
    expect(f.live()).toBe(1);
    crowd.dispose();
  });

  test('pooled reuse: 1,000 join/leave cycles leave nothing behind', () => {
    const scene = new THREE.Scene();
    const f = fakeFactory();
    const crowd = createCrowd({ scene, max: 50, wobblerFactory: f.factory, nearMax: 4, maxPromotePerFrame: 4 });
    const roster = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `p${i}` }));
    const states = new Map<number, RemoteState>();
    let next = 50;
    const baseChildren = scene.children.length;
    for (let c = 0; c < 1000; c++) {
      const leaving = roster[c % 50]!;
      states.delete(leaving.id);
      roster[c % 50] = { id: next++, name: 'x' };
      for (const p of roster) if (!states.has(p.id)) states.set(p.id, state((p.id % 13) - 6, (p.id % 7) - 3));
      crowd.setPlayers(roster);
      crowd.update(states, cam, 1 / 60);
    }
    expect(crowd.stats().players).toBe(50);
    expect(f.live()).toBe(4);
    expect(scene.children.length).toBe(baseChildren + 4);
    crowd.setPlayers([]);
    crowd.update(states, cam, 1 / 60);
    expect(f.live()).toBe(0);
    expect(crowd.stats()).toMatchObject({ players: 0, near: 0, far: 0 });
    crowd.dispose();
  });

  test('default factory builds real Wobblers', () => {
    const scene = new THREE.Scene();
    const crowd = createCrowd({ scene, max: 2 });
    crowd.setPlayers([{ id: 7, name: 'w', skin: fixtureSkin }]);
    crowd.update(new Map([[7, state(0, -3)]]), cam, 1 / 60);
    expect(crowd.stats().near).toBe(1);
    crowd.dispose();
    expect(scene.children.length).toBe(0);
  });
});
