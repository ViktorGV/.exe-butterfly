// Atom bomb: flash, fireball, stem, mushroom cap and shock ring. Built once; play() reuses every mesh.
//
//   const nuke = createNuke({ scene });
//   nuke.play([x, y, z], performance.now());
//   engine.onRender(() => nuke.update(performance.now()));   // returns the flash strength 0..1
import * as THREE from 'three';
import type { Vec3 } from '@wobble/shared/types';

/** Whole animation, ms. */
export const NUKE_ANIM_MS = 9000;
/** Size of the cloud, metres (cap radius at full spread). */
const SCALE = 60;
const PUFFS = 28;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (v: number) => 1 - (1 - v) * (1 - v) * (1 - v);

export function createNuke({ scene }: { scene: THREE.Object3D }) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  const fireMat = new THREE.MeshBasicMaterial({
    color: 0xffd36b,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const smokeMat = new THREE.MeshBasicMaterial({
    color: 0xff7a2b,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xfff1c4,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const sphere = new THREE.SphereGeometry(1, 20, 14);

  const fireball = new THREE.Mesh(sphere, fireMat);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1, 1, 18, 1, true), smokeMat);
  const cap = new THREE.Mesh(sphere, smokeMat);
  const capRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.38, 12, 28), smokeMat);
  capRing.rotation.x = Math.PI / 2;
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), ringMat);
  shock.rotation.x = -Math.PI / 2;
  const light = new THREE.PointLight(0xffc070, 0, 0, 1.2);
  root.add(fireball, stem, cap, capRing, shock, light);

  // billowing puffs around the cap, fixed random spots
  const puffs: { mesh: THREE.Mesh; a: number; r: number; h: number; s: number }[] = [];
  for (let i = 0; i < PUFFS; i++) {
    const mesh = new THREE.Mesh(sphere, i % 3 === 0 ? fireMat : smokeMat);
    root.add(mesh);
    puffs.push({
      mesh,
      a: (i / PUFFS) * Math.PI * 2,
      r: 0.6 + Math.random() * 0.5,
      h: Math.random() * 0.5,
      s: 0.25 + Math.random() * 0.2,
    });
  }
  for (const o of root.children) o.frustumCulled = false;

  let start = -Infinity;

  return {
    /** Detonates at ground point `at` (its feet). */
    play(at: Readonly<Vec3>, nowMs: number) {
      root.position.set(at[0], at[1], at[2]);
      start = nowMs;
      root.visible = true;
    },
    get playing() {
      return root.visible;
    },
    /** Moves the animation; returns the white flash strength (0..1) for a screen overlay. */
    update(nowMs: number): number {
      if (!root.visible) return 0;
      const ms = nowMs - start;
      if (ms >= NUKE_ANIM_MS) {
        root.visible = false;
        light.intensity = 0;
        return 0;
      }
      const t = ms / NUKE_ANIM_MS;
      const rise = easeOut(clamp01(t / 0.45)); // the cloud climbs for the first 45%
      const fade = 1 - clamp01((t - 0.65) / 0.35); // and fades over the last 35%
      const top = SCALE * 1.6 * rise;

      // fireball: swells at ground zero, then rides up into the cap
      const fb = SCALE * (0.15 + 0.35 * easeOut(clamp01(t / 0.12)));
      fireball.scale.setScalar(fb * (1 - 0.4 * rise));
      fireball.position.y = top * 0.9;
      fireMat.color.setRGB(1, 0.95 - 0.45 * rise, 0.7 - 0.6 * rise);
      fireMat.opacity = fade;

      stem.scale.set(SCALE * 0.18, Math.max(0.01, top), SCALE * 0.18);
      stem.position.y = top / 2;

      const spread = SCALE * (0.35 + 0.65 * easeOut(clamp01(t / 0.6)));
      cap.scale.set(spread, spread * 0.55, spread);
      cap.position.y = top;
      capRing.scale.setScalar(spread * 0.95);
      capRing.position.y = top - spread * 0.2;
      smokeMat.color.setRGB(0.95 - 0.45 * t, 0.38 - 0.1 * t, 0.12 + 0.2 * t);
      smokeMat.opacity = 0.92 * fade;

      for (const p of puffs) {
        const a = p.a + t * 0.8;
        p.mesh.position.set(Math.cos(a) * spread * p.r, top + spread * (p.h - 0.15), Math.sin(a) * spread * p.r);
        p.mesh.scale.setScalar(spread * p.s);
      }

      const sr = SCALE * 4 * easeOut(clamp01(t / 0.35));
      shock.scale.setScalar(Math.max(0.01, sr));
      shock.position.y = 0.3;
      ringMat.opacity = 1 - clamp01(t / 0.35);

      light.position.y = top;
      light.intensity = 4000 * (1 - clamp01(t / 0.5));
      // the flash: blinding at once, gone after about a second and a half
      return 1 - clamp01(ms / 1500);
    },
    dispose() {
      scene.remove(root);
      sphere.dispose();
      stem.geometry.dispose();
      capRing.geometry.dispose();
      shock.geometry.dispose();
      fireMat.dispose();
      smokeMat.dispose();
      ringMat.dispose();
    },
  };
}

export type Nuke = ReturnType<typeof createNuke>;

/** A full-screen white overlay for the flash. Set its strength each frame. */
export function createFlashOverlay(doc: Document = document) {
  const el = doc.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:50;opacity:0;background:radial-gradient(circle,#fff 0%,#fff6d8 55%,#ffd49a 100%)';
  doc.body.appendChild(el);
  let last = 0;
  return {
    set(strength: number) {
      if (strength === last) return;
      last = strength;
      el.style.opacity = String(strength);
    },
    dispose: () => el.remove(),
  };
}
