// Gun: every BUTTERFLY.GUN_PUSHES pushes you receive earn you a gun with BUTTERFLY.GUN_SHOTS shots. A shot
// auto-aims at the nearest racer within BUTTERFLY.GUN_RANGE_M and sends them back to their last checkpoint.
//
//   const target = nearestTarget(player.state, remote);   // id or -1
//   const tracer = createTracer({ scene });
//   tracer.fire(fromPos, toPos, performance.now());
//   engine.onRender(() => tracer.update(performance.now()));
//
// Allocation-free per shot: one pooled line, reused.
import * as THREE from 'three';
import type { Vec3 } from '@wobble/shared/types';

export { nearestTarget } from './aim.ts';

/** How long a shot's line stays on screen, ms. */
const TRACER_MS = 220;

export function createTracer({ scene }: { scene: THREE.Object3D }) {
  const positions = new Float32Array(6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 1, depthTest: false });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 10;
  line.visible = false;
  scene.add(line);
  let firedAt = -Infinity;
  return {
    /** Draw a shot from `from` to `to` (feet positions; drawn at chest height). */
    fire(from: Readonly<Vec3>, to: Readonly<Vec3>, nowMs: number) {
      positions[0] = from[0];
      positions[1] = from[1] + 1.1;
      positions[2] = from[2];
      positions[3] = to[0];
      positions[4] = to[1] + 1;
      positions[5] = to[2];
      geo.attributes.position!.needsUpdate = true;
      firedAt = nowMs;
      line.visible = true;
    },
    update(nowMs: number) {
      if (!line.visible) return;
      const u = (nowMs - firedAt) / TRACER_MS;
      if (u >= 1) line.visible = false;
      else mat.opacity = 1 - u;
    },
    dispose() {
      scene.remove(line);
      geo.dispose();
      mat.dispose();
    },
  };
}
