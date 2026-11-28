import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { BUTTERFLY } from '@wobble/shared/constants';
import type { RemoteState, Vec3 } from '@wobble/shared/types';
import { CONTROLS } from './howToPlay.ts';
import { BURST_SEC, burstPoint, createMarkerView, orbitPoint, ORBIT_HEIGHT_M, ORBIT_RADIUS_M } from './markers.ts';
import { STORM_LINES, stormLine, stormQuarterCrossed } from './stormReaction.ts';

describe('controls card', () => {
  const keys = (device: keyof typeof CONTROLS) => CONTROLS[device].flatMap((l) => l.keys);
  test('lists move, jump, dive and help up for every device', () => {
    for (const lines of Object.values(CONTROLS))
      expect(lines.map((l) => l.action)).toEqual(['Move', 'Jump', 'Dive', 'Help up / push']);
  });
  test("names each device's own controls", () => {
    expect(keys('keyboard')).toEqual(['W', 'A', 'S', 'D', 'Space', 'Shift', 'E']);
    expect(keys('gamepad')).toEqual(['Left stick', 'A', 'B', 'Y']);
    expect(keys('touch')).toEqual(['Drag left side', 'JUMP', 'DIVE', '🤝']);
  });
  test('says nothing about the butterfly effect', () => {
    expect(JSON.stringify(CONTROLS)).not.toMatch(/mark|storm|hero|villain|butterfl/i);
  });
});

describe('storm reactions', () => {
  const max = BUTTERFLY.STORM_MAX;
  test('a line at every quarter, once each', () => {
    let fired = 0;
    for (let l = 1; l <= max; l++) if (stormQuarterCrossed(l - 1, l, max)) fired++;
    expect(fired).toBe(4);
    expect(stormLine(max - 1, max, max)).toBe(STORM_LINES[3]);
  });
  test('quiet between quarters and when not rising', () => {
    expect(stormLine(0, 1, 20)).toBeNull();
    expect(stormLine(5, 5, 20)).toBeNull();
    expect(stormQuarterCrossed(0, 5, 20)).toBe(1);
    expect(stormQuarterCrossed(0, 20, 20)).toBe(4);
  });
});

describe('marked butterflies', () => {
  test('orbit stays around the player', () => {
    const out: Vec3 = [0, 0, 0];
    for (let t = 0; t < 3; t += 0.37) {
      orbitPoint([4, 1, -10], 7, t, out);
      expect(Math.hypot(out[0] - 4, out[2] + 10)).toBeCloseTo(ORBIT_RADIUS_M, 5);
      expect(Math.abs(out[1] - 1 - ORBIT_HEIGHT_M)).toBeLessThan(0.2);
    }
  });
  test('only marked players get one, the local player included', () => {
    const scene = new THREE.Scene();
    const v = createMarkerView({ scene });
    const remote = new Map<number, RemoteState>([
      [2, { pos: [1, 0, 1], yaw: 0, anim: 0 } as unknown as RemoteState],
      [3, { pos: [5, 0, 5], yaw: 0, anim: 0 } as unknown as RemoteState],
    ]);
    const visible = () => scene.children.filter((c) => c.visible).length;
    v.update(0, remote, 1, [0, 0, 0]);
    expect(visible()).toBe(0);
    v.mark(2);
    v.mark(1);
    v.update(0.5, remote, 1, [0, 0, 0]);
    expect(visible()).toBe(2);
    expect(v.isMarked(3)).toBe(false);
    v.reset();
    v.update(1, remote, 1, [0, 0, 0]);
    expect(visible()).toBe(0);
    v.dispose();
  });

  test('burst flies from the fallen player to the pusher in an arc', () => {
    const out: Vec3 = [0, 0, 0];
    burstPoint([0, 0, 0], [10, 0, 0], 0, out);
    expect(out).toEqual([0, ORBIT_HEIGHT_M, 0]);
    burstPoint([0, 0, 0], [10, 0, 0], 1, out);
    expect(out[0]).toBeCloseTo(10, 5);
    expect(out[1]).toBeCloseTo(ORBIT_HEIGHT_M, 5);
    burstPoint([0, 0, 0], [10, 0, 0], 0.5, out);
    expect(out[1]).toBeGreaterThan(ORBIT_HEIGHT_M);
  });
  test('burst then circles the pusher', () => {
    const scene = new THREE.Scene();
    const v = createMarkerView({ scene });
    const remote = new Map<number, RemoteState>([[2, { pos: [4, 0, 0], yaw: 0, anim: 0 } as unknown as RemoteState]]);
    const visible = () => scene.children.filter((c) => c.visible).length;
    v.burst(1, 2);
    expect(v.isMarked(1)).toBe(true);
    v.update(0, remote, 1, [0, 0, 0]);
    expect(v.bursting()).toBe(true);
    expect(visible()).toBe(1); // only the flying one
    v.update(BURST_SEC + 0.01, remote, 1, [0, 0, 0]);
    expect(v.bursting()).toBe(false);
    expect(visible()).toBe(1); // now the orbiting one
    v.dispose();
  });
});
