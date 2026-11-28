import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import type { EntityDef } from '@wobble/shared/types';
import { createWindView, STREAKS_PER_ZONE } from './index.ts';

const fan = (id: number, pos: [number, number, number], yaw = 0, params: Record<string, unknown> = {}): EntityDef => ({
  id,
  kind: 'snowBlower',
  pos,
  yaw,
  params: { reach: 40, width: 8, height: 3, windSpeed: 5, onSec: 3, offSec: 2, warnSec: 0.5, phase: 0, ...params },
});

const meshes = (scene: THREE.Scene, prefix: string) => {
  const out: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name.startsWith(prefix)) out.push(o);
  });
  return out;
};

describe('wind view', () => {
  it('draws nothing for a course without fans', () => {
    const scene = new THREE.Scene();
    const wind = createWindView({ scene, entities: [{ id: 1, kind: 'platform', pos: [0, 0, 0], yaw: 0, params: {} }] });
    expect(wind.zones).toBe(0);
    expect(meshes(scene, 'wind:')).toHaveLength(0);
    wind.update(1, 0.016);
    expect(wind.active).toBe(false);
    wind.dispose();
  });

  it('builds one instanced draw of every streak plus one floor strip per fan', () => {
    const scene = new THREE.Scene();
    const wind = createWindView({ scene, entities: [fan(1, [0, 0, 0]), fan(2, [0, 0, -10]), fan(3, [0, 0, -20])] });
    expect(wind.zones).toBe(3);
    const streaks = meshes(scene, 'wind:streaks');
    expect(streaks).toHaveLength(1);
    expect((streaks[0]!.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(3 * STREAKS_PER_ZONE);
    expect(meshes(scene, 'wind:floor')).toHaveLength(3);
    wind.dispose();
  });

  it('is hidden while every fan is off, and visible while one blows or warns', () => {
    const scene = new THREE.Scene();
    const wind = createWindView({ scene, entities: [fan(1, [0, 0, 0])] });
    const root = scene.getObjectByName('wind')!;
    for (let t = 3.2; t < 4.2; t += 1 / 60) wind.update(t, 1 / 60); // off
    expect(wind.active).toBe(false);
    expect(root.visible).toBe(false);
    for (let t = 4.2; t < 4.9; t += 1 / 60) wind.update(t, 1 / 60); // warning
    expect(wind.active).toBe(true);
    expect(root.visible).toBe(true);
    for (let t = 5; t < 6; t += 1 / 60) wind.update(t, 1 / 60); // blowing again (5 s = 0 s into the next cycle)
    expect(wind.active).toBe(true);
    wind.dispose();
  });

  it('lays each floor strip downwind of its fan, turned with it, as long as its reach', () => {
    const scene = new THREE.Scene();
    const yaw = Math.PI / 2;
    const wind = createWindView({ scene, entities: [fan(1, [10, 2, -30], yaw, { reach: 40, width: 8 })] });
    const [floor] = meshes(scene, 'wind:floor');
    expect(floor!.scale.x).toBe(40);
    expect(floor!.scale.z).toBe(8);
    expect(floor!.position.y).toBeGreaterThan(2); // just above the floor the fan stands on
    expect(floor!.position.y).toBeLessThan(2.2);
    // the fan blows toward local +X = (cos yaw, -sin yaw) = (0, -1) in the world: down the course
    expect(floor!.position.x).toBeCloseTo(10, 6);
    expect(floor!.position.z).toBeCloseTo(-30 - 20, 6);
    // and the plane's own long axis follows the wind
    const along = new THREE.Vector3(1, 0, 0).applyEuler(floor!.rotation);
    expect(along.x).toBeCloseTo(0, 6);
    expect(along.z).toBeCloseTo(-1, 6);
    wind.dispose();
  });

  it('writes the simulation straight into the instance buffers it draws', () => {
    const scene = new THREE.Scene();
    const wind = createWindView({ scene, entities: [fan(1, [0, 0, 0])] });
    const geo = meshes(scene, 'wind:streaks')[0]!.geometry as THREE.InstancedBufferGeometry;
    expect((geo.getAttribute('iPos') as THREE.BufferAttribute).array).toBe(wind.field.pos);
    expect((geo.getAttribute('iAlpha') as THREE.BufferAttribute).array).toBe(wind.field.alpha);
    const version = (geo.getAttribute('iPos') as THREE.BufferAttribute).version;
    for (let t = 0; t < 1; t += 1 / 60) wind.update(t, 1 / 60);
    expect((geo.getAttribute('iPos') as THREE.BufferAttribute).version).toBeGreaterThan(version);
    wind.dispose();
  });

  it('removes everything when disposed', () => {
    const scene = new THREE.Scene();
    const wind = createWindView({ scene, entities: [fan(1, [0, 0, 0])] });
    wind.dispose();
    expect(scene.getObjectByName('wind')).toBeUndefined();
  });
});
