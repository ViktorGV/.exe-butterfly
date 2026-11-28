// Living sky and set (#64): what the butterflies, the domino wave and the desk lamp do for the school desk, a
// sci-fi event theme does with its own life, all in the theme's colours:
// - starfighter squadrons banking through loops over the course, engines glowing;
// - a capital ship drifting slowly across the far sky;
// - laser bolts streaking between the squadrons;
// - hover drones bobbing beside the track with blinking eyes;
// - searchlight beams sweeping up from the set pieces;
// - a power conduit down both sides whose lights pulse along the course (the chain reaction, in place of the
//   domino wave).
// Visual only, deterministic per course, allocation-free per frame.
import * as THREE from 'three';
import { getObstacleKind } from '@wobble/shared';
import type { CourseDef, Prim, ThemeDefV2, Vec3 } from '@wobble/shared/types';
import { primsGeometry, primsMaterial } from './prims.ts';

export interface ThemeAmbient {
  group: THREE.Group;
  update(t: number): void;
  dispose(): void;
}

function rnd(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const P = (
  shape: Prim['shape'],
  pos: Vec3,
  scale: Vec3,
  color: string,
  rot: Vec3 = [0, 0, 0],
  emissive?: string,
): Prim => ({
  shape,
  pos,
  rot,
  scale,
  color,
  ...(emissive ? { emissive } : {}),
});

/** An original wedge starfighter, nose toward -Z, about 5 m long. */
function fighter(hull: string, trim: string, glow: string): Prim[] {
  return [
    P('box', [0, 0, 0], [0.45, 0.35, 2.2], hull),
    P('cone', [0, 0, -2.6], [0.45, 0.6, 0.35], hull, [-Math.PI / 2, 0, 0]),
    P('sphere', [0, 0.38, -0.6], [0.32, 0.22, 0.6], '#1a2333', [0, 0, 0], '#3a6aa8'),
    P('box', [1.5, 0, 0.6], [1.3, 0.06, 0.55], trim, [0, 0, 0.12]),
    P('box', [-1.5, 0, 0.6], [1.3, 0.06, 0.55], trim, [0, 0, -0.12]),
    P('cylinder', [2.7, 0, 0.7], [0.18, 0.9, 0.18], hull, [Math.PI / 2, 0, 0]),
    P('cylinder', [-2.7, 0, 0.7], [0.18, 0.9, 0.18], hull, [Math.PI / 2, 0, 0]),
    P('sphere', [0.35, 0, 2.25], [0.22, 0.22, 0.12], glow, [0, 0, 0], glow),
    P('sphere', [-0.35, 0, 2.25], [0.22, 0.22, 0.12], glow, [0, 0, 0], glow),
  ];
}

/** A long wedge capital ship with towers and an engine bank, nose toward -Z, about 2 units long (scaled up). */
function capital(hull: string, dark: string, glow: string): Prim[] {
  return [
    P('cone', [0, 0, 0], [0.55, 1.1, 0.12], hull, [-Math.PI / 2, 0, 0]),
    P('box', [0, 0.14, 0.45], [0.22, 0.08, 0.35], dark),
    P('box', [0, 0.26, 0.6], [0.09, 0.08, 0.12], hull),
    P('box', [0.12, 0.3, 0.62], [0.03, 0.05, 0.04], dark),
    P('box', [-0.12, 0.3, 0.62], [0.03, 0.05, 0.04], dark),
    P('box', [0, 0, 1.07], [0.4, 0.09, 0.03], dark),
    P('sphere', [0.22, 0, 1.11], [0.07, 0.07, 0.03], glow, [0, 0, 0], glow),
    P('sphere', [0, 0, 1.11], [0.09, 0.09, 0.03], glow, [0, 0, 0], glow),
    P('sphere', [-0.22, 0, 1.11], [0.07, 0.07, 0.03], glow, [0, 0, 0], glow),
  ];
}

/** A hover drone: a ball with a ring and a single glowing eye looking toward -Z, about 1.2 m across. */
function drone(hull: string, eye: string): Prim[] {
  return [
    P('sphere', [0, 0, 0], [0.5, 0.5, 0.5], hull),
    P('torus', [0, 0, 0], [0.8, 0.8, 0.8], '#2a2a30', [Math.PI / 2, 0, 0]),
    P('sphere', [0, 0.05, -0.45], [0.16, 0.16, 0.08], eye, [0, 0, 0], eye),
    P('cone', [0, -0.55, 0], [0.12, 0.25, 0.12], '#2a2a30', [Math.PI, 0, 0]),
  ];
}

export function createThemeAmbient(opts: { theme: ThemeDefV2; course: CourseDef; groundY: number }): ThemeAmbient {
  const { theme, course, groundY } = opts;
  const r = rnd(23);
  const group = new THREE.Group();
  group.name = 'theme:ambient';
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  const { min, max } = course.bounds;
  const cx = (min[0] + max[0]) / 2;
  const halfW = (max[0] - min[0]) / 2;
  const zMid = (min[2] + max[2]) / 2;
  const len = max[2] - min[2];
  const top = max[1];

  const hull = new THREE.Color(theme.materials.rail.color).lerp(new THREE.Color('#d8dde4'), 0.55).getStyle();
  const trim = theme.hud.accent;
  const glow = theme.fx.hit;
  const cool = theme.fx.checkpoint;
  const lit = keep(primsMaterial());
  lit.fog = false;
  lit.emissive.set(theme.sky.horizon).multiplyScalar(0.25);

  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3(1, 1, 1);
  const ahead = new THREE.Vector3();
  const here = new THREE.Vector3();

  // --- starfighter squadrons: three formations of four on big banked loops over the course -----------------
  const wings = 3;
  const perWing = 4;
  const fighters = new THREE.InstancedMesh(keep(primsGeometry(fighter(hull, trim, glow))), lit, wings * perWing);
  fighters.frustumCulled = false;
  group.add(fighters);
  const loops = Array.from({ length: wings }, (_, w) => ({
    rx: halfW + 40 + r() * 50,
    rz: len * (0.35 + r() * 0.2),
    y: top + 25 + w * 14 + r() * 8,
    speed: (0.05 + r() * 0.03) * (w % 2 ? -1 : 1),
    phase: r() * Math.PI * 2,
  }));
  const slot: Vec3[] = [
    [0, 0, 0],
    [-4, -0.6, 4],
    [4, -0.6, 4],
    [0, -1.2, 8],
  ];
  const loopAt = (l: (typeof loops)[number], a: number, out: THREE.Vector3) =>
    out.set(cx + Math.cos(a) * l.rx, l.y + Math.sin(a * 2) * 6, zMid + Math.sin(a) * l.rz);

  // --- the capital ship crossing the far sky -------------------------------------------------------------
  const ship = new THREE.Mesh(keep(primsGeometry(capital(hull, theme.materials.platformB.color, glow))), lit);
  ship.scale.setScalar(160);
  ship.frustumCulled = false;
  group.add(ship);

  // --- laser bolts: short glowing streaks fired across the sky ------------------------------------------
  const boltCount = 28;
  const boltMat = keep(new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }));
  const bolts = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.25, 0.25, 7)), boltMat, boltCount);
  bolts.frustumCulled = false;
  const boltColors = [new THREE.Color(glow), new THREE.Color(cool)];
  const boltPaths = Array.from({ length: boltCount }, (_, i) => {
    bolts.setColorAt(i, boltColors[i % 2]);
    const z = zMid + (r() - 0.5) * len;
    const y = top + 15 + r() * 45;
    const dir = r() < 0.5 ? 1 : -1;
    return { z, y, dir, speed: 70 + r() * 50, phase: r() * 10, span: halfW * 2 + 260 };
  });
  group.add(bolts);

  // --- hover drones beside the track --------------------------------------------------------------------
  const droneCount = 22;
  const drones = new THREE.InstancedMesh(keep(primsGeometry(drone(hull, glow))), lit, droneCount);
  drones.frustumCulled = false;
  group.add(drones);
  const dronePos = Array.from({ length: droneCount }, (_, i) => ({
    x: cx + (i % 2 ? 1 : -1) * (halfW + 3 + r() * 8),
    y: 3 + r() * 7,
    z: max[2] - (i / droneCount) * len - r() * 10,
    phase: r() * 10,
  }));

  // --- searchlights sweeping up from the sides ----------------------------------------------------------
  const beamMat = keep(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(theme.sky.horizon).lerp(new THREE.Color('#ffffff'), 0.5),
      transparent: true,
      opacity: 0.09,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  const beamGeo = keep(new THREE.ConeGeometry(9, 220, 24, 1, true));
  beamGeo.translate(0, -110, 0); // apex at the origin, opening upward after the flip below
  beamGeo.rotateX(Math.PI);
  const beams = Array.from({ length: 6 }, (_, i) => {
    const b = new THREE.Mesh(beamGeo, beamMat);
    b.position.set(cx + (i % 2 ? 1 : -1) * (halfW + 55 + r() * 40), groundY, max[2] - (i / 6) * len - 20);
    b.frustumCulled = false;
    group.add(b);
    return { b, phase: r() * 10, speed: 0.25 + r() * 0.2 };
  });

  // --- power conduit with a chain-reaction pulse down both sides ----------------------------------------
  const sideX = halfW + 14;
  const spacing = 3.5;
  const posts = Math.max(2, Math.floor((len + 40) / spacing));
  const postMat = keep(
    new THREE.MeshStandardMaterial({ color: theme.materials.rail.color, roughness: 0.5, metalness: 0.6 }),
  );
  const lampMat = keep(new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }));
  const postMesh = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.6, 3.6, 0.6)), postMat, posts * 2);
  const lampMesh = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.45, 12, 8)), lampMat, posts * 2);
  const cable = new THREE.Color(trim);
  const dim = new THREE.Color(trim).multiplyScalar(0.15);
  const lampColor = new THREE.Color();
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < posts; i++) {
      const x = cx + (side ? 1 : -1) * sideX;
      const z = max[2] + 20 - i * spacing;
      postMesh.setMatrixAt(side * posts + i, m.compose(p.set(x, groundY + 1.8, z), q.identity(), s.set(1, 1, 1)));
      lampMesh.setMatrixAt(side * posts + i, m.compose(p.set(x, groundY + 3.9, z), q.identity(), s.set(1, 1, 1)));
      lampMesh.setColorAt(side * posts + i, dim);
    }
  }
  group.add(postMesh, lampMesh);

  // --- runway lights along every floor edge (in place of the pennant rows), chasing toward the finish -----
  const runway: { x: number; y: number; z: number }[] = [];
  for (const ent of course.entities) {
    if (ent.kind !== 'platform' && ent.kind !== 'ramp') continue;
    let half: readonly number[] = [5, 0.5, 5];
    try {
      half = getObstacleKind(ent.kind)?.parts(ent)[0]?.size ?? half;
    } catch {
      // keep the default
    }
    const c = Math.cos(ent.yaw);
    const sn = Math.sin(ent.yaw);
    const yTop = ent.kind === 'platform' ? ent.pos[1] + 0.06 : ent.pos[1] + half[1] * 2 + 0.06;
    for (const side of [-1, 1]) {
      const lx = side * (half[0] - 0.4);
      for (let lz = -half[2] + 1; lz <= half[2] - 1; lz += 2.5) {
        runway.push({ x: ent.pos[0] + lx * c + lz * sn, y: yTop, z: ent.pos[2] - lx * sn + lz * c });
      }
    }
  }
  const runMat = keep(new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }));
  const runMesh = new THREE.InstancedMesh(
    keep(new THREE.BoxGeometry(0.35, 0.12, 0.9)),
    runMat,
    Math.max(1, runway.length),
  );
  runMesh.count = runway.length;
  runway.forEach((l, i) => {
    runMesh.setMatrixAt(i, m.compose(p.set(l.x, l.y, l.z), q.identity(), s.set(1, 1, 1)));
    runMesh.setColorAt(i, dim);
  });
  runMesh.frustumCulled = false;
  group.add(runMesh);
  const runHot = new THREE.Color(cool);

  // --- floor detail (the desk's sticky notes and paperclips): deck plates, hazard stripes, vents, scorches -
  // All flat (a few centimetres), drawn a hair above the floor so it never flickers and never trips anyone.
  type Flat = { x: number; y: number; z: number; yaw: number; w: number; d: number };
  const plates: Flat[] = [];
  const stripes: Flat[] = [];
  const vents: Flat[] = [];
  const scorch: Flat[] = [];
  const fr = rnd(41);
  for (const ent of course.entities) {
    if (ent.kind !== 'platform') continue;
    let half: readonly number[] = [5, 0.5, 5];
    try {
      half = getObstacleKind(ent.kind)?.parts(ent)[0]?.size ?? half;
    } catch {
      // keep the default
    }
    const c = Math.cos(ent.yaw);
    const sn = Math.sin(ent.yaw);
    const at = (lx: number, lz: number, list: Flat[], w: number, d: number, yaw = 0) =>
      list.push({
        x: ent.pos[0] + lx * c + lz * sn,
        y: ent.pos[1],
        z: ent.pos[2] - lx * sn + lz * c,
        yaw: ent.yaw + yaw,
        w,
        d,
      });
    const [hx, , hz] = half;
    // Deck plates on a loose grid, some missing so the sand shows through.
    for (let lx = -hx + 2; lx <= hx - 2; lx += 4)
      for (let lz = -hz + 2; lz <= hz - 2; lz += 4) if (fr() < 0.45) at(lx, lz, plates, 3.6, 3.6);
    // Hazard stripes across both ends.
    for (const end of [-1, 1]) at(0, end * (hz - 0.5), stripes, hx * 2 - 1, 0.6);
    // A few vents and scorch marks.
    const n = Math.max(1, Math.round((hx * hz) / 30));
    for (let k = 0; k < n; k++)
      at((fr() - 0.5) * (hx * 2 - 3), (fr() - 0.5) * (hz * 2 - 3), vents, 1.6, 0.8, fr() * Math.PI);
    for (let k = 0; k < n; k++) {
      const r0 = 1 + fr() * 2;
      at((fr() - 0.5) * (hx * 2 - 3), (fr() - 0.5) * (hz * 2 - 3), scorch, r0, r0, fr() * Math.PI);
    }
  }
  const flatGeo = keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const flatMat = (o: THREE.MeshStandardMaterialParameters | THREE.MeshBasicMaterialParameters, basic = false) => {
    const mtl = basic
      ? new THREE.MeshBasicMaterial(o)
      : new THREE.MeshStandardMaterial(o as THREE.MeshStandardMaterialParameters);
    mtl.polygonOffset = true;
    mtl.polygonOffsetFactor = -2;
    mtl.polygonOffsetUnits = -4;
    return keep(mtl);
  };
  const stripeTex = keep(
    (() => {
      if (typeof document === 'undefined') return new THREE.Texture(); // tests run without a DOM
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 16;
      const g2 = cv.getContext('2d');
      if (g2) {
        g2.fillStyle = '#15151a';
        g2.fillRect(0, 0, 64, 16);
        g2.fillStyle = trim;
        for (let x = -16; x < 64; x += 16) {
          g2.beginPath();
          g2.moveTo(x, 16);
          g2.lineTo(x + 8, 0);
          g2.lineTo(x + 16, 0);
          g2.lineTo(x + 8, 16);
          g2.fill();
        }
      }
      const tx = new THREE.CanvasTexture(cv);
      tx.wrapS = THREE.RepeatWrapping;
      tx.colorSpace = THREE.SRGBColorSpace;
      return tx;
    })(),
  );
  const layers: [Flat[], THREE.Material, number][] = [
    [
      plates,
      flatMat({
        color: new THREE.Color(theme.materials.rail.color).lerp(new THREE.Color('#8a8f99'), 0.5),
        roughness: 0.55,
        metalness: 0.5,
      }),
      0.03,
    ],
    [scorch, flatMat({ color: '#000000', transparent: true, opacity: 0.45, depthWrite: false }, true), 0.06],
    [stripes, flatMat({ map: stripeTex, roughness: 0.6 }), 0.09],
    [vents, flatMat({ color: glow }, true), 0.12],
  ];
  const flatMeshes: THREE.InstancedMesh[] = [];
  for (const [list, mtl, lift] of layers) {
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(flatGeo, mtl, list.length);
    list.forEach((it, i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, it.yaw);
      mesh.setMatrixAt(i, m.compose(p.set(it.x, it.y + lift, it.z), q, s.set(it.w, 1, it.d)));
    });
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    // Fixed order (plates, scorch, stripes, vents): overlapping flats never trade places.
    mesh.renderOrder = flatMeshes.length + 1;
    flatMeshes.push(mesh);
    group.add(mesh);
  }
  const ventMat = layers[3][1] as THREE.MeshBasicMaterial;
  const ventBase = new THREE.Color(glow);

  // --- the finish: a glowing line across the course and a big arch with a ring --------------------------
  const f = course.finish;
  const fy = f.pos[1] - f.half[1];
  const finish = new THREE.Group();
  finish.position.set(f.pos[0], fy, f.pos[2] + f.half[2] - 1.2);
  finish.rotation.y = f.yaw;
  const lineMat = keep(new THREE.MeshBasicMaterial({ color: cool, fog: false, transparent: true, opacity: 0.9 }));
  const line = new THREE.Mesh(keep(new THREE.PlaneGeometry(f.half[0] * 2, 1.6)), lineMat);
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.08;
  const pylonMat = keep(
    new THREE.MeshStandardMaterial({ color: theme.materials.rail.color, roughness: 0.4, metalness: 0.6, fog: false }),
  );
  const ringMat = keep(new THREE.MeshBasicMaterial({ color: glow, fog: false }));
  const archH = 16;
  const archW = f.half[0] + 2;
  for (const side of [-1, 1]) {
    const py = new THREE.Mesh(keep(new THREE.BoxGeometry(2.2, archH, 2.2)), pylonMat);
    py.position.set(side * archW, archH / 2, 0);
    const cap = new THREE.Mesh(keep(new THREE.SphereGeometry(1.6, 16, 10)), ringMat);
    cap.position.set(side * archW, archH + 1.2, 0);
    finish.add(py, cap);
  }
  const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(archW, 0.7, 12, 64, Math.PI)), ringMat);
  ring.position.y = archH * 0.55;
  finish.add(line, ring);
  group.add(finish);

  // --- the destination: a giant warp gate behind the finish (like the school desk's monitor at the far end) --
  const gate = new THREE.Group();
  gate.position.set(f.pos[0], fy + 46, f.pos[2] - 95);
  const gateR = 42;
  const frameMat = keep(
    new THREE.MeshStandardMaterial({ color: theme.materials.rail.color, roughness: 0.35, metalness: 0.8, fog: false }),
  );
  const frame = new THREE.Mesh(keep(new THREE.TorusGeometry(gateR, 3.2, 20, 96)), frameMat);
  const rim = new THREE.Mesh(keep(new THREE.TorusGeometry(gateR - 3, 0.9, 12, 96)), ringMat);
  // Clamp blocks around the ring, every 30 degrees, glowing at the tips.
  const clampGeo = keep(new THREE.BoxGeometry(5, 9, 6));
  const tipGeo = keep(new THREE.BoxGeometry(5.2, 1.2, 6.2));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const cl = new THREE.Mesh(clampGeo, frameMat);
    cl.position.set(Math.cos(a) * (gateR + 2), Math.sin(a) * (gateR + 2), 0);
    cl.rotation.z = a - Math.PI / 2;
    const tip = new THREE.Mesh(tipGeo, ringMat);
    tip.position.copy(cl.position).multiplyScalar((gateR + 7) / (gateR + 2));
    tip.rotation.z = cl.rotation.z;
    gate.add(cl, tip);
  }
  // The portal: a swirl drawn once into a canvas, spun and pulsed every frame, additive so it glows.
  const swirlTex = keep(
    (() => {
      if (typeof document === 'undefined') return new THREE.Texture();
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const g2 = cv.getContext('2d');
      if (g2) {
        const grad = g2.createRadialGradient(128, 128, 4, 128, 128, 128);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.25, new THREE.Color(cool).getStyle());
        grad.addColorStop(0.7, new THREE.Color(glow).multiplyScalar(0.6).getStyle());
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g2.fillStyle = grad;
        g2.fillRect(0, 0, 256, 256);
        g2.globalCompositeOperation = 'lighter';
        g2.strokeStyle = 'rgba(255,255,255,0.35)';
        for (let arm = 0; arm < 5; arm++) {
          g2.beginPath();
          for (let i = 0; i < 120; i++) {
            const rr = i * 1.05;
            const aa = arm * ((Math.PI * 2) / 5) + i * 0.06;
            const x = 128 + Math.cos(aa) * rr;
            const y = 128 + Math.sin(aa) * rr;
            if (i === 0) g2.moveTo(x, y);
            else g2.lineTo(x, y);
          }
          g2.lineWidth = 6;
          g2.stroke();
        }
      }
      const tx = new THREE.CanvasTexture(cv);
      tx.colorSpace = THREE.SRGBColorSpace;
      return tx;
    })(),
  );
  const portalMat = keep(
    new THREE.MeshBasicMaterial({
      map: swirlTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  const portal = new THREE.Mesh(keep(new THREE.CircleGeometry(gateR - 3, 64)), portalMat);
  const orbitA = new THREE.Mesh(keep(new THREE.TorusGeometry(gateR + 16, 0.6, 8, 96)), ringMat);
  const orbitB = new THREE.Mesh(keep(new THREE.TorusGeometry(gateR + 26, 0.45, 8, 96)), ringMat);
  gate.add(frame, rim, portal, orbitA, orbitB);
  group.add(gate);

  function update(t: number) {
    // Warp gate: the portal spins and breathes, the outer rings orbit on tilted axes.
    portal.rotation.z = -t * 0.6;
    portalMat.opacity = 0.75 + 0.2 * Math.sin(t * 2);
    orbitA.rotation.set(Math.sin(t * 0.3) * 0.5, t * 0.25, 0);
    orbitB.rotation.set(t * 0.18, Math.cos(t * 0.2) * 0.6, 0);

    lit.userData.glow.value = 0.85 + 0.3 * Math.sin(t * 3);

    // Squadrons: follow the loop, nose along the path, bank into the turn.
    loops.forEach((l, w) => {
      const a = l.phase + t * l.speed;
      const da = 0.02 * Math.sign(l.speed);
      const pos = loopAt(l, a, here);
      loopAt(l, a + da, ahead);
      const yaw = Math.atan2(-(ahead.x - pos.x), -(ahead.z - pos.z));
      e.set(0, yaw, 0.55 * Math.sign(l.speed), 'YXZ');
      q.setFromEuler(e);
      for (let k = 0; k < perWing; k++) {
        p.set(slot[k][0], slot[k][1], slot[k][2]).applyQuaternion(q).add(pos);
        fighters.setMatrixAt(w * perWing + k, m.compose(p, q, s.set(1, 1, 1)));
      }
    });
    fighters.instanceMatrix.needsUpdate = true;

    // Capital ship: a slow pass high over one side, then round again.
    const pass = ((t * 4) % (len + 900)) - 450;
    ship.position.set(cx - halfW - 170, top + 95, max[2] + 300 - pass - len / 2);

    // Bolts: streak across the course and wrap.
    boltPaths.forEach((b, i) => {
      const x = ((((t + b.phase) * b.speed) % b.span) - b.span / 2) * b.dir + cx;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.PI / 2);
      bolts.setMatrixAt(i, m.compose(p.set(x, b.y, b.z), q, s.set(1, 1, 1)));
    });
    bolts.instanceMatrix.needsUpdate = true;

    // Drones bob and turn slowly; the eye glow pulses with the material.
    dronePos.forEach((d, i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.sin(t * 0.4 + d.phase) * 0.8);
      drones.setMatrixAt(i, m.compose(p.set(d.x, d.y + Math.sin(t * 1.6 + d.phase) * 0.6, d.z), q, s.set(1, 1, 1)));
    });
    drones.instanceMatrix.needsUpdate = true;

    // Searchlights sway.
    for (const sl of beams)
      sl.b.rotation.set(Math.sin(t * sl.speed + sl.phase) * 0.45, 0, Math.cos(t * sl.speed * 0.8 + sl.phase) * 0.35);

    // Conduit: a bright pulse runs down the course every few seconds, leaving a fading trail.
    const head = ((t * 30) % ((posts + 30) * spacing)) / spacing;
    for (let i = 0; i < posts; i++) {
      const d = head - i;
      const k = d >= 0 && d < 14 ? 1 - d / 14 : 0;
      lampColor.copy(dim).lerp(cable, k);
      lampMesh.setColorAt(i, lampColor);
      lampMesh.setColorAt(posts + i, lampColor);
    }
    if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;

    // Runway lights: bands of light chase down the course toward the finish.
    for (let i = 0; i < runway.length; i++) {
      const k = 0.5 + 0.5 * Math.sin(runway[i].z * 0.35 + t * 6);
      lampColor.copy(dim).lerp(runHot, k * k);
      runMesh.setColorAt(i, lampColor);
    }
    if (runMesh.instanceColor) runMesh.instanceColor.needsUpdate = true;
    // Vents breathe.
    ventMat.color.copy(ventBase).multiplyScalar(0.55 + 0.45 * Math.sin(t * 2.2));
    // The finish line shimmers.
    lineMat.opacity = 0.65 + 0.3 * Math.sin(t * 5);
  }
  update(0);

  return {
    group,
    update,
    dispose() {
      group.removeFromParent();
      for (const mesh of [fighters, bolts, drones, postMesh, lampMesh, runMesh, ...flatMeshes]) mesh.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
