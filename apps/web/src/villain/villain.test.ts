import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { BUTTERFLY } from '@wobble/shared/constants';
import { arcPosition, createVillainView, MAX_THROWS, VILLAIN_SKIN, type ThrowInfo } from './index.ts';

const throwInfo = (n: number, landAt: number, pos: [number, number] = [4, -30]): ThrowInfo => ({
  n,
  target: 2,
  pos,
  landAt,
});

/** The circle and obstacle meshes of the view, found by geometry type. */
function parts(scene: THREE.Scene) {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  return {
    rings: meshes.filter((m) => m.geometry instanceof THREE.RingGeometry),
    balls: meshes.filter((m) => m.geometry instanceof THREE.SphereGeometry),
  };
}

describe('arcPosition', () => {
  const from: [number, number, number] = [0, 10, -60];
  const to: [number, number, number] = [6, 1, -20];
  const out: [number, number, number] = [0, 0, 0];

  it('starts at the boss and ends at the impact point', () => {
    expect(arcPosition(from, to, 0, 5, out)).toEqual(from);
    const end = arcPosition(from, to, 1, 5, out);
    expect(end[0]).toBeCloseTo(6, 9);
    expect(end[1]).toBeCloseTo(1, 9);
    expect(end[2]).toBeCloseTo(-20, 9);
  });

  it('arcs above the straight line by the given height at the middle', () => {
    const mid = arcPosition(from, to, 0.5, 5, out);
    expect(mid[1]).toBeCloseTo((10 + 1) / 2 + 5, 9);
    expect(mid[0]).toBeCloseTo(3, 9);
    expect(mid[2]).toBeCloseTo(-40, 9);
  });

  it('clamps outside 0..1 and writes into the array it is given', () => {
    expect(arcPosition(from, to, -3, 5, out)).toBe(out);
    expect(out).toEqual(from);
    arcPosition(from, to, 9, 5, out);
    expect(out[2]).toBeCloseTo(-20, 9);
  });
});

describe('villain view', () => {
  it('shows a red circle at the impact until the throw lands, then fades it out', () => {
    const scene = new THREE.Scene();
    const view = createVillainView({ scene });
    const { rings, balls } = parts(scene);
    expect(view.activeCount).toBe(0);
    expect(rings.every((r) => !r.visible)).toBe(true);

    view.throwAt(throwInfo(0, 1000 + BUTTERFLY.THROW_WARN_MS), 2, 1000);
    expect(view.activeCount).toBe(1);
    const ring = rings.find((r) => r.visible)!;
    expect(ring.position.x).toBe(4);
    expect(ring.position.z).toBe(-30);
    expect(ring.position.y).toBeCloseTo(2.06, 6); // on the floor at the impact
    expect(balls.filter((b) => b.visible)).toHaveLength(1);

    view.update(1500, 0.016); // still in the air
    expect(view.activeCount).toBe(1);
    const ball = balls.find((b) => b.visible)!;
    expect(ball.position.y).toBeGreaterThan(2); // arcing above the floor

    view.update(1000 + BUTTERFLY.THROW_WARN_MS + 100, 0.016); // landed: the obstacle is gone, circle bursts
    expect(balls.some((b) => b.visible)).toBe(false);
    expect(ring.visible).toBe(true);
    expect(ring.scale.x).toBeGreaterThan(1);

    view.update(1000 + BUTTERFLY.THROW_WARN_MS + 1000, 0.016); // splash over
    expect(view.activeCount).toBe(0);
    expect(ring.visible).toBe(false);
    view.dispose();
  });

  it('the boss appears with the first throw and reset hides everything', () => {
    const scene = new THREE.Scene();
    const view = createVillainView({ scene, skin: VILLAIN_SKIN });
    expect(view.bossVisible).toBe(false);
    view.setBoss([0, 3, -200]);
    expect(view.bossVisible).toBe(true);
    view.throwAt(throwInfo(0, 3000), 0, 2000);
    view.throwAt(throwInfo(1, 3000, [-4, -30]), 0, 2000);
    expect(view.activeCount).toBe(2);
    // with a boss, the obstacle starts at the boss, high up
    const { balls } = parts(scene);
    view.update(2000, 0.016);
    const flying = balls.filter((b) => b.visible)[0]!;
    expect(Math.abs(flying.position.z + 200)).toBeLessThan(5);

    view.reset();
    expect(view.bossVisible).toBe(false);
    expect(view.activeCount).toBe(0);
    expect(parts(scene).rings.every((r) => !r.visible)).toBe(true);
    view.dispose();
  });

  it('circles fade independently: one landing does not dim the others', () => {
    const scene = new THREE.Scene();
    const view = createVillainView({ scene });
    view.throwAt(throwInfo(0, 2000), 0, 1000);
    view.throwAt(throwInfo(1, 5000, [-4, -30]), 0, 1000);
    view.update(2150, 0.016); // first one splashing, second still warning
    const visible = parts(scene).rings.filter((r) => r.visible);
    const opacities = visible.map((r) => (r.material as THREE.MeshBasicMaterial).opacity).sort();
    expect(visible).toHaveLength(2);
    expect(opacities[0]).not.toBe(opacities[1]);
    view.dispose();
  });

  it('never grows past its pool: a flood of throws reuses the oldest slots', () => {
    const scene = new THREE.Scene();
    const view = createVillainView({ scene });
    for (let i = 0; i < MAX_THROWS * 2; i++) view.throwAt(throwInfo(i, 10_000, [i, -30]), 0, 1000);
    expect(view.activeCount).toBe(MAX_THROWS);
    expect(parts(scene).rings).toHaveLength(MAX_THROWS);
    view.dispose();
  });
});
