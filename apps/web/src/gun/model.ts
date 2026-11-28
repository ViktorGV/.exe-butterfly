// The gun a racer holds while they have shots, one model per kind: a chunky toy blaster (rounded barrel, body, grip, trigger guard,
// sight, a glowing yellow muzzle and a stripe), sized to the racer. Geometry and materials are built once and
// shared; each holder gets its own small group.
import * as THREE from 'three';
import type { GunKind } from '@wobble/shared/types';

interface Parts {
  box: THREE.BoxGeometry;
  barrel: THREE.CylinderGeometry;
  ring: THREE.TorusGeometry;
  dark: THREE.Material;
  body: THREE.Material;
  accent: THREE.Material;
  glow: THREE.Material;
  wood: THREE.Material;
  green: THREE.Material;
  red: THREE.Material;
  cone: THREE.ConeGeometry;
}
let shared: Parts | null = null;

function parts(): Parts {
  shared ??= {
    box: new THREE.BoxGeometry(1, 1, 1),
    // along Y; rotated to point down the barrel
    barrel: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    ring: new THREE.TorusGeometry(0.5, 0.16, 8, 20),
    dark: new THREE.MeshStandardMaterial({ color: 0x23242f, roughness: 0.45, metalness: 0.5 }),
    body: new THREE.MeshStandardMaterial({ color: 0x5a3fd6, roughness: 0.35, metalness: 0.15 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.35 }),
    glow: new THREE.MeshStandardMaterial({ color: 0xffe14d, emissive: 0xffb400, emissiveIntensity: 1.4 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.6 }),
    green: new THREE.MeshStandardMaterial({ color: 0x3fae5a, roughness: 0.4, metalness: 0.1 }),
    red: new THREE.MeshStandardMaterial({ color: 0xff4040, roughness: 0.35 }),
    cone: new THREE.ConeGeometry(0.5, 1, 14),
  };
  return shared;
}

type V3 = [number, number, number];

function part(geo: THREE.BufferGeometry, mat: THREE.Material, scale: V3, pos: V3) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(...scale);
  m.position.set(...pos);
  m.castShadow = true;
  return m;
}

/**
 * A gun about `size` long, barrel along -Z (the way the racer faces), the grip at the origin so the origin can
 * sit in the hand.
 */
export function createGunModel(size: number, kind: GunKind = 'blaster'): THREE.Group {
  if (kind === 'shotgun') return createShotgun(size);
  if (kind === 'rocket') return createRocketLauncher(size);
  const p = parts();
  const s = size;
  const g = new THREE.Group();
  g.name = 'gun';
  // body above the hand, a little longer behind than the grip
  const body = part(p.box, p.body, [s * 0.24, s * 0.26, s * 0.5], [0, s * 0.17, -s * 0.12]);
  // rounded barrel out the front, a yellow ring and a glowing muzzle
  const barrel = part(p.barrel, p.dark, [s * 0.16, s * 0.48, s * 0.16], [0, s * 0.2, -s * 0.58]);
  barrel.rotation.x = Math.PI / 2;
  const ring = part(p.ring, p.accent, [s * 0.22, s * 0.22, s * 0.22], [0, s * 0.2, -s * 0.5]);
  const muzzle = part(p.barrel, p.glow, [s * 0.18, s * 0.06, s * 0.18], [0, s * 0.2, -s * 0.83]);
  muzzle.rotation.x = Math.PI / 2;
  // stripe along the side and a sight on top
  const stripe = part(p.box, p.accent, [s * 0.25, s * 0.05, s * 0.36], [0, s * 0.2, -s * 0.12]);
  const sight = part(p.box, p.dark, [s * 0.06, s * 0.08, s * 0.1], [0, s * 0.33, -s * 0.3]);
  // grip angled back, with a trigger guard in front of it
  const grip = part(p.box, p.dark, [s * 0.18, s * 0.36, s * 0.2], [0, -s * 0.06, s * 0.04]);
  grip.rotation.x = 0.3;
  const guard = part(p.ring, p.dark, [s * 0.14, s * 0.14, s * 0.14], [0, s * 0.02, -s * 0.15]);
  guard.rotation.y = Math.PI / 2;
  g.add(body, barrel, ring, muzzle, stripe, sight, grip, guard);
  return g;
}

/** Toy shotgun: two fat orange barrels over a wooden stock, short and wide. */
function createShotgun(s: number): THREE.Group {
  const p = parts();
  const g = new THREE.Group();
  g.name = 'gun:shotgun';
  const body = part(p.box, p.wood, [s * 0.26, s * 0.24, s * 0.46], [0, s * 0.15, -s * 0.05]);
  const grip = part(p.box, p.dark, [s * 0.18, s * 0.34, s * 0.2], [0, -s * 0.06, s * 0.06]);
  grip.rotation.x = 0.3;
  g.add(body, grip);
  for (const x of [-0.07, 0.07]) {
    const barrel = part(p.barrel, p.dark, [s * 0.14, s * 0.62, s * 0.14], [x * s, s * 0.22, -s * 0.56]);
    barrel.rotation.x = Math.PI / 2;
    const muzzle = part(p.barrel, p.glow, [s * 0.15, s * 0.05, s * 0.15], [x * s, s * 0.22, -s * 0.88]);
    muzzle.rotation.x = Math.PI / 2;
    g.add(barrel, muzzle);
  }
  const pump = part(p.box, p.accent, [s * 0.3, s * 0.12, s * 0.18], [0, s * 0.12, -s * 0.45]);
  g.add(pump);
  return g;
}

/** Toy rocket launcher: a long green tube resting on the arm, a red rocket tip poking out the front. */
function createRocketLauncher(s: number): THREE.Group {
  const p = parts();
  const g = new THREE.Group();
  g.name = 'gun:rocket';
  const tube = part(p.barrel, p.green, [s * 0.34, s * 1.3, s * 0.34], [0, s * 0.32, -s * 0.25]);
  tube.rotation.x = Math.PI / 2;
  const rimF = part(p.ring, p.accent, [s * 0.36, s * 0.36, s * 0.36], [0, s * 0.32, -s * 0.9]);
  const rimB = part(p.ring, p.dark, [s * 0.36, s * 0.36, s * 0.36], [0, s * 0.32, s * 0.4]);
  const tip = part(p.cone, p.red, [s * 0.26, s * 0.3, s * 0.26], [0, s * 0.32, -s * 1.02]);
  tip.rotation.x = -Math.PI / 2;
  const grip = part(p.box, p.dark, [s * 0.16, s * 0.32, s * 0.18], [0, s * 0.02, 0]);
  const sight = part(p.box, p.accent, [s * 0.08, s * 0.16, s * 0.14], [s * 0.2, s * 0.42, -s * 0.4]);
  g.add(tube, rimF, rimB, tip, grip, sight);
  return g;
}
