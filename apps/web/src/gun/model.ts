// The gun a racer holds while they have shots: a chunky toy blaster (rounded barrel, body, grip, trigger guard,
// sight, a glowing yellow muzzle and a stripe), sized to the racer. Geometry and materials are built once and
// shared; each holder gets its own small group.
import * as THREE from 'three';

interface Parts {
  box: THREE.BoxGeometry;
  barrel: THREE.CylinderGeometry;
  ring: THREE.TorusGeometry;
  dark: THREE.Material;
  body: THREE.Material;
  accent: THREE.Material;
  glow: THREE.Material;
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
export function createGunModel(size: number): THREE.Group {
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
