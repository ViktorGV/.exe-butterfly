// Spinny Glitterbolt: a cheerful disco-dancer robot with a glowing screen face, a mirror-ball antenna, ribbed
// noodle arms, bell-bottom legs, light-up platform boots and heart sunglasses pushed up. Pastel neon.
import * as THREE from 'three';
import { arm, armDir, glove, ring, stud, type Builder } from '../kit.ts';
import {
  alignY,
  capsule,
  cut,
  ellipsoid,
  flatZ,
  inter,
  mul,
  placed,
  roundBox,
  rotX,
  rotZ,
  sphere,
  torus,
  type P3,
} from '../sdf.ts';
import type { RacerDef } from '../types.ts';

export const spinny: RacerDef = {
  id: 'spinny',
  name: 'Spinny Glitterbolt',
  roll: { archetype: 'Whimsical robot', theme: 'Disco dancer', palette: 'Pastel neon' },
  rig: { hips: 0.36, spine: 0.47, neck: 0.74, hip: [0.09, 0.36] },
  mats: {
    lavender: { color: 0xc9b5ff, rough: 0.18, clear: 1 },
    lavDark: { color: 0xa48ff0, rough: 0.22, clear: 1 },
    pink: { color: 0xffaad8, rough: 0.26, clear: 0.9 },
    hotPink: { color: 0xff62b0, rough: 0.08, clear: 1 },
    mint: { color: 0x9df7da, rough: 0.24, clear: 0.9 },
    yellow: { color: 0xfff09a, rough: 0.16, metal: 0.5, clear: 0.8 },
    screen: { color: 0x82f0ff, rough: 0.1, clear: 1, glow: 0.75 },
    ink: { color: 0x1b2447, rough: 0.2, clear: 1 },
    silver: { color: 0xe2e6f0, rough: 0.2, metal: 1 },
    white: { color: 0xffffff, rough: 0.3, clear: 0.7 },
    neonMint: { color: 0x74ffd2, rough: 0.3, glow: 1.4 },
    eqPink: { color: 0xff8fd0, rough: 0.3, glow: 1.3 },
    eqCyan: { color: 0x7cf2ff, rough: 0.3, glow: 1.3 },
    eqYellow: { color: 0xfff07a, rough: 0.3, glow: 1.1 },
  },
  sculpt(b: Builder) {
    // Bell-bottom leg casings with mint stripes, on light-up platform boots.
    for (const s of [-1, 1]) {
      b.bone('thigh', s);
      b.add(capsule([s * 0.09, 0.36, 0], [s * 0.115, 0.15, 0], 0.05, 0.088), 'lavender', 0.02);
      b.add(torus([s * 0.113, 0.2, 0], 0.077, 0.012), 'mint', 0.006);
      b.add(torus([s * 0.11, 0.255, 0], 0.067, 0.011), 'mint', 0.006);
      b.bone('foot', s);
      b.joint('foot', s, [s * 0.115, 0.15, 0]);
      b.add(roundBox([s * 0.115, 0.105, -0.03], [0.082, 0.055, 0.115], 0.045), 'mint', 0.02);
      b.add(roundBox([s * 0.115, 0.03, -0.03], [0.088, 0.03, 0.12], 0.02), 'neonMint', 0.004);
    }

    // Capsule body, hips, and a silver neck.
    b.bone('hips');
    b.add(ellipsoid([0, 0.36, 0], [0.17, 0.07, 0.13]), 'lavDark', 0.03);
    b.bone('spine');
    b.add(flatZ(capsule([0, 0.42, 0], [0, 0.56, 0], 0.2, 0.21), 0, 0.88), 'lavender', 0.03);
    b.add(capsule([0, 0.74, 0], [0, 0.8, 0], 0.05), 'silver', 0.01);
    b.add(torus([0, 0.765, 0], 0.07, 0.02), 'silver', 0.004);

    // Glittery chest panel with a glowing equaliser.
    const pz = b.front(0, 0.5)[2];
    b.add(roundBox([0, 0.5, pz + 0.002], [0.12, 0.09, 0.03], 0.025), 'yellow', 0.015);
    const pf = b.front(0, 0.47)[2];
    const bars = [0.05, 0.09, 0.12, 0.07, 0.045];
    const barMats = ['eqPink', 'eqCyan', 'eqYellow', 'eqCyan', 'eqPink'];
    bars.forEach((h, i) => {
      const x = -0.08 + i * 0.04;
      b.add(roundBox([x, 0.43 + h / 2, pf - 0.004], [0.014, h / 2, 0.008], 0.006), barMats[i], 0.003);
    });

    // Wide pink disco collar.
    for (const s of [-1, 1]) {
      const p = b.front(s * 0.075, 0.725);
      const n = b.normal(p);
      const m = mul(alignY(n), rotZ(0));
      b.add(
        placed(ellipsoid([0, 0, 0], [0.085, 0.012, 0.05]), [p[0] + s * 0.02, p[1] - 0.01, p[2] - 0.006], m),
        'pink',
        0.008,
      );
    }

    // Ribbed noodle arms from ball shoulders, big white gloves.
    for (const s of [-1, 1]) {
      const sh: P3 = [s * 0.235, 0.61, 0];
      b.add(sphere([s * 0.215, 0.615, 0], 0.058), 'lavDark', 0.015);
      const wrist = arm(b, s, sh, [0.12, 0.12], 0.82, [0.032, 0.032, 0.03], 'pink');
      const d = armDir(s, 0.82);
      for (let t = 0.035; t < 0.235; t += 0.034) {
        const p: P3 = [sh[0] + d[0] * t, sh[1] + d[1] * t, sh[2] - 0.012 * Math.min(1, t / 0.12)];
        b.bone(t < 0.12 ? 'upperArm' : 'foreArm', s);
        b.add(ring(p, d, 0.033, 0.009), 'pink', 0.006);
      }
      b.bone('foreArm', s);
      b.add(sphere([sh[0] + d[0] * 0.12, sh[1] + d[1] * 0.12, -0.012], 0.04), 'lavDark', 0.01);
      glove(b, s, wrist, 0.82, 0.076, 'white', 'white');
      b.bone('spine');
    }

    // Dome head with a glowing screen face.
    b.bone('head');
    b.add(ellipsoid([0, 0.98, 0], [0.25, 0.23, 0.235]), 'lavender', 0.006);
    b.add(
      inter(ellipsoid([0, 0.98, 0], [0.259, 0.239, 0.244]), roundBox([0, 0.96, -0.2], [0.178, 0.132, 0.1], 0.06)),
      'screen',
      0.004,
    );
    const mz = b.front(0, 0.91)[2];
    b.add(cut(ring([0, 0.925, mz - 0.002], [0, 0, 1], 0.045, 0.011), [0, 0.925, 0], [0, -1, 0]), 'ink', 0.003);
    for (const s of [-1, 1]) stud(b, b.front(s * 0.135, 0.925), 0.02, 'eqPink');

    // Mirror-ball antenna.
    b.add(sphere([0, 1.2, 0], 0.032), 'silver', 0.01);
    b.add(capsule([0, 1.2, 0], [0, 1.3, 0], 0.011), 'silver', 0.006);
    b.extra((group) => {
      const ball = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.062, 2),
        new THREE.MeshStandardMaterial({ color: 0xf4f0ff, metalness: 1, roughness: 0.06, flatShading: true }),
      );
      ball.position.set(0, 1.355, 0);
      group.add(ball);
    });

    // Heart sunglasses pushed up onto the dome.
    const tilt = rotX(0.75);
    for (const s of [-1, 1]) {
      const p = b.front(s * 0.088, 1.13);
      const c: P3 = [p[0], p[1] + 0.006, p[2] - 0.008];
      b.add(placed(ellipsoid([-0.027, 0.016, 0], [0.036, 0.036, 0.013]), c, tilt), 'hotPink', 0.006);
      b.add(placed(ellipsoid([0.027, 0.016, 0], [0.036, 0.036, 0.013]), c, tilt), 'hotPink', 0.006);
      b.add(
        placed(placed(roundBox([0, 0, 0], [0.035, 0.035, 0.013], 0.01), [0, -0.012, 0], rotZ(Math.PI / 4)), c, tilt),
        'hotPink',
        0.006,
      );
      b.add(capsule([s * 0.14, 1.14, p[2] + 0.02], [s * 0.215, 1.1, 0.05], 0.007), 'hotPink', 0.004);
    }
    const bl = b.front(-0.03, 1.15);
    const br = b.front(0.03, 1.15);
    b.add(capsule([bl[0], bl[1], bl[2] - 0.004], [br[0], br[1], br[2] - 0.004], 0.007), 'hotPink', 0.004);

    b.eyes({ x: 0.075, y: 0.99, w: 0.05, h: 0.068, iris: 0, style: 'screen', pupil: 0x1b2447 });
  },
};
