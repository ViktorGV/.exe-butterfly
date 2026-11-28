// Kappi Kurokawa: a calm, chubby capybara samurai in rounded purple lacquer armour with gold lacing, a gold
// hakama, a helmet with a crescent crest tilted back, and a yuzu balanced on the head. Royal purple and gold.
import { arm, boot, glove, ring, type Builder } from '../kit.ts';
import { capsule, cut, ellipsoid, flatZ, placed, roundBox, rotX, rotZ, sphere, torus, type P3 } from '../sdf.ts';
import type { RacerDef } from '../types.ts';

export const kappi: RacerDef = {
  id: 'kappi',
  name: 'Kappi Kurokawa',
  roll: { archetype: 'Cute animal (capybara)', theme: 'Samurai', palette: 'Royal purple & gold' },
  rig: { hips: 0.38, spine: 0.5, neck: 0.74, hip: [0.09, 0.4] },
  mats: {
    fur: { color: 0xc4874f, rough: 0.9 },
    muzzle: { color: 0xe7c49b, rough: 0.82 },
    nose: { color: 0xef8f98, rough: 0.38, clear: 0.6 },
    purple: { color: 0x5b2a92, rough: 0.2, clear: 1 },
    purpleCloth: { color: 0x3c1c6a, rough: 0.9 },
    gold: { color: 0xe9b53b, rough: 0.24, metal: 1 },
    goldCloth: { color: 0xf2bf4a, rough: 0.88 },
    yuzu: { color: 0xffbf26, rough: 0.5, clear: 0.4 },
    leaf: { color: 0x55b648, rough: 0.45, clear: 0.4 },
    mouth: { color: 0x4a2420, rough: 0.6 },
    sole: { color: 0x2c2232, rough: 0.85 },
  },
  sculpt(b: Builder) {
    // Wide gold hakama with purple pleats, over lacquered boots.
    for (const s of [-1, 1]) {
      b.bone('thigh', s);
      b.add(
        cut(capsule([s * 0.09, 0.42, 0], [s * 0.13, 0.17, 0], 0.1, 0.125), [0, 0.165, 0], [0, 1, 0]),
        'goldCloth',
        0.06,
      );
      boot(b, s * 0.125, { w: 0.084, h: 0.12, l: 0.11 }, 'purple', 'sole');
      for (const y of [0.1, 0.135]) b.add(capsule([s * 0.08, y, -0.13], [s * 0.17, y, -0.13], 0.008), 'gold', 0.004);
    }
    for (const x of [-0.17, -0.09, -0.02, 0.02, 0.09, 0.17]) {
      b.bone('thigh', Math.sign(x));
      const top = b.front(x, 0.37);
      const bottom = b.front(x * 1.18, 0.185);
      b.sub(capsule(top, bottom, 0.008), 'purple', 0.004);
    }

    // Barrel chest plate with rows of gold lacing, and a wide purple sash tied at the front.
    b.bone('spine');
    b.add(ellipsoid([0, 0.56, 0], [0.25, 0.2, 0.21]), 'purple', 0.05);
    for (const [y, R] of [
      [0.5, 0.236],
      [0.58, 0.247],
      [0.66, 0.218],
    ])
      b.add(flatZ(torus([0, y, 0], R, 0.009), 0, 0.84), 'gold', 0.004);
    b.bone('hips');
    b.add(flatZ(torus([0, 0.405, 0], 0.205, 0.046), 0, 0.88), 'purpleCloth', 0.02);
    const knot = b.front(0.09, 0.405);
    b.add(sphere([knot[0], knot[1], knot[2] - 0.01], 0.04), 'purpleCloth', 0.015);
    b.add(capsule([0.09, 0.39, knot[2] - 0.01], [0.115, 0.3, knot[2] - 0.005], 0.022, 0.016), 'purpleCloth', 0.01);
    b.add(capsule([0.08, 0.39, knot[2] - 0.01], [0.06, 0.31, knot[2]], 0.02, 0.015), 'purpleCloth', 0.01);

    // Shoulder plates trimmed in gold, cloth sleeves, purple gauntlets with gold cuffs.
    for (const s of [-1, 1]) {
      const at: P3 = [s * 0.275, 0.62, 0];
      const m = rotZ(s * 0.55);
      b.bone('upperArm', s);
      b.add(placed(roundBox([0, 0, 0], [0.016, 0.075, 0.105], 0.014), at, m), 'purple', 0.01);
      b.add(placed(capsule([s * 0.004, -0.075, -0.1], [s * 0.004, -0.075, 0.1], 0.016), at, m), 'gold', 0.004);
      const wrist = arm(b, s, [s * 0.22, 0.64, 0], [0.12, 0.11], 0.8, [0.058, 0.052, 0.05], 'purpleCloth', 'purple');
      glove(b, s, wrist, 0.8, 0.064, 'purple', 'gold');
    }

    // Big, boxy capybara head with a blunt muzzle.
    b.bone('head');
    b.add(ellipsoid([0, 0.96, 0.02], [0.215, 0.19, 0.22]), 'fur', 0.06);
    b.add(roundBox([0, 0.885, -0.15], [0.16, 0.12, 0.125], 0.1), 'muzzle', 0.08);
    const nose = b.front(0, 0.95);
    b.add(ellipsoid([0, 0.95, nose[2] + 0.008], [0.055, 0.028, 0.024]), 'nose', 0.012);
    const mouth = b.front(0, 0.87);
    b.sub(cut(ring([0, 0.887, mouth[2] + 0.002], [0, 0, 1], 0.04, 0.0065), [0, 0.887, 0], [0, -1, 0]), 'mouth', 0.003);
    b.sub(capsule(b.front(0, 0.925), b.front(0, 0.89), 0.004), 'mouth', 0.002);
    for (const s of [-1, 1]) b.add(ellipsoid([s * 0.16, 1.12, 0.07], [0.048, 0.036, 0.03]), 'fur', 0.03);

    // A yuzu balanced on top, with a little leaf.
    b.add(sphere([0, 1.16, -0.09], 0.056), 'yuzu', 0.015);
    b.add(capsule([0, 1.21, -0.09], [0.004, 1.233, -0.09], 0.006), 'leaf', 0.004);
    b.add(placed(ellipsoid([0, 0, 0], [0.036, 0.006, 0.016]), [0.03, 1.226, -0.09], rotZ(-0.45)), 'leaf', 0.004);

    // Lacquered helmet tilted back, with a gold brim and a gold crescent crest.
    const hc: P3 = [0, 1.03, 0.13];
    const hm = rotX(1.0);
    b.add(placed(cut(ellipsoid([0, 0, 0], [0.2, 0.15, 0.18]), [0, -0.02, 0], [0, 1, 0]), hc, hm), 'purple', 0.02);
    b.add(placed(flatZ(torus([0, -0.02, 0], 0.19, 0.02), 0, 0.9), hc, hm), 'gold', 0.008);
    const crest = cut(
      placed(torus([0, 0, 0], 0.075, 0.012), [0, 0.245, -0.06], rotX(Math.PI / 2)),
      [0, 0.245, 0],
      [0, -1, 0],
    );
    b.add(placed(crest, hc, hm), 'gold', 0.004);
    b.add(placed(sphere([0, 0.16, -0.06], 0.025), hc, hm), 'gold', 0.01);

    // Toy katana through the sash on the left hip.
    const guard: P3 = [-0.215, 0.43, -0.085];
    const tip: P3 = [-0.3, 0.24, 0.22];
    b.bone('hips');
    b.add(capsule([-0.2, 0.445, -0.2], guard, 0.02), 'goldCloth', 0.004);
    b.add(sphere([-0.2, 0.445, -0.205], 0.024), 'gold', 0.004);
    b.add(ring(guard, [guard[0] - tip[0], guard[1] - tip[1], guard[2] - tip[2]], 0.034, 0.009), 'gold', 0.003);
    b.add(capsule(guard, tip, 0.022, 0.017), 'purpleCloth', 0.004);

    b.bone('head');
    b.eyes({ x: 0.112, y: 1.025, w: 0.055, h: 0.066, iris: 0x3a2214, style: 'sleepy', lid: 0xc4874f });
  },
};
