// Rolli Crumbleton: a chubby pangolin royal pastry chef. Glossy lavender scale plates with mint edges on the
// head, back, legs and curled tail; a puffy bubblegum-pink toque with a glowing mint crown; a cream
// double-breasted chef's jacket with glowing peach piping and mint buttons; a lilac neckerchief; a frilly apron
// with a glowing cupcake emblem; a mint rolling pin on the belt; mint oven-mitt gloves. Pastel neon.
import { arm, boot, glove, stud, type Builder } from '../kit.ts';
import { alignY, capsule, cut, ellipsoid, flatZ, placed, sphere, torus, type P3 } from '../sdf.ts';
import type { RacerDef } from '../types.ts';

/** One overlapping scale plate lying on the surface at p (mint rim under a lavender plate). */
function plate(b: Builder, p: P3, size: number, lean = 0.35): void {
  const n = b.normal(p);
  // Tip each plate a little toward the ground so they overlap like shingles.
  const d: P3 = [n[0], n[1] + lean, n[2] + lean * 0.4];
  const m = alignY(d);
  b.add(placed(ellipsoid([0, 0, 0], [size * 1.08, size * 0.24, size * 0.95]), p, m), 'scaleEdge', 0.006);
  b.add(
    placed(
      ellipsoid([0, 0, 0], [size, size * 0.26, size * 0.85]),
      [p[0] + n[0] * 0.006, p[1] + n[1] * 0.006, p[2] + n[2] * 0.006],
      m,
    ),
    'scale',
    0.006,
  );
}

