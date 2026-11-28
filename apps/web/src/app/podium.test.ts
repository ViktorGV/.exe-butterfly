import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { createPodium, podiumPlacement, PODIUM_HEIGHTS, type PodiumResult, type PodiumSpot } from './podium.ts';

const r = (id: number, place: number, timeMs: number | null): PodiumResult => ({ id, place, timeMs });

describe('podiumPlacement', () => {
  it('puts 1st centre, 2nd left, 3rd right and drops the rest', () => {
    const out = podiumPlacement([r(4, 4, 40), r(2, 2, 20), r(1, 1, 10), r(3, 3, 30)]);
    expect(out).toEqual([
      { id: 1, place: 1, spot: 0, timeMs: 10 },
      { id: 2, place: 2, spot: 1, timeMs: 20 },
      { id: 3, place: 3, spot: 2, timeMs: 30 },
    ]);
  });

  it('handles fewer than three finishers', () => {
    expect(podiumPlacement([])).toEqual([]);
    expect(podiumPlacement([r(7, 1, 5)])).toEqual([{ id: 7, place: 1, spot: 0, timeMs: 5 }]);
    expect(podiumPlacement([r(7, 2, 9), r(8, 1, 5)]).map((s) => s.id)).toEqual([8, 7]);
  });

  it('leaves DNF players (no time) off the podium', () => {
    const out = podiumPlacement([r(1, 1, 10), r(2, 2, null), r(3, 3, null)]);
    expect(out).toEqual([{ id: 1, place: 1, spot: 0, timeMs: 10 }]);
  });

  it('tied places share a height; ties broken by time then id', () => {
    const out = podiumPlacement([r(5, 1, 10), r(3, 1, 10), r(9, 3, 30), r(8, 4, 40)]);
    expect(out).toEqual([
      { id: 3, place: 1, spot: 0, timeMs: 10 },
      { id: 5, place: 1, spot: 1, timeMs: 10 },
      { id: 9, place: 3, spot: 2, timeMs: 30 },
    ]);
  });

  it('reuses the output array', () => {
    const out: PodiumSpot[] = [];
    expect(podiumPlacement([r(1, 1, 1)], out)).toBe(out);
    podiumPlacement([], out);
    expect(out.length).toBe(0);
  });
});

describe('createPodium', () => {
  it('pools figures per key and aims the camera', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 0.5);
    let built = 0;
    const podium = createPodium({
      scene,
      camera,
      figure: () => {
        built++;
        const o = new THREE.Group();
        return { object3d: o, setPose: (p) => o.position.set(p.pos[0]!, p.pos[1]!, p.pos[2]!), dispose() {} };
      },
      keyOf: (skin) => String(skin),
      idleAnim: 0,
    });
    const spots = podiumPlacement([r(1, 1, 1), r(2, 2, 2), r(3, 3, 3)]);
    const skinOf = (id: number) => `s${id}`;
    const nameOf = (id: number) => `P${id}`;
    for (let k = 0; k < 3; k++) {
      podium.show([0, 10, -50], spots, skinOf, nameOf);
      podium.update(1 / 60);
      podium.hide();
    }
    expect(built).toBe(3);
    podium.show([0, 10, -50], spots, skinOf, nameOf);
    podium.update(1 / 60);
    expect(podium.active).toBe(true);
    expect(camera.position.z).toBeGreaterThan(-50);
    const root = scene.getObjectByName('podium')!;
    expect(root.children.some((c) => c.position.y === PODIUM_HEIGHTS[0])).toBe(true);
    podium.dispose();
    expect(scene.getObjectByName('podium')).toBeUndefined();
  });
});
