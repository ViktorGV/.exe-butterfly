// Gun: every BUTTERFLY.GUN_PUSHES pushes you receive earn you a gun with BUTTERFLY.GUN_SHOTS shots. A shot
// auto-aims at the nearest racer within BUTTERFLY.GUN_RANGE_M and sends them back to their last checkpoint.
//
//   const target = nearestTarget(player.state, remote);   // id or -1
//   const tracer = createTracer({ scene });
//   tracer.fire(fromPos, toPos, performance.now());
//   engine.onRender(() => tracer.update(performance.now()));
//
// Allocation-free per shot: pooled lines and rockets, reused.
import * as THREE from 'three';
import type { Vec3 } from '@wobble/shared/types';

export { coneTargets, nearestAhead, nearestTarget } from './aim.ts';

/** How long a shot's line stays on screen, ms. */
const TRACER_MS = 220;
/** Lines drawn at once (a shotgun blast fans out several). */
const TRACERS = 12;

export function createTracer({ scene }: { scene: THREE.Object3D }) {
  const lines: {
    line: THREE.Line;
    geo: THREE.BufferGeometry;
    mat: THREE.LineBasicMaterial;
    pos: Float32Array;
    at: number;
  }[] = [];
  for (let i = 0; i < TRACERS; i++) {
    const pos = new Float32Array(6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 1, depthTest: false });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.renderOrder = 10;
    line.visible = false;
    scene.add(line);
    lines.push({ line, geo, mat, pos, at: -Infinity });
  }
  let next = 0;
  return {
    /** Draw a shot from `from` to `to` (feet positions; drawn at chest height). */
    fire(from: Readonly<Vec3>, to: Readonly<Vec3>, nowMs: number, color = 0xffe14d) {
      const l = lines[next]!;
      next = (next + 1) % TRACERS;
      l.pos[0] = from[0];
      l.pos[1] = from[1] + 1.1;
      l.pos[2] = from[2];
      l.pos[3] = to[0];
      l.pos[4] = to[1] + 1;
      l.pos[5] = to[2];
      l.geo.attributes.position!.needsUpdate = true;
      l.mat.color.setHex(color);
      l.at = nowMs;
      l.line.visible = true;
    },
    update(nowMs: number) {
      for (const l of lines) {
        if (!l.line.visible) continue;
        const u = (nowMs - l.at) / TRACER_MS;
        if (u >= 1) l.line.visible = false;
        else l.mat.opacity = 1 - u;
      }
    },
    dispose() {
      for (const l of lines) {
        scene.remove(l.line);
        l.geo.dispose();
        l.mat.dispose();
      }
    },
  };
}

/** Rockets in flight at once, and smoke puffs per rocket trail. */
const ROCKETS = 4;
const PUFFS = 10;
const PUFF_MS = 450;

/**
 * Rocket launcher shots: a small red rocket flies from the shooter and homes on the target (it reads the
 * target's position every frame), leaving a puffy smoke trail. `onHit` runs when it arrives. Pooled meshes.
 */
