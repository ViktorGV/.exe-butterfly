// Grizzle Fuzzbang: a scruffy little punk-rocker monster with shaggy mint fur, coral horns, a spiky coral-pink
// mohawk, one snaggle tooth, a cropped studded coral jacket over a ripped tee, plaid shorts, a studded belt and
// mint high-tops. Mint and coral with silver.
import { arm, boot, glove, ring, stud, type Builder } from '../kit.ts';
import {
  alignY,
  capsule,
  cut,
  ellipsoid,
  flatZ,
  fuzz,
  flatX,
  minus,
  placed,
  roundBox,
  rotZ,
  sphere,
  torus,
  type P3,
} from '../sdf.ts';
import type { RacerDef } from '../types.ts';

/** Coral and mint tartan with darker crossings and thin cream lines. */
function plaid(x: number, y: number, z: number): number {
  const u = Math.sin(x * 85 + z * 40) > 0.45;
  const v = Math.sin(y * 85) > 0.45;
  if (Math.sin(x * 85 + z * 40 + 2.2) > 0.96 || Math.sin(y * 85 + 2.2) > 0.96) return 0xfff0dc;
  if (u && v) return 0xc8463f;
  if (u || v) return 0xf26b5c;
  return 0x8fe2c0;
}

export const grizzle: RacerDef = {
  id: 'grizzle',
  name: 'Grizzle Fuzzbang',
  roll: { archetype: 'Friendly monster', theme: 'Punk rocker', palette: 'Mint & coral' },
  rig: { hips: 0.32, spine: 0.45, neck: 0.64, hip: [0.085, 0.3] },
  mats: {
    fur: { color: 0x7fe0b6, rough: 0.92 },
    horn: { color: 0xff6f5e, rough: 0.36, clear: 0.7 },
    mohawk: { color: 0xff5c80, rough: 0.85 },
    jacket: { color: 0xf0645a, rough: 0.4, clear: 0.6 },
    silver: { color: 0xdadfe8, rough: 0.2, metal: 1 },
    tee: { color: 0xc8f7e2, rough: 0.9 },
    plaid: { color: plaid, rough: 0.88 },
    belt: { color: 0x2c2b33, rough: 0.45, clear: 0.5 },
    offwhite: { color: 0xfff4e4, rough: 0.5, clear: 0.3 },
    boot: { color: 0x6dd8b0, rough: 0.42, clear: 0.6 },
    lace: { color: 0xff6f5e, rough: 0.6 },
    sole: { color: 0xf3efe6, rough: 0.7 },
    mouth: { color: 0x3e1420, rough: 0.6 },
    tooth: { color: 0xfffbf2, rough: 0.22, clear: 0.7 },
    tongue: { color: 0xff7f95, rough: 0.4, clear: 0.5 },
  },
  sculpt(b: Builder) {
    // Mint high-tops with coral laces and white toe caps.
    for (const s of [-1, 1]) {
      boot(b, s * 0.1, { w: 0.078, h: 0.2, l: 0.11 }, 'boot', 'sole');
      b.add(ellipsoid([s * 0.1, 0.062, -0.14], [0.07, 0.046, 0.05]), 'sole', 0.01);
      for (const y of [0.11, 0.15, 0.19]) {
        const p = b.front(s * 0.1, y);
        b.add(capsule([p[0] - 0.026, y, p[2] - 0.004], [p[0] + 0.026, y + 0.006, p[2] - 0.004], 0.007), 'lace', 0.003);
      }
      b.bone('thigh', s);
      b.add(fuzz(capsule([s * 0.085, 0.3, 0], [s * 0.1, 0.2, 0], 0.062), 0.004, 75), 'fur', 0.03);
    }

    // Plaid shorts, a studded belt and a tiny guitar keychain.
    b.bone('hips');
    b.add(ellipsoid([0, 0.31, 0], [0.2, 0.1, 0.17]), 'plaid', 0.03);
    for (const s of [-1, 1]) {
      b.bone('thigh', s);
      b.add(capsule([s * 0.09, 0.3, 0], [s * 0.1, 0.235, 0], 0.088, 0.083), 'plaid', 0.02);
    }

    // Round body in a ripped tee (fur shows through the rips).
    b.bone('spine');
    b.add(ellipsoid([0, 0.46, 0], [0.22, 0.2, 0.19]), 'tee', 0.04);
    for (const [x, y] of [
      [0.04, 0.44],
      [-0.025, 0.4],
      [0.01, 0.5],
    ]) {
      const p = b.front(x, y);
      b.sub(ellipsoid([p[0], p[1], p[2]], [0.017, 0.011, 0.02]), 'fur', 0.004);
    }
    b.bone('hips');
    b.add(flatZ(torus([0, 0.375, 0], 0.2, 0.022), 0, 0.85), 'belt', 0.006);
    for (let i = -3; i <= 3; i++) stud(b, b.front(i * 0.05, 0.375), 0.011, 'silver');
    b.add(capsule([0.17, 0.37, -0.1], [0.17, 0.335, -0.125], 0.004), 'silver', 0.002);
    b.add(ellipsoid([0.17, 0.29, -0.125], [0.022, 0.026, 0.008]), 'offwhite', 0.006);
    b.add(ellipsoid([0.17, 0.315, -0.125], [0.017, 0.018, 0.008]), 'offwhite', 0.006);
    b.add(capsule([0.17, 0.32, -0.126], [0.17, 0.335, -0.126], 0.005), 'horn', 0.002);

    // Cropped coral faux-leather jacket, open at the front, with lapels, studs and a lightning-bolt patch.
    const jacket = minus(
      cut(ellipsoid([0, 0.5, 0], [0.24, 0.19, 0.21]), [0, 0.4, 0], [0, 1, 0]),
      roundBox([0, 0.5, -0.22], [0.055, 0.2, 0.08], 0.03),
    );
    b.bone('spine');
    b.add(jacket, 'jacket', 0.015);
    for (const s of [-1, 1]) {
      const p = b.front(s * 0.075, 0.56);
      b.add(
        placed(roundBox([0, 0, 0], [0.032, 0.07, 0.01], 0.008), [p[0], p[1], p[2] - 0.006], rotZ(s * 0.3)),
        'jacket',
        0.006,
      );
      for (const [x, y] of [
        [0.15, 0.6],
        [0.18, 0.565],
        [0.2, 0.525],
      ])
        stud(b, b.front(s * x, y), 0.012, 'silver');
    }
    const patch = b.front(-0.125, 0.48);
    const pn = b.normal(patch);
    b.add(placed(ellipsoid([0, 0, 0], [0.036, 0.006, 0.036]), patch, alignY(pn)), 'offwhite', 0.003);
    const bolt: [number, number][] = [
      [-0.113, 0.505],
      [-0.132, 0.48],
      [-0.118, 0.48],
      [-0.137, 0.455],
    ];
    for (let i = 0; i < bolt.length - 1; i++) {
      const a = b.front(bolt[i][0], bolt[i][1]);
      const e = b.front(bolt[i + 1][0], bolt[i + 1][1]);
      b.add(capsule([a[0], a[1], a[2] - 0.002], [e[0], e[1], e[2] - 0.002], 0.0055), 'jacket', 0.002);
    }

    // Jacket sleeves, furry forearms, fingerless coral gloves.
    for (const s of [-1, 1]) {
      const wrist = arm(b, s, [s * 0.2, 0.58, 0], [0.12, 0.11], 0.85, [0.06, 0.052, 0.046], 'jacket', 'fur');
      glove(b, s, wrist, 0.85, 0.066, 'jacket', 'jacket', 'fur');
    }

    // Big shaggy head with floppy ears (a silver ring in one).
    b.bone('head');
    b.add(fuzz(sphere([0, 0.84, 0], 0.26), 0.009, 46), 'fur', 0.06);
    for (const s of [-1, 1]) {
      b.add(
        fuzz(placed(ellipsoid([0, 0, 0], [0.034, 0.095, 0.06]), [s * 0.28, 0.76, 0.02], rotZ(s * 0.4)), 0.007, 46),
        'fur',
        0.04,
      );
    }
    b.add(ring([0.318, 0.672, 0.01], [0, 0, 1], 0.02, 0.0055), 'silver', 0.003);

    // Coral horns.
    for (const s of [-1, 1]) {
      const pts: P3[] = [
        [s * 0.12, 1.02, 0],
        [s * 0.17, 1.09, -0.01],
        [s * 0.19, 1.16, -0.02],
        [s * 0.17, 1.215, -0.03],
      ];
      const rs = [0.045, 0.035, 0.023, 0.007];
      for (let i = 0; i < pts.length - 1; i++) b.add(capsule(pts[i], pts[i + 1], rs[i], rs[i + 1]), 'horn', 0.015);
    }

    // Spiky mohawk from the forehead over to the back.
    const hc: P3 = [0, 0.84, 0];
    const lens = [0.12, 0.16, 0.18, 0.17, 0.15, 0.12, 0.09];
    lens.forEach((len, i) => {
      const phi = -0.55 + i * 0.33;
      const d: P3 = [0, Math.cos(phi), Math.sin(phi)];
      const base: P3 = [0, hc[1] + d[1] * 0.235, d[2] * 0.235];
      const tip: P3 = [0, hc[1] + d[1] * (0.25 + len), d[2] * (0.25 + len)];
      b.add(fuzz(flatX(capsule(base, tip, 0.058, 0.007), 0.55), 0.003, 80), 'mohawk', 0.025);
    });

    // Big goofy grin with a snaggle tooth.
    const m = b.front(0, 0.73);
    b.sub(cut(ellipsoid([0, 0.745, m[2] + 0.01], [0.105, 0.06, 0.06]), [0, 0.745, 0], [0, -1, 0]), 'mouth', 0.014);
    b.add(ellipsoid([0, 0.705, m[2] + 0.04], [0.05, 0.02, 0.03]), 'tongue', 0.01);
    b.add(capsule([-0.04, 0.69, m[2] + 0.004], [-0.036, 0.728, m[2] - 0.006], 0.015, 0.006), 'tooth', 0.004);

    b.eyes({ x: 0.1, y: 0.87, w: 0.078, h: 0.094, iris: 0x1f8f78 });
  },
};
