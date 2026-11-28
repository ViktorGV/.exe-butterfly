// Zara Dunewhistle: an energetic desert nomad with a huge puff of curly hair tied up in a yellow band, sand
// goggles on the forehead, a red scarf-cape, blue tunic, yellow sash with pouches and a compass, puffy red
// trousers tucked into blue boots, and a little wooden whistle. Bright primary colours.
import { arm, boot, glove, ring, stud, type Builder } from '../kit.ts';
import { alignY, capsule, cut, ellipsoid, flatZ, fuzz, placed, roundBox, sphere, torus, type P3 } from '../sdf.ts';
import type { RacerDef } from '../types.ts';

export const zara: RacerDef = {
  id: 'zara',
  name: 'Zara Dunewhistle',
  roll: { archetype: 'Quirky stylised human', theme: 'Desert nomad', palette: 'Bright primary colours' },
  rig: { hips: 0.33, spine: 0.45, neck: 0.64, hip: [0.08, 0.33] },
  mats: {
    skin: { color: 0x94603b, rough: 0.45, clear: 0.25 },
    blush: { color: 0xc4685a, rough: 0.5, clear: 0.2 },
    hair: { color: 0x1f191d, rough: 0.78 },
    red: { color: 0xe63a2e, rough: 0.85 },
    redGloss: { color: 0xe2372a, rough: 0.38, clear: 0.7 },
    blue: { color: 0x2b68df, rough: 0.82 },
    blueGloss: { color: 0x2a5fd6, rough: 0.34, clear: 0.8 },
    yellow: { color: 0xffc624, rough: 0.78 },
    buckle: { color: 0xffd23a, rough: 0.28, metal: 0.8 },
    brass: { color: 0xd6a443, rough: 0.26, metal: 1 },
    cream: { color: 0xfff2dc, rough: 0.4, clear: 0.4 },
    lens: { color: 0x3f8dff, rough: 0.04, clear: 1, metal: 0.2 },
    frame: { color: 0x2a2a33, rough: 0.4, clear: 0.5 },
    leather: { color: 0x9a5f34, rough: 0.6, clear: 0.2 },
    mouth: { color: 0x4a1a1f, rough: 0.6 },
    teeth: { color: 0xffffff, rough: 0.22, clear: 0.7 },
    tongue: { color: 0xf27d8c, rough: 0.4, clear: 0.5 },
    sole: { color: 0x3a3340, rough: 0.85 },
  },
  sculpt(b: Builder) {
    // Blue boots with yellow cuffs and buckles, puffy red trousers tucked in.
    for (const s of [-1, 1]) {
      boot(b, s * 0.105, { w: 0.075, h: 0.17, l: 0.105 }, 'blueGloss', 'sole');
      b.add(torus([s * 0.105, 0.18, 0], 0.066, 0.016), 'yellow', 0.008);
      const p = b.front(s * 0.105, 0.125);
      b.add(roundBox([p[0], p[1], p[2] - 0.004], [0.03, 0.018, 0.007], 0.004), 'buckle', 0.003);
      b.bone('thigh', s);
      b.add(ellipsoid([s * 0.085, 0.27, 0], [0.088, 0.1, 0.088]), 'red', 0.03);
      b.add(capsule([s * 0.08, 0.33, 0], [s * 0.1, 0.2, 0], 0.07, 0.058), 'red', 0.03);
    }

    // Blue tunic flaring to a yellow-trimmed hem, with a yellow trim line down the front.
    b.bone('spine');
    b.add(flatZ(capsule([0, 0.4, 0], [0, 0.56, 0], 0.15, 0.145), 0, 0.85), 'blue', 0.04);
    b.bone('hips');
    b.add(flatZ(cut(capsule([0, 0.42, 0], [0, 0.34, 0], 0.14, 0.178), [0, 0.3, 0], [0, 1, 0]), 0, 0.85), 'blue', 0.03);
    b.add(flatZ(torus([0, 0.307, 0], 0.172, 0.016), 0, 0.85), 'yellow', 0.006);
    const t0 = b.front(0, 0.54);
    const t1 = b.front(0, 0.32);
    b.bone('spine');
    b.add(capsule([t0[0], t0[1], t0[2] - 0.003], [t1[0], t1[1], t1[2] - 0.003], 0.012), 'yellow', 0.004);

    // Yellow sash with pouches and a brass compass.
    b.bone('hips');
    b.add(flatZ(torus([0, 0.425, 0], 0.148, 0.032), 0, 0.85), 'yellow', 0.01);
    for (const s of [-1, 1]) b.add(roundBox([s * 0.13, 0.37, -0.06], [0.034, 0.036, 0.026], 0.014), 'leather', 0.008);
    const c = b.front(-0.075, 0.425);
    b.add(ellipsoid([c[0], c[1], c[2] - 0.008], [0.03, 0.03, 0.012]), 'brass', 0.004);
    b.add(ellipsoid([c[0], c[1], c[2] - 0.019], [0.022, 0.022, 0.005]), 'cream', 0.002);

    // Neck, red scarf-cape around the shoulders, bunched hood behind.
    b.bone('spine');
    b.add(capsule([0, 0.55, 0.005], [0, 0.68, 0.005], 0.05), 'skin', 0.02);
    b.add(flatZ(torus([0, 0.605, 0.01], 0.115, 0.058), 0.01, 0.9), 'red', 0.03);
    b.add(cut(ellipsoid([0, 0.42, 0.15], [0.19, 0.25, 0.065]), [0, 0.6, 0], [0, -1, 0]), 'red', 0.03);
    b.add(sphere([0, 0.66, 0.13], 0.085), 'red', 0.03);
    for (const s of [-1, 1]) b.add(ellipsoid([s * 0.14, 0.585, 0.01], [0.08, 0.05, 0.09]), 'red', 0.04);

    // Little wooden whistle on the chest.
    const w = b.front(0.035, 0.5);
    b.add(
      capsule([w[0] - 0.02, w[1], w[2] - 0.012], [w[0] + 0.022, w[1] - 0.004, w[2] - 0.012], 0.011),
      'leather',
      0.003,
    );

    // Tunic sleeves, chunky red gloves with yellow cuffs.
    for (const s of [-1, 1]) {
      const wrist = arm(b, s, [s * 0.165, 0.56, 0], [0.13, 0.12], 0.8, [0.05, 0.043, 0.039], 'blue');
      glove(b, s, wrist, 0.8, 0.062, 'redGloss', 'yellow');
    }

    // Round face with a big nose, ears and rosy cheeks.
    b.bone('head');
    b.add(sphere([0, 0.865, 0], 0.215), 'skin', 0.04);
    b.add(ellipsoid([0, 0.8, -0.02], [0.17, 0.13, 0.16]), 'skin', 0.08);
    for (const s of [-1, 1]) b.add(ellipsoid([s * 0.213, 0.85, 0.01], [0.03, 0.045, 0.035]), 'skin', 0.02);
    const n = b.front(0, 0.835);
    b.add(sphere([0, 0.835, n[2] + 0.012], 0.033), 'skin', 0.02);
    for (const s of [-1, 1]) stud(b, b.front(s * 0.118, 0.79), 0.02, 'blush', 0.02);

    // Big gap-toothed grin.
    const m = b.front(0, 0.755);
    b.sub(cut(ellipsoid([0, 0.766, m[2] + 0.008], [0.07, 0.046, 0.05]), [0, 0.766, 0], [0, -1, 0]), 'mouth', 0.012);
    for (const s of [-1, 1])
      b.add(roundBox([s * 0.017, 0.754, m[2] + 0.013], [0.0135, 0.012, 0.008], 0.004), 'teeth', 0.003);
    b.add(ellipsoid([0, 0.733, m[2] + 0.03], [0.035, 0.016, 0.025]), 'tongue', 0.008);

    // Thick raised eyebrows.
    for (const s of [-1, 1]) {
      const a = b.front(s * 0.045, 0.95);
      const e = b.front(s * 0.11, 0.962);
      b.add(capsule([a[0], a[1], a[2] - 0.003], [e[0], e[1], e[2] - 0.003], 0.011, 0.009), 'hair', 0.006);
    }

    // Hair: a cap with a high hairline, and a huge curly puff on top tied with a yellow band.
    b.add(cut(sphere([0, 0.875, 0.012], 0.228), [0, 1.005, -0.215], [0, 0.86, 0.51]), 'hair', 0.01);
    const pc: P3 = [0, 1.14, 0.02];
    b.add(fuzz(sphere(pc, 0.125), 0.008, 52), 'hair', 0.03);
    const count = 16;
    for (let i = 0; i < count; i++) {
      const y = 1 - (i + 0.5) / count; // upper part of a sphere
      const r = Math.sqrt(1 - y * y);
      const a = i * 2.39996;
      const d: P3 = [Math.cos(a) * r, y * 0.9 + 0.05, Math.sin(a) * r];
      b.add(
        fuzz(sphere([pc[0] + d[0] * 0.115, pc[1] + d[1] * 0.115, pc[2] + d[2] * 0.115], 0.062), 0.008, 52),
        'hair',
        0.025,
      );
    }
    b.add(torus([0, 1.035, 0.02], 0.1, 0.03), 'yellow', 0.012);

    // Sand goggles on the forehead.
    const gl: P3[] = [];
    for (const s of [-1, 1]) {
      const p = b.front(s * 0.078, 0.985);
      const nn = b.normal(p);
      const at: P3 = [p[0] + nn[0] * 0.012, p[1] + nn[1] * 0.012, p[2] + nn[2] * 0.012];
      b.add(ring(at, nn, 0.042, 0.013), 'frame', 0.005);
      b.add(placed(ellipsoid([0, 0, 0], [0.037, 0.012, 0.037]), at, alignY(nn)), 'lens', 0.003);
      gl.push(at);
    }
    b.add(capsule([gl[0][0] + 0.04, gl[0][1], gl[0][2]], [gl[1][0] - 0.04, gl[1][1], gl[1][2]], 0.009), 'frame', 0.004);
    b.add(flatZ(torus([0, 0.985, 0.02], 0.205, 0.01), 0.02, 0.95), 'frame', 0.004);

    b.eyes({ x: 0.075, y: 0.888, w: 0.056, h: 0.07, iris: 0x3b2414 });
  },
};