export function createRockets({ scene }: { scene: THREE.Object3D }) {
  const bodyGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 10);
  bodyGeo.rotateX(Math.PI / 2);
  const tipGeo = new THREE.ConeGeometry(0.09, 0.2, 10);
  tipGeo.rotateX(-Math.PI / 2);
  tipGeo.translate(0, 0, -0.35);
  const puffGeo = new THREE.SphereGeometry(0.18, 8, 6);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3fae5a });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xff4040, emissive: 0xff2000, emissiveIntensity: 0.6 });
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.7, depthWrite: false });
  type Rocket = {
    g: THREE.Group;
    from: Vec3;
    to: Readonly<Vec3> | null;
    at: number;
    flightMs: number;
    onHit: (() => void) | null;
    puffs: THREE.Mesh[];
    puffAt: Float64Array;
    nextPuff: number;
  };
  const rockets: Rocket[] = [];
  for (let i = 0; i < ROCKETS; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(bodyGeo, bodyMat), new THREE.Mesh(tipGeo, tipMat));
    g.visible = false;
    scene.add(g);
    const puffs: THREE.Mesh[] = [];
    for (let j = 0; j < PUFFS; j++) {
      const m = new THREE.Mesh(puffGeo, puffMat);
      m.visible = false;
      scene.add(m);
      puffs.push(m);
    }
    rockets.push({
      g,
      from: [0, 0, 0],
      to: null,
      at: 0,
      flightMs: 1,
      onHit: null,
      puffs,
      puffAt: new Float64Array(PUFFS),
      nextPuff: 0,
    });
  }
  const tmp = new THREE.Vector3();
  let next = 0;
  return {
    /** Launch from `from` toward `to` (a live position: the rocket follows it). */
    launch(from: Readonly<Vec3>, to: Readonly<Vec3>, nowMs: number, flightMs: number, onHit?: () => void) {
      const r = rockets[next]!;
      next = (next + 1) % ROCKETS;
      r.onHit?.(); // a rocket recycled mid-flight still lands its hit
      r.from[0] = from[0];
      r.from[1] = from[1] + 1.3;
      r.from[2] = from[2];
      r.to = to;
      r.at = nowMs;
      r.flightMs = Math.max(1, flightMs);
      r.onHit = onHit ?? null;
      r.g.visible = true;
    },
    update(nowMs: number) {
      for (const r of rockets) {
        for (let j = 0; j < PUFFS; j++) {
          const m = r.puffs[j]!;
          if (!m.visible) continue;
          const u = (nowMs - r.puffAt[j]!) / PUFF_MS;
          if (u >= 1) m.visible = false;
          else m.scale.setScalar(0.6 + u * 1.6);
        }
        if (!r.g.visible || !r.to) continue;
        const u = Math.min(1, (nowMs - r.at) / r.flightMs);
        // ease in, with an arc over the course so it reads as a rocket, not a bullet
        const e = u * u * (3 - 2 * u);
        const x = r.from[0] + (r.to[0] - r.from[0]) * e;
        const y = r.from[1] + (r.to[1] + 1 - r.from[1]) * e + Math.sin(u * Math.PI) * 2.5;
        const z = r.from[2] + (r.to[2] - r.from[2]) * e;
        tmp.set(x, y, z);
        r.g.lookAt(
          tmp.x + (tmp.x - r.g.position.x),
          tmp.y + (tmp.y - r.g.position.y),
          tmp.z + (tmp.z - r.g.position.z),
        );
        r.g.position.copy(tmp);
        const puff = r.puffs[r.nextPuff]!;
        if (nowMs - r.puffAt[r.nextPuff]! > 40) {
          puff.position.copy(tmp);
          puff.visible = true;
          puff.scale.setScalar(0.6);
          r.puffAt[r.nextPuff] = nowMs;
          r.nextPuff = (r.nextPuff + 1) % PUFFS;
        }
        if (u >= 1) {
          r.g.visible = false;
          const hit = r.onHit;
          r.onHit = null;
          r.to = null;
          hit?.();
        }
      }
    },
    dispose() {
      for (const r of rockets) {
        scene.remove(r.g);
        for (const m of r.puffs) scene.remove(m);
      }
      bodyGeo.dispose();
      tipGeo.dispose();
      puffGeo.dispose();
      bodyMat.dispose();
      tipMat.dispose();
      puffMat.dispose();
    },
  };
}

/** Muzzle flashes and rocket explosions at once. */
const FLASHES = 6;
const BOOMS = 3;
const FLASH_MS = 90;
const BOOM_MS = 650;

/**
 * Gun hit feel: a muzzle flash when a gun fires (bigger for the shotgun and rocket) and, for rockets, an explosion
 * with a white-hot core, an orange fireball and a shockwave ring racing out along the ground. Additive, pooled,
 * allocation-free per shot.
 */