export const rolli: RacerDef = {
  id: 'rolli',
  name: 'Rolli Crumbleton',
  roll: { archetype: 'Cute animal (pangolin)', theme: 'Royal pastry chef', palette: 'Pastel neon' },
  rig: { hips: 0.3, spine: 0.42, neck: 0.62, hip: [0.085, 0.3] },
  mats: {
    scale: { color: 0xc6a6ff, rough: 0.18, clear: 1 },
    scaleEdge: { color: 0xa2f2d8, rough: 0.25, clear: 0.9 },
    skin: { color: 0xf3d6e6, rough: 0.45, clear: 0.3 },
    nose: { color: 0xffa98a, rough: 0.3, clear: 0.8 },
    toque: { color: 0xff9fcf, rough: 0.82 },
    crown: { color: 0x7dffd8, rough: 0.25, metal: 0.3, glow: 1.2 },
    jacket: { color: 0xfff3e4, rough: 0.86 },
    piping: { color: 0xffa36b, rough: 0.45, glow: 0.7 },
    button: { color: 0x8ff2cf, rough: 0.22, clear: 0.9 },
    lilac: { color: 0xc49bff, rough: 0.8 },
    apron: { color: 0xffe8f3, rough: 0.85 },
    emblem: { color: 0xff6fb5, rough: 0.4, glow: 1.1 },
    pin: { color: 0x9ff0d6, rough: 0.35, clear: 0.6 },
    mitt: { color: 0x8ff2cf, rough: 0.6 },
    cuff: { color: 0xff9fcf, rough: 0.7 },
    boot: { color: 0xb594ff, rough: 0.32, clear: 0.8 },
    sole: { color: 0xffb08a, rough: 0.6 },
    mouth: { color: 0x4a1a2c, rough: 0.6 },
    tongue: { color: 0xff8aa6, rough: 0.4, clear: 0.5 },
  },
  sculpt(b: Builder) {
    // Short scaly legs on lavender boots with peach soles.
    for (const s of [-1, 1]) {
      b.bone('thigh', s);
      b.add(capsule([s * 0.085, 0.3, 0], [s * 0.1, 0.14, 0], 0.07, 0.064), 'scale', 0.03);
      boot(b, s * 0.104, { w: 0.084, h: 0.13, l: 0.11 }, 'boot', 'sole');
      b.bone('thigh', s);
      for (const y of [0.18, 0.24]) plate(b, b.front(s * 0.095, y), 0.04, 0.5);
    }

    // Chubby body in a cream chef's jacket, double-breasted with glowing piping and mint buttons.
    b.bone('spine');
    b.add(ellipsoid([0, 0.44, 0], [0.25, 0.24, 0.22]), 'jacket', 0.05);
    const edge0 = b.front(0.11, 0.6);
    const edge1 = b.front(0.03, 0.3);
    b.add(
      capsule([edge0[0], edge0[1], edge0[2] - 0.006], [edge1[0], edge1[1], edge1[2] - 0.006], 0.012),
      'piping',
      0.004,
    );
    for (const x of [-0.075, 0.055]) for (const y of [0.37, 0.45, 0.53]) stud(b, b.front(x, y), 0.017, 'button');
    // Lilac neckerchief with a knot.
    b.add(flatZ(torus([0, 0.62, 0], 0.15, 0.035), 0, 0.9), 'lilac', 0.015);
    const knot = b.front(0, 0.6);
    b.add(ellipsoid([0, 0.585, knot[2] - 0.012], [0.04, 0.035, 0.025]), 'lilac', 0.01);
    b.add(ellipsoid([0.015, 0.545, knot[2] - 0.01], [0.022, 0.04, 0.015]), 'lilac', 0.008);

    // Short frilly apron with a glowing cupcake emblem, a pink belt and a mint rolling pin.
    b.bone('hips');
    b.add(flatZ(torus([0, 0.4, 0], 0.235, 0.022), 0, 0.88), 'cuff', 0.008);
    const af = b.front(0, 0.32);
    b.add(cut(ellipsoid([0, 0.33, af[2] + 0.03], [0.19, 0.12, 0.05]), [0, 0.4, 0], [0, -1, 0]), 'apron', 0.015);
    for (let i = -4; i <= 4; i++) {
      const p = b.front(i * 0.042, 0.215 + Math.abs(i) * 0.004);
      b.add(sphere([p[0], p[1], p[2] + 0.004], 0.024), 'apron', 0.012);
    }
    const em = b.front(0, 0.31);
    b.add(ellipsoid([0, 0.29, em[2] - 0.006], [0.035, 0.022, 0.01]), 'emblem', 0.003);
    b.add(sphere([0, 0.325, em[2] - 0.004], 0.026), 'emblem', 0.006);
    b.add(sphere([0, 0.352, em[2] - 0.003], 0.008), 'piping', 0.002);
    b.add(capsule([0.215, 0.43, -0.14], [0.235, 0.37, 0.1], 0.026), 'pin', 0.006);
    for (const [y, z] of [
      [0.445, -0.19],
      [0.355, 0.15],
    ])
      b.add(
        capsule(
          [0.21 + (z > 0 ? 0.03 : -0.005), y, z],
          [0.215 + (z > 0 ? 0.03 : -0.005), y + (z > 0 ? -0.012 : 0.012), z + (z > 0 ? 0.045 : -0.045)],
          0.012,
        ),
        'pin',
        0.004,
      );

    // A thick scaly tail curled up behind.
    b.bone('hips');
    const tail: P3[] = [
      [0, 0.26, 0.17],
      [0, 0.18, 0.3],
      [0, 0.22, 0.42],
      [0, 0.34, 0.47],
      [0, 0.44, 0.42],
    ];
    const tr = [0.1, 0.09, 0.075, 0.06, 0.045];
    for (let i = 0; i < tail.length - 1; i++) b.add(capsule(tail[i], tail[i + 1], tr[i], tr[i + 1]), 'scale', 0.03);
    for (let i = 0; i < tail.length - 1; i++) {
      const p = b.hit([0, (tail[i][1] + tail[i + 1][1]) / 2 + 0.3, (tail[i][2] + tail[i + 1][2]) / 2], [0, -1, 0]);
      for (const x of [-0.04, 0.04]) plate(b, b.hit([x, p[1] + 0.2, p[2]], [0, -1, 0]), 0.045 - i * 0.004, 0.2);
    }

    // Sleeves and mint oven mitts with pink cuffs.
    for (const s of [-1, 1]) {
      const wrist = arm(b, s, [s * 0.2, 0.55, 0], [0.12, 0.11], 0.82, [0.062, 0.055, 0.05], 'jacket');
      glove(b, s, wrist, 0.82, 0.072, 'mitt', 'cuff');
    }

    // Head with a short pointed snout and a peach button nose.
    b.bone('head');
    b.add(sphere([0, 0.84, 0.01], 0.22), 'skin', 0.06);
    b.add(capsule([0, 0.82, -0.12], [0, 0.785, -0.31], 0.082, 0.032), 'skin', 0.06);
    b.add(sphere([0, 0.785, -0.34], 0.028), 'nose', 0.01);
    for (const s of [-1, 1]) b.add(ellipsoid([s * 0.2, 0.9, 0.03], [0.035, 0.03, 0.025]), 'skin', 0.02);
    const m = b.front(0, 0.745);
    b.sub(cut(ellipsoid([0, 0.752, m[2] + 0.008], [0.055, 0.032, 0.04]), [0, 0.752, 0], [0, -1, 0]), 'mouth', 0.01);
    b.add(ellipsoid([0, 0.73, m[2] + 0.026], [0.028, 0.012, 0.02]), 'tongue', 0.008);

    // Scale plates over the back of the head, overlapping like shingles.
    for (const [pol, count] of [
      [0.25, 4],
      [0.75, 9],
      [1.2, 11],
    ]) {
      for (let k = 0; k < count; k++) {
        const az = (k / count) * Math.PI * 2 + pol;
        const dir: P3 = [Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az)];
        if (dir[2] < -0.15) continue; // keep the face clear
        const p = b.hit([dir[0] * 0.6, 0.84 + dir[1] * 0.6, 0.01 + dir[2] * 0.6], [-dir[0], -dir[1], -dir[2]]);
        plate(b, p, 0.052, 0.25);
      }
    }

    // Scales over the forehead and along the top of the snout, so the face reads as a pangolin.
    for (const [y, xs, size] of [
      [0.955, [-0.1, -0.05, 0, 0.05, 0.1], 0.042],
      [0.995, [-0.075, -0.025, 0.025, 0.075], 0.044],
    ] as [number, number[], number][])
      for (const x of xs) plate(b, b.front(x, y), size, 0.15);
    for (const [z, size] of [
      [-0.15, 0.036],
      [-0.2, 0.032],
      [-0.25, 0.026],
    ])
      plate(b, b.hit([0, 1.2, z], [0, -1, 0]), size, 0.0);
    // Scaly shoulders peeking out over the sleeves.
    for (const s of [-1, 1])
      for (const [y, z] of [
        [0.585, -0.03],
        [0.585, 0.05],
        [0.54, 0.01],
      ])
        plate(b, b.hit([s * 0.7, y, z], [-s, 0, 0]), 0.045, 0.3);

    // Puffy toque sitting on top of the head, with a glowing mint crown pinned to the front.
    b.add(cut(capsule([0, 1.0, 0.03], [0, 1.1, 0.03], 0.16), [0, 1.0, 0], [0, 1, 0]), 'toque', 0.03);
    b.add(sphere([0, 1.24, 0.03], 0.15), 'toque', 0.05);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      b.add(sphere([Math.sin(a) * 0.12, 1.2, 0.03 + Math.cos(a) * 0.12], 0.1), 'toque', 0.05);
    }
    const cf = b.front(0, 1.06);
    b.add(torus([0, 1.05, cf[2] + 0.02], 0.05, 0.01), 'crown', 0.004);
    for (const x of [-0.04, 0, 0.04]) {
      const p = b.front(x, 1.09);
      b.add(
        capsule([x, 1.06, p[2] - 0.004], [x, 1.11 + (x === 0 ? 0.015 : 0), p[2] - 0.012], 0.012, 0.004),
        'crown',
        0.004,
      );
    }

    b.eyes({ x: 0.082, y: 0.875, w: 0.068, h: 0.082, iris: 0x6a3fb5 });
  },
};
