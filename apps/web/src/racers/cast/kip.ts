// Kip Starwaddle: a round little penguin space explorer. Navy feathers with a white belly and face patches, an
// orange beak, a clear bubble helmet on a silver-and-orange collar ring, orange harness straps with a glowing
// control panel, a white twin-tank jetpack with little glowing flames, chunky white space gloves and white space
// boots on orange soles. White, rocket orange and navy.
import * as THREE from 'three';
import { arm, boot, glove, stud, type Builder } from '../kit.ts';
import { capsule, cut, ellipsoid, flatZ, placed, roundBox, rotX, sphere, torus, type P3 } from '../sdf.ts';
import type { RacerDef } from '../types.ts';

const HEAD: P3 = [0, 0.9, 0];

export const kip: RacerDef = {
  id: 'kip',
  name: 'Kip Starwaddle',
  roll: { archetype: 'Cute animal (penguin)', theme: 'Space explorer', palette: 'White, rocket orange & navy' },
  rig: { hips: 0.3, spine: 0.45, neck: 0.7, hip: [0.085, 0.28] },
  mats: {
    navy: { color: 0x1f2a4d, rough: 0.5, clear: 0.4 },
    belly: { color: 0xf6f7fb, rough: 0.5, clear: 0.25 },
    beak: { color: 0xff9a2e, rough: 0.32, clear: 0.7 },
    suit: { color: 0xf3f5fa, rough: 0.68 },
    orange: { color: 0xff7a1f, rough: 0.55, clear: 0.3 },
    silver: { color: 0xd8dde8, rough: 0.2, metal: 1 },
    panel: { color: 0x2a3352, rough: 0.2, clear: 1 },
    cyan: { color: 0x69e8ff, rough: 0.3, glow: 1.3 },
    red: { color: 0xff4f5e, rough: 0.3, glow: 1.2 },
    yellow: { color: 0xffd84a, rough: 0.3, glow: 1.1 },
    flame: { color: 0xff8a2a, rough: 0.4, glow: 1.6 },
    sole: { color: 0xff7a1f, rough: 0.6 },
    blush: { color: 0x9fb2e8, rough: 0.5 },
  },
  sculpt(b: Builder) {
    // Short navy legs on white space boots with orange soles and orange straps.
    for (const s of [-1, 1]) {
      b.bone('thigh', s);
      b.add(capsule([s * 0.085, 0.28, 0], [s * 0.1, 0.14, 0], 0.07, 0.064), 'navy', 0.03);
      boot(b, s * 0.104, { w: 0.088, h: 0.14, l: 0.115 }, 'suit', 'sole');
      b.add(torus([s * 0.104, 0.15, 0], 0.08, 0.016), 'orange', 0.008);
    }

    // Round penguin body: navy back, white belly.
    b.bone('spine');
    b.add(ellipsoid([0, 0.48, 0], [0.25, 0.3, 0.23]), 'navy', 0.05);
    b.add(ellipsoid([0, 0.45, -0.075], [0.195, 0.255, 0.17]), 'belly', 0.03);
    // Little tail feathers at the back.
    b.bone('hips');
    b.add(placed(flatZ(ellipsoid([0, 0, 0], [0.09, 0.03, 0.08]), 0, 1), [0, 0.22, 0.2], rotX(0.5)), 'navy', 0.02);

    // Orange harness: a belt and two shoulder straps, with a glowing control panel on the chest.
    b.add(flatZ(torus([0, 0.3, 0], 0.235, 0.024), 0, 0.92), 'orange', 0.008);
    b.bone('spine');
    for (const s of [-1, 1]) {
      const top = b.front(s * 0.1, 0.66);
      const bottom = b.front(s * 0.12, 0.33);
      b.add(
        capsule([top[0], top[1], top[2] - 0.006], [bottom[0], bottom[1], bottom[2] - 0.006], 0.02),
        'orange',
        0.008,
      );
    }
    const pz = b.front(0, 0.5)[2];
    b.add(roundBox([0, 0.5, pz - 0.01], [0.085, 0.06, 0.025], 0.018), 'panel', 0.01);
    const pf = b.front(0, 0.5)[2];
    for (const [x, y, mat] of [
      [-0.045, 0.515, 'cyan'],
      [0, 0.515, 'red'],
      [0.045, 0.515, 'yellow'],
    ] as [number, number, string][])
      b.add(sphere([x, y, pf + 0.004], 0.016), mat, 0.003);
    b.add(roundBox([0, 0.475, pf - 0.002], [0.06, 0.008, 0.006], 0.004), 'cyan', 0.002);

    // Twin-tank jetpack with silver nozzles and little glowing flames.
    for (const s of [-1, 1]) {
      const back = b.hit([s * 0.08, 0.5, 0.8], [0, 0, -1]);
      const zc = back[2] + 0.05;
      b.add(capsule([s * 0.08, 0.38, zc], [s * 0.08, 0.6, zc], 0.065), 'suit', 0.02);
      b.add(sphere([s * 0.08, 0.63, zc], 0.05), 'orange', 0.02);
      b.add(capsule([s * 0.08, 0.36, zc], [s * 0.08, 0.32, zc], 0.04, 0.05), 'silver', 0.006);
      b.add(capsule([s * 0.08, 0.3, zc], [s * 0.08, 0.22, zc], 0.032, 0.005), 'flame', 0.004);
    }

    // Navy flipper-arms with chunky white space gloves and orange cuffs.
    for (const s of [-1, 1]) {
      const wrist = arm(b, s, [s * 0.21, 0.58, 0], [0.12, 0.11], 0.82, [0.058, 0.05, 0.044], 'navy');
      glove(b, s, wrist, 0.82, 0.07, 'suit', 'orange');
    }

    // Head: navy with white face patches, an orange beak and soft blue cheeks.
    b.bone('head');
    b.add(capsule([0, 0.66, 0.0], [0, 0.76, 0.0], 0.1), 'navy', 0.03);
    b.add(sphere(HEAD, 0.2), 'navy', 0.05);
    for (const s of [-1, 1]) b.add(ellipsoid([s * 0.072, 0.895, -0.115], [0.085, 0.1, 0.07]), 'belly', 0.04);
    b.add(ellipsoid([0, 0.82, -0.12], [0.11, 0.07, 0.08]), 'belly', 0.04);
    b.add(capsule([0, 0.845, -0.17], [0, 0.835, -0.27], 0.042, 0.016), 'beak', 0.02);
    b.add(capsule([0, 0.82, -0.17], [0, 0.812, -0.235], 0.03, 0.012), 'beak', 0.015);
    for (const s of [-1, 1]) stud(b, b.front(s * 0.115, 0.83), 0.022, 'blush', 0.02);

    // Helmet collar ring (the bubble itself is a clear extra mesh, below).
    b.add(torus([0, 0.69, 0], 0.17, 0.036), 'silver', 0.01);
    b.add(torus([0, 0.72, 0], 0.165, 0.018), 'orange', 0.006);
    b.add(cut(sphere([0, 1.14, 0.04], 0.03), [0, 1.0, 0], [0, 1, 0]), 'red', 0.004);

    b.extra((group) => {
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(0.27, 48, 32),
        new THREE.MeshPhysicalMaterial({
          color: 0xe4f6ff,
          transparent: true,
          opacity: 0.16,
          roughness: 0.04,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
          depthWrite: false,
        }),
      );
      bubble.position.set(HEAD[0], HEAD[1] + 0.02, HEAD[2]);
      bubble.renderOrder = 2;
      group.add(bubble);
      const antenna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8),
        new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: 0.2 }),
      );
      antenna.position.set(0.12, HEAD[1] + 0.3, 0.06);
      antenna.rotation.z = -0.35;
      group.add(antenna);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xff4f5e }),
      );
      tip.position.set(0.142, HEAD[1] + 0.355, 0.06);
      group.add(tip);
    });

    b.eyes({ x: 0.072, y: 0.905, w: 0.055, h: 0.07, iris: 0x2a6fd6 });
  },
};