export function createGunFx({ scene }: { scene: THREE.Object3D }) {
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  const ringGeo = new THREE.RingGeometry(0.8, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const additive = (color: number) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const make = (geo: THREE.BufferGeometry, color: number) => {
    const m = new THREE.Mesh(geo, additive(color));
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  };
  const flashes = Array.from({ length: FLASHES }, () => ({ m: make(sphere, 0xfff0a0), at: 0, size: 1 }));
  const booms = Array.from({ length: BOOMS }, () => ({
    core: make(sphere, 0xffffff),
    fire: make(sphere, 0xff6a00),
    smoke: (() => {
      const m = new THREE.Mesh(
        sphere,
        new THREE.MeshBasicMaterial({ color: 0x3a3030, transparent: true, depthWrite: false }),
      );
      m.visible = false;
      scene.add(m);
      return m;
    })(),
    ring: make(ringGeo, 0xffb040),
    at: 0,
    size: 1,
  }));
  let nf = 0;
  let nb = 0;
  const mat = (m: THREE.Mesh) => m.material as THREE.MeshBasicMaterial;
  return {
    /** A flash at the muzzle of a gun held at `pos` (feet), `size` metres across. */
    muzzle(pos: Readonly<Vec3>, nowMs: number, size = 0.5, color = 0xfff0a0) {
      const f = flashes[nf]!;
      nf = (nf + 1) % FLASHES;
      f.m.position.set(pos[0], pos[1] + 1.15, pos[2]);
      mat(f.m).color.setHex(color);
      f.at = nowMs;
      f.size = size;
      f.m.visible = true;
    },
    /** A rocket explosion `radius` metres across at `pos` (feet). */
    explosion(pos: Readonly<Vec3>, nowMs: number, radius = 5) {
      const b = booms[nb]!;
      nb = (nb + 1) % BOOMS;
      b.core.position.set(pos[0], pos[1] + 1, pos[2]);
      b.fire.position.copy(b.core.position);
      b.smoke.position.copy(b.core.position);
      b.ring.position.set(pos[0], pos[1] + 0.08, pos[2]);
      b.at = nowMs;
      b.size = radius;
      b.core.visible = b.fire.visible = b.smoke.visible = b.ring.visible = true;
    },
    update(nowMs: number) {
      for (const f of flashes) {
        if (!f.m.visible) continue;
        const u = (nowMs - f.at) / FLASH_MS;
        if (u >= 1) f.m.visible = false;
        else {
          f.m.scale.setScalar(f.size * (0.6 + u));
          mat(f.m).opacity = 1 - u;
        }
      }
      for (const b of booms) {
        if (!b.ring.visible) continue;
        const u = (nowMs - b.at) / BOOM_MS;
        if (u >= 1) {
          b.core.visible = b.fire.visible = b.smoke.visible = b.ring.visible = false;
          continue;
        }
        const out = 1 - (1 - u) ** 3; // fast out, slow settle
        const r = b.size;
        b.core.visible = u < 0.25;
        b.core.scale.setScalar(r * 0.35 * (0.4 + u * 4));
        mat(b.core).opacity = 1 - u * 4;
        b.fire.scale.setScalar(r * 0.55 * (0.3 + out));
        b.fire.position.y = b.ring.position.y + 1 + u * 1.2; // the fireball rises
        mat(b.fire).opacity = Math.max(0, 1 - u * 1.4);
        b.smoke.scale.setScalar(r * 0.7 * (0.2 + out));
        b.smoke.position.y = b.ring.position.y + 1 + u * 2.4;
        mat(b.smoke).opacity = 0.55 * Math.sin(u * Math.PI);
        b.ring.scale.setScalar(r * 1.4 * out);
        mat(b.ring).opacity = 1 - u;
      }
    },
    dispose() {
      for (const f of flashes) {
        scene.remove(f.m);
        mat(f.m).dispose();
      }
      for (const b of booms) {
        for (const m of [b.core, b.fire, b.smoke, b.ring]) {
          scene.remove(m);
          mat(m).dispose();
        }
      }
      sphere.dispose();
      ringGeo.dispose();
    },
  };
}
