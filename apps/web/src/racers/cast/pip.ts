// Pip Glimmerfin: a squishy deep-sea alien diver in a too-big mint dive suit, brass helmet pushed back like a
// cap and a glowing coral lure on a curly antenna. Mint and coral with brass.
import { arm, boot, glove, ring, stud, type Builder } from '../kit.ts';
import { alignY, capsule, cut, ellipsoid, flatZ, placed, roundBox, rotZ, sphere, torus } from '../sdf.ts';
import type { RacerDef } from '../types.ts';

export const pip: RacerDef = {
  id: 'pip',
  name: 'Pip Glimmerfin',
  roll: { archetype: 'Friendly alien', theme: 'Deep-sea diver', palette: 'Mint & coral' },
  rig: { hips: 0.3, spine: 0.42, neck: 0.6, hip: [0.085, 0.3] },
  mats: {
    skin: { color: 0xb4fbe3, rough: 0.25, clear: 1, glow: 0.08 },
    suit: { color: 0x1fa585, rough: 0.92 },
    coral: { color: 0xff7a66, rough: 0.72 },
    coralGloss: { color: 0xff6a5c, rough: 0.3, clear: 0.85 },
    coralDark: { color: 0xe2574d, rough: 0.6 },
    brass: { color: 0xdaa645, rough: 0.26, metal: 1 },
    cream: { color: 0xfff1dc, rough: 0.42, clear: 0.5 },
    glass: { color: 0x2f8a96, rough: 0.04, clear: 1, metal: 0.3 },
    sole: { color: 0x3a3f4b, rough: 0.85 },
    spot: { color: 0xff8aa4, rough: 0.4, glow: 0.55 },
    lure: { color: 0xff7d92, rough: 0.25, glow: 1.6 },
    mouth: { color: 0x5a1b2b, rough: 0.6 },
    tongue: { color: 0xff8a9c, rough: 0.4, clear: 0.6 },
  },
  sculpt(b: Builder) {
    // Short suit legs and big weighted boots with brass toe caps.
    for (const s of [-1, 1]) {
      b.bone('thigh', s);
      b.add(capsule([s * 0.085, 0.3, 0], [s * 0.112, 0.13, 0], 0.078, 0.07), 'suit', 0.04);
      boot(b, s * 0.116, { w: 0.088, h: 0.13, l: 0.11 }, 'coralGloss', 'sole');
      b.add(ellipsoid([s * 0.116, 0.072, -0.14], [0.07, 0.05, 0.045]), 'brass', 0.01);
      b.add(torus([s * 0.113, 0.158, 0], 0.078, 0.02), 'coral', 0.01);
    }

    // Gumdrop body in the baggy suit, the jelly head on top, a coral seal at the neck.
    b.bone('spine');
    b.add(ellipsoid([0, 0.43, 0], [0.27, 0.25, 0.23]), 'suit', 0.05);
    b.bone('head');
    b.add(sphere([0, 0.8, 0], 0.25), 'skin', 0.1);
    b.bone('spine');
    b.add(flatZ(torus([0, 0.615, 0], 0.19, 0.036), 0, 0.92), 'coral', 0.02);

    // Quilted chest panel with brass rivets.
    b.add(roundBox([0, 0.42, -0.19], [0.13, 0.1, 0.06], 0.045), 'coral', 0.03);
    const pz = b.front(0, 0.42)[2];
    for (const y of [0.39, 0.45]) b.sub(capsule([-0.11, y, pz], [0.11, y, pz], 0.008), 'coralDark');
    b.sub(capsule([0, 0.35, pz], [0, 0.49, pz], 0.008), 'coralDark');
    for (const x of [-0.105, 0.105]) for (const y of [0.345, 0.495]) stud(b, b.front(x, y), 0.015, 'brass');

    // Chunky belt with a round depth gauge.
    b.bone('hips');
    b.add(flatZ(torus([0, 0.29, 0], 0.232, 0.033), 0, 0.86), 'coralDark', 0.015);
    const g = b.front(0, 0.29);
    b.add(ellipsoid([0, 0.29, g[2] - 0.012], [0.058, 0.058, 0.024]), 'brass', 0.006);
    b.add(ellipsoid([0, 0.29, g[2] - 0.03], [0.044, 0.044, 0.01]), 'cream', 0.002);
    b.add(capsule([0, 0.29, g[2] - 0.04], [0.022, 0.312, g[2] - 0.04], 0.005), 'coralDark', 0.002);

    // Puffy sleeves and chunky coral gloves with mint cuffs.
    for (const s of [-1, 1]) {
      const wrist = arm(b, s, [s * 0.2, 0.5, 0], [0.13, 0.12], 0.85, [0.068, 0.06, 0.054], 'suit');
      glove(b, s, wrist, 0.85, 0.068, 'coralGloss', 'skin');
    }

    // Floppy fin ears.
    b.bone('head');
    for (const s of [-1, 1])
      b.add(placed(ellipsoid([0, 0, 0], [0.03, 0.105, 0.068]), [s * 0.262, 0.82, 0.02], rotZ(s * 1.22)), 'skin', 0.05);

    // Brass diving helmet pushed back like a cap, with a coral seal and porthole windows.
    const hc: [number, number, number] = [0, 0.93, 0.07];
    const hr = 0.25;
    const n: [number, number, number] = [0, 0.451, 0.892];
    const off = 0.06;
    const rim: [number, number, number] = [0, hc[1] - n[1] * off, hc[2] - n[2] * off];
    b.add(cut(sphere(hc, hr), rim, n), 'brass', 0.02);
    b.add(ring(rim, n, Math.sqrt(hr * hr - off * off), 0.026), 'coral', 0.012);
    for (const s of [-1, 1]) {
      const d: [number, number, number] = [s * 0.8, 0.5, 0.33];
      const l = Math.hypot(...d);
      const p: [number, number, number] = [(d[0] / l) * hr, hc[1] + (d[1] / l) * hr, hc[2] + (d[2] / l) * hr];
      b.add(ring(p, d, 0.052, 0.015), 'brass', 0.01);
      b.add(placed(ellipsoid([0, 0, 0], [0.046, 0.012, 0.046]), p, alignY(d)), 'glass', 0.004);
    }

    // Curly antenna with a glowing lure orb.
    const pts: [number, number, number][] = [
      [0, 1.0, -0.13],
      [0, 1.09, -0.165],
      [0, 1.16, -0.215],
      [0, 1.19, -0.285],
      [0, 1.17, -0.33],
    ];
    const rs = [0.022, 0.017, 0.014, 0.012, 0.011];
    for (let i = 0; i < pts.length - 1; i++) b.add(capsule(pts[i], pts[i + 1], rs[i], rs[i + 1]), 'skin', 0.02);
    b.add(sphere([0, 1.14, -0.345], 0.046), 'lure', 0.01);

    // Bioluminescent freckles.
    for (const s of [-1, 1])
      for (const [dx, dy] of [
        [0, 0],
        [0.036, 0.022],
        [0.032, -0.026],
      ])
        stud(b, b.front(s * (0.148 + dx), 0.725 + dy), 0.013, 'spot');

    // Big open smile with a tongue.
    const m = b.front(0, 0.71);
    b.sub(cut(ellipsoid([0, 0.718, m[2] + 0.008], [0.066, 0.046, 0.05]), [0, 0.718, 0], [0, -1, 0]), 'mouth', 0.012);
    b.add(ellipsoid([0, 0.688, m[2] + 0.036], [0.036, 0.018, 0.026]), 'tongue', 0.01);

    // Seashell air tank on the back.
    b.bone('spine');
    b.add(ellipsoid([0, 0.47, 0.255], [0.12, 0.14, 0.06]), 'cream', 0.02);
    for (let i = -2; i <= 2; i++) {
      const top = b.hit([i * 0.045, 0.575, 0.8], [0, 0, -1]);
      const bottom = b.hit([0, 0.36, 0.8], [0, 0, -1]);
      b.add(capsule(bottom, top, 0.014, 0.016), 'coral', 0.01);
    }
    b.add(sphere([0, 0.35, 0.285], 0.03), 'coral', 0.01);

    b.bone('head');
    b.eyes({ x: 0.086, y: 0.835, w: 0.072, h: 0.086, iris: 0x1f7a74 });
  },
};
