import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { BUTTERFLY } from '@wobble/shared/constants';
import type { RemoteState, Vec3 } from '@wobble/shared/types';
import { HOW_TO_PLAY } from './howToPlay.ts';
import { createMarkerView, orbitPoint, ORBIT_HEIGHT_M, ORBIT_RADIUS_M } from './markers.ts';
import { STORM_LINES, stormLine, stormQuarterCrossed } from './stormReaction.ts';

describe('how-to-play card', () => {
  const text = HOW_TO_PLAY.map((l) => `${l.icon} ${l.text}`).join('\n');
  test('explains the controls and all three Help up icons', () => {
    for (const s of ['Joystick', 'Jump', 'Dive', 'Shift', 'Help up', '👊', '✋', '🤝']) expect(text).toContain(s);
  });
  test('says nothing about the butterfly effect', () => {
    expect(text).not.toMatch(/mark|storm|hero|villain|butterfl/i);
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
});
