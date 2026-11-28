// Chalga Night on the desk map: the school pieces swap for a Balkan pop-folk mega concert, built in code at the same
// sizes as their colliders (see pieces.ts):
//   sweeper: a tupan drum with a drummer on top, drumstick arms · bouncePad: a punk trampoline on a trampoline
//   movingPlatform: walk-of-fame star tiles · carousel: album covers · spinnerDisc: a glittering record under napkins
//   bridge: a golden microphone · slidingWall: old floppy disks · floors: scattered white napkins (salfetki)
// Plus the set: champagne bottles along the floors and napkins flying through the air (createChalgaSet).
// Materials here are made directly, not repainted by the theme (they already are the theme). Original art.
import * as THREE from 'three';
import type { CourseDef, PartDef } from '@wobble/shared/types';
import type { PieceContext } from './pieces.ts';

const cache = new Map<string, THREE.Material>();
const texCache = new Map<string, THREE.Texture>();

function std(color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}): THREE.Material {
  const key = `s:${new THREE.Color(color).getHexString()}:${JSON.stringify(o, (k, v) => (v?.isTexture ? v.uuid : v))}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.4, ...o });
    cache.set(key, m);
  }
  return m;
}
const glow = (color: THREE.ColorRepresentation, k = 0.8) => std(color, { emissive: color, emissiveIntensity: k });
const gold = () => std('#ffcc33', { metalness: 1, roughness: 0.25, emissive: '#5a3a00', emissiveIntensity: 0.4 });

function canvas(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = false) {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) draw(g, size);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

/** One crumpled white napkin drawn at (x, y). */
function napkin(g: CanvasRenderingContext2D, x: number, y: number, s: number, a: number) {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.fillStyle = '#ffffff';
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + Math.PI / 4;
    const rr = s * (i % 3 === 0 ? 0.72 : 0.6);
    g.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
  }
  g.fill();
  g.strokeStyle = 'rgba(180,170,200,0.7)';
  g.lineWidth = Math.max(1, s * 0.05);
  g.beginPath();
  g.moveTo(-s * 0.4, 0);
  g.lineTo(s * 0.4, 0);
  g.moveTo(0, -s * 0.35);
  g.lineTo(0, s * 0.35);
  g.stroke();
  g.restore();
}

/** Napkins littering a floor (transparent, tiles every 6 m). */
const napkinFloor = () =>
  canvas(
    'napkins',
    512,
    (g, s) => {
      const r = rng(5);
      for (let i = 0; i < 26; i++) napkin(g, r() * s, r() * s, 14 + r() * 16, r() * 6.3);
    },
    true,
  );

const napkinTex = () =>
  canvas('napkin', 64, (g, s) => {
    napkin(g, s / 2, s / 2, s * 0.62, 0.3);
  });

function walkOfFame(fading: boolean) {
  return canvas(`fame:${fading}`, 256, (g, s) => {
    const bg = g.createLinearGradient(0, 0, s, s);
    bg.addColorStop(0, fading ? '#5b6f8f' : '#2a1238');
    bg.addColorStop(1, fading ? '#2c3a55' : '#12081c');
    g.fillStyle = bg;
    g.fillRect(0, 0, s, s);
    const r = rng(fading ? 3 : 9);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.25})`;
      g.fillRect(r() * s, r() * s, 2, 2);
    }
    g.strokeStyle = '#ffcc33';
    g.lineWidth = 8;
    g.strokeRect(6, 6, s - 12, s - 12);
    star(g, s / 2, s * 0.47, s * 0.36);
    g.fillStyle = fading ? '#9fe3ff' : '#ff3fb4';
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#ffd86b';
    g.stroke();
    star(g, s / 2, s * 0.47, s * 0.16);
    g.fillStyle = fading ? '#e9fbff' : '#ffd23f';
    g.fill();
  });
}

function stageRing() {
  return canvas('stage-ring', 512, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, '#ff5fc8');
    grad.addColorStop(0.75, '#9b1f86');
    grad.addColorStop(0.92, '#ffcc33');
    grad.addColorStop(1, '#ffcc33');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    g.fill();
    const r = rng(2);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.8)' : 'rgba(255,210,63,0.8)';
      const a = r() * 6.28;
      const d = Math.sqrt(r()) * s * 0.44;
      g.fillRect(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 2, 2);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      star(g, s / 2 + Math.cos(a) * s * 0.46, s / 2 + Math.sin(a) * s * 0.46, 10);
      g.fillStyle = '#ffffff';
      g.fill();
    }
  });
}

function drumRope() {
  return canvas('drum-rope', 256, (g, s) => {
    g.fillStyle = '#c4122f';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#ffcc33';
    g.fillRect(0, s * 0.42, s, s * 0.16);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 7;
    g.beginPath();
    for (let i = 0; i <= 8; i++) g.lineTo((i / 8) * s, i % 2 ? s * 0.1 : s * 0.9);
    g.stroke();
  });
}

function punkMat() {
  return canvas('punk', 256, (g, s) => {
    g.fillStyle = '#141018';
    g.fillRect(0, 0, s, s);
    const r = rng(13);
    // leopard spots in hot pink
    for (let i = 0; i < 26; i++) {
      const x = r() * s;
      const y = r() * s;
      g.fillStyle = '#ff2fa8';
      g.beginPath();
      g.ellipse(x, y, 10 + r() * 6, 7 + r() * 5, r() * 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#141018';
      g.beginPath();
      g.ellipse(x, y, 5, 3, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // a lightning bolt
    g.fillStyle = '#ffe14a';
    g.beginPath();
    for (const [x, y] of [
      [0.55, 0.08],
      [0.3, 0.55],
      [0.5, 0.55],
      [0.4, 0.92],
      [0.72, 0.4],
      [0.52, 0.4],
    ])
      g.lineTo(x * s, y * s);
    g.fill();
  });
}

function vinylGlitter() {
  return canvas('vinyl-glitter', 512, (g, s) => {
    g.fillStyle = '#0d0a12';
    g.fillRect(0, 0, s, s);
    for (let rr = s * 0.48; rr > s * 0.16; rr -= 3) {
      g.strokeStyle = `rgba(${150 + ((rr * 7) % 100)},80,200,0.25)`;
      g.beginPath();
      g.arc(s / 2, s / 2, rr, 0, Math.PI * 2);
      g.stroke();
    }
    const r = rng(21);
    for (let i = 0; i < 900; i++) {
      const a = r() * 6.28;
      const d = s * (0.17 + r() * 0.31);
      g.fillStyle = ['#ffffff', '#ffd23f', '#ff6fd8', '#7fe7ff'][i % 4];
      g.fillRect(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 2, 2);
    }
    const lab = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.16);
    lab.addColorStop(0, '#ffd23f');
    lab.addColorStop(1, '#ff2fa8');
    g.fillStyle = lab;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.16, 0, Math.PI * 2);
    g.fill();
    star(g, s / 2, s / 2, s * 0.09);
    g.fillStyle = '#ffffff';
    g.fill();
    // napkins thrown on the record
    for (let i = 0; i < 9; i++) {
      const a = r() * 6.28;
      const d = s * (0.2 + r() * 0.24);
      napkin(g, s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 20 + r() * 10, r() * 6);
    }
  });
}

const FLOPPY = ['#1b2a6b', '#151319', '#c21c78', '#4a2a8a'];
function floppyFace(i: number) {
  return canvas(`floppy:${i}`, 256, (g, s) => {
    g.fillStyle = FLOPPY[i % FLOPPY.length];
    g.fillRect(0, 0, s, s);
    // metal shutter at the top
    g.fillStyle = '#c9ced8';
    g.fillRect(s * 0.25, 0, s * 0.5, s * 0.34);
    g.fillStyle = '#7d8492';
    g.fillRect(s * 0.52, s * 0.05, s * 0.12, s * 0.24);
    // label
    g.fillStyle = '#fbf7ee';
    g.fillRect(s * 0.12, s * 0.45, s * 0.76, s * 0.5);
    g.fillStyle = ['#ff2fa8', '#ffcc33', '#35c6ff', '#ff6a3d'][i % 4];
    g.fillRect(s * 0.12, s * 0.45, s * 0.76, s * 0.07);
    g.strokeStyle = '#9aa0b5';
    g.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.moveTo(s * 0.18, s * (0.62 + k * 0.08));
      g.lineTo(s * 0.82, s * (0.62 + k * 0.08));
      g.stroke();
    }
    // handwritten scribble on the label
    g.strokeStyle = '#2b2bd0';
    g.lineWidth = 4;
    g.beginPath();
    const r = rng(i + 4);
    for (let x = 0.2; x < 0.78; x += 0.04) g.lineTo(s * x, s * (0.6 + r() * 0.05));
    g.stroke();
    // write-protect hole
    g.fillStyle = '#000000';
    g.fillRect(s * 0.06, s * 0.86, s * 0.06, s * 0.06);
  });
}

const albumLoader = new THREE.TextureLoader();
function album(i: number): THREE.Texture {
  const key = `album:${i % 4}`;
  let t = texCache.get(key);
  if (!t) {
    t = albumLoader.load(`/event/themes/chalga-night/album-${(i % 4) + 1}.webp`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
  }
  return t;
}

function repeat(tex: THREE.Texture, rx: number, ry: number) {
  const qx = Math.max(0.1, Math.round(rx * 10) / 10);
  const qy = Math.max(0.1, Math.round(ry * 10) / 10);
  const key = `${tex.uuid}:${qx}:${qy}`;
  let t = texCache.get(key);
  if (!t) {
    t = tex.clone();
    t.repeat.set(qx, qy);
    t.needsUpdate = true;
    texCache.set(key, t);
  }
  return t;
}

// ---- helpers --------------------------------------------------------------------------------------------

function half(part: PartDef): [number, number, number] {
  const [a, b] = part.size;
  if (part.shape === 'box') return [part.size[0], part.size[1], part.size[2]];
  if (part.shape === 'cylinder') return [a, b, a];
  return [a, a, a];
}
const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 32) =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
const ball = (r: number, m: THREE.Material) => new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), m);
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}
function group(...c: THREE.Object3D[]) {
  const g = new THREE.Group();
  g.add(...c);
  return g;
}
function topDecal(w: number, d: number, m: THREE.Material, y: number) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
  p.rotation.x = -Math.PI / 2;
  p.position.y = y;
  return p;
}
function decal(map: THREE.Texture, transparent = false, emissive = 0) {
  const key = `d:${map.uuid}:${transparent}:${emissive}`;
  let m = cache.get(key);
  if (!m) {
    const sm = new THREE.MeshStandardMaterial({ map, roughness: 0.5, transparent, polygonOffset: true });
    sm.polygonOffsetFactor = -2;
    sm.polygonOffsetUnits = -4;
    if (emissive) {
      sm.emissive.set('#ffffff');
      sm.emissiveMap = map;
      sm.emissiveIntensity = emissive;
    }
    if (transparent) sm.alphaTest = 0.4;
    m = sm;
    cache.set(key, m);
  }
  return m;
}

// ---- pieces ---------------------------------------------------------------------------------------------

/** A tupan drum with a drummer standing on top, hitting it. */
function drumHub(part: PartDef): THREE.Object3D {
  const [r, hh] = part.size;
  const R = r * 1.05;
  const shell = cyl(R, R, hh * 2, std('#ffffff', { map: drumRope(), roughness: 0.5 }), 40);
  const skin = std('#f3e6c8', { roughness: 0.8 });
  const g = group(
    shell,
    at(cyl(R * 0.98, R * 0.98, 0.02, skin, 40), 0, hh + 0.01, 0),
    at(new THREE.Mesh(new THREE.TorusGeometry(R, 0.08, 8, 40), gold()), 0, hh, 0),
    at(new THREE.Mesh(new THREE.TorusGeometry(R, 0.08, 8, 40), gold()), 0, -hh, 0),
  );
  g.children[2].rotation.x = Math.PI / 2;
  g.children[3].rotation.x = Math.PI / 2;
  g.add(at(drummer(), 0, hh, 0));
  return g;
}

/** The drummer: sequinned jacket, big hair, a mallet and a switch raised over the drum. */
function drummer(): THREE.Group {
  const suit = std('#ff2fa8', { metalness: 0.6, roughness: 0.3, emissive: '#5a0033', emissiveIntensity: 0.5 });
  const skinM = std('#f1c19a', { roughness: 0.7 });
  const hair = std('#1a1016', { roughness: 0.6 });
  const pants = std('#111018', { roughness: 0.5 });
  const g = new THREE.Group();
  // legs astride, feet on the skin
  for (const s of [-1, 1]) {
    const leg = cyl(0.13, 0.15, 0.9, pants, 12);
    leg.rotation.z = s * 0.25;
    g.add(at(leg, s * 0.22, 0.45, 0));
    g.add(at(box(0.22, 0.1, 0.36, std('#ffcc33', { metalness: 1, roughness: 0.3 })), s * 0.32, 0.05, -0.05));
  }
  g.add(at(cyl(0.3, 0.26, 0.8, suit, 16), 0, 1.3, 0));
  g.add(at(ball(0.27, skinM), 0, 1.95, 0));
  g.add(at(ball(0.31, hair), 0, 2.07, 0.06));
  g.add(at(box(0.42, 0.08, 0.06, std('#111111', { roughness: 0.2 })), 0, 1.98, -0.24)); // sunglasses
  g.add(at(box(0.08, 0.5, 0.05, gold()), 0, 1.35, -0.29)); // gold chain
  // arms raised forward with the sticks
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.38, 1.6, 0);
    arm.rotation.x = -1.1;
    arm.rotation.z = s * 0.35;
    arm.add(at(cyl(0.09, 0.09, 0.7, suit, 10), 0, -0.35, 0));
    const stick =
      s < 0 ? cyl(0.05, 0.06, 1.1, std('#d9a35c', { roughness: 0.6 }), 8) : cyl(0.02, 0.03, 1.2, std('#e8d2a0'), 6);
    stick.rotation.x = 0.9;
    arm.add(at(stick, 0, -0.85, -0.3));
    if (s < 0) arm.add(at(ball(0.16, std('#ffffff', { roughness: 0.9 })), 0, -1.2, -0.72));
    g.add(arm);
  }
  return g;
}

/** A drumstick arm: a lacquered stick with a padded mallet head at the outer end. */
function drumstick(ctx: PieceContext): THREE.Object3D {
  const { part, index, poses0 } = ctx;
  const [, hh] = part.size;
  const hub = new THREE.Vector3(...poses0[0].pos);
  const me = new THREE.Vector3(...poses0[index].pos);
  const q = new THREE.Quaternion(...poses0[index].quat);
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const out = Math.sign(axis.dot(me.sub(hub))) || 1;
  const wood = std(index % 2 ? '#e4b46a' : '#c98b3a', { roughness: 0.35 });
  const g = group(cyl(0.16, 0.24, hh * 2 * 0.95, wood, 14));
  g.children[0].rotation.y = out > 0 ? 0 : Math.PI;
  const head = ball(0.55, std(index % 2 ? '#ff2fa8' : '#ffffff', { roughness: 0.85 }));
  head.scale.set(1, 0.8, 1);
  g.add(at(head, 0, out * (hh - 0.35), 0));
  g.add(at(cyl(0.26, 0.26, 0.35, gold(), 14), 0, -out * (hh - 0.4), 0));
  return g;
}

/** Punk trampoline on top of a punk trampoline (batut na batut). */
function batut(part: PartDef): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  const frame = std('#16131a', { metalness: 0.7, roughness: 0.3 });
  const pink = std('#ff2fa8', { emissive: '#ff2fa8', emissiveIntensity: 0.35 });
  const g = group(
    box(hx * 2, hy * 2 * 0.55, hz * 2, frame),
    at(box(hx * 2 + 0.08, 0.12, hz * 2 + 0.08, pink), 0, -hy + hy * 1.1, 0),
  );
  // the upper trampoline stacked on the lower one, on spring posts
  const top = new THREE.Group();
  top.position.y = hy * 0.15;
  const w = hx * 2 * 0.86;
  const d = hz * 2 * 0.86;
  top.add(at(box(w, 0.18, d, frame), 0, hy * 0.6, 0));
  const spring = std('#d9dde6', { metalness: 1, roughness: 0.2 });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const s = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 12), spring);
      for (let k = 0; k < 4; k++) {
        const c = s.clone();
        c.rotation.x = Math.PI / 2;
        top.add(at(c, (sx * w) / 2.3, hy * 0.05 + k * 0.1, (sz * d) / 2.3));
      }
    }
  // studs round the rim
  const stud = ball(0.07, std('#e8ebf2', { metalness: 1, roughness: 0.2 }));
  for (let i = 0; i < 16; i++) {
    const t = i / 16;
    const x = t < 0.5 ? (t * 4 - 1) * (w / 2) : ((t - 0.5) * 4 - 1) * (w / 2);
    top.add(at(stud.clone(), x, hy * 0.72, t < 0.5 ? d / 2 : -d / 2));
  }
  top.add(topDecal(w - 0.2, d - 0.2, decal(punkMat(), false, 0.15), hy * 0.7 + 0.004));
  g.add(top);
  return g;
}

function starTile(part: PartDef, fading: boolean): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  return group(
    box(hx * 2, hy * 2, hz * 2, std(fading ? '#3c4b66' : '#24102f', { roughness: 0.25, metalness: 0.4 })),
    at(box(hx * 2 + 0.06, 0.08, hz * 2 + 0.06, glow(fading ? '#7fe7ff' : '#ff2fa8', 1)), 0, -hy, 0),
    topDecal(hx * 2 - 0.04, hz * 2 - 0.04, decal(walkOfFame(fading), false, 0.45), hy + 0.004),
  );
}

function albumCover(part: PartDef, index: number): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  return group(
    box(hx * 2, hy * 2, hz * 2, gold()),
    topDecal(hx * 2 - 0.1, hz * 2 - 0.1, decal(album(index), false, 0.35), hy + 0.004),
  );
}

function sparklyVinyl(part: PartDef, index: number): THREE.Object3D {
  if (index > 0) {
    const [hx, hy, hz] = half(part);
    return box(
      hx * 2,
      hy * 2,
      hz * 2,
      std('#ff2fa8', { metalness: 0.8, roughness: 0.2, emissive: '#8a0050', emissiveIntensity: 0.6 }),
    );
  }
  const [r, hh] = part.size;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 8, 64), gold());
  rim.rotation.x = Math.PI / 2;
  const top = new THREE.Mesh(new THREE.CircleGeometry(r - 0.03, 64), decal(vinylGlitter(), false, 0.3));
  top.rotation.x = -Math.PI / 2;
  top.position.y = hh + 0.004;
  return group(
    cyl(r, r, hh * 2, std('#0d0a12', { metalness: 0.5, roughness: 0.2 }), 64),
    top,
    at(rim, 0, hh, 0),
    at(cyl(0.11, 0.11, 0.3, gold(), 16), 0, hh + 0.15, 0),
  );
}

function microphone(part: PartDef): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  const axisY = hy - hx;
  const rod = (len: number, r0: number, r1: number, m: THREE.Material) => {
    const c = cyl(r0, r1, len, m, 24);
    c.rotation.x = Math.PI / 2;
    return c;
  };
  const head = 1.6;
  const g = new THREE.Group();
  // handle: gold with a black grip band, cable end at +Z
  g.add(at(rod(hz * 2 - head, hx, hx * 0.92, gold()), 0, axisY, head / 2));
  g.add(at(rod(1.2, hx * 1.04, hx * 1.04, std('#151318', { roughness: 0.5 })), 0, axisY, hz * 0.3));
  g.add(at(rod(0.4, hx * 1.08, hx * 1.08, glow('#ff2fa8', 1)), 0, axisY, -hz + head + 0.2));
  // grille ball at the finish end (-Z), as wide as the walkway so it stays walkable
  const grille = new THREE.Mesh(
    new THREE.SphereGeometry(hx * 1.05, 24, 16),
    std('#d6dae3', { metalness: 1, roughness: 0.35, wireframe: false }),
  );
  g.add(at(grille, 0, axisY, -hz + head / 2));
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(hx * 1.08, 12, 8),
    std('#8a8f9c', { metalness: 1, roughness: 0.4, wireframe: true }),
  );
  g.add(at(mesh, 0, axisY, -hz + head / 2));
  // cable trailing down from the +Z end
  const cable = cyl(0.08, 0.08, 6, std('#0c0b10'), 8);
  g.add(at(cable, 0, axisY - 3, hz + 0.1));
  return g;
}

function floppy(part: PartDef, index: number, id: number): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  if (index <= 1) {
    // the ends: chunky beige disk drives with a slot
    return group(
      box(hx * 2, hy * 2, hz * 2, std('#d8d0bd', { roughness: 0.6 })),
      at(box(0.06, hy * 0.12, hz * 1.4, std('#151318')), hx + 0.01, hy * 0.4, 0),
      at(box(0.06, 0.1, 0.1, glow('#38ff6a', 1.2)), hx + 0.02, -hy * 0.5, hz * 0.5),
    );
  }
  const face = decal(floppyFace(id + index), false, 0.15);
  const plate = box(hx * 2, hy * 2, hz * 2, std(FLOPPY[(id + index) % FLOPPY.length], { roughness: 0.35 }));
  const front = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hy * 2), face);
  front.position.z = hz + 0.01;
  const back = front.clone();
  back.position.z = -hz - 0.01;
  back.rotation.y = Math.PI;
  return group(plate, front, back);
}

/** Napkins scattered over a floor's top (call with the platform's half size). */
export function napkinLitter(hx: number, hy: number, hz: number): THREE.Object3D {
  return topDecal(hx * 2 - 0.1, hz * 2 - 0.1, decal(repeat(napkinFloor(), hx / 3, hz / 3), true), hy + 0.012);
}

/** The Chalga art for one part, or undefined to keep the desk piece. */
export function chalgaPiece(ctx: PieceContext): THREE.Object3D | null | undefined {
  const { entity, part, index } = ctx;
  switch (entity.kind) {
    case 'sweeper':
      return index === 0 ? drumHub(part) : drumstick(ctx);
    case 'bouncePad':
      return batut(part);
    case 'movingPlatform':
      return starTile(part, entity.params.fade === true);
    case 'carousel':
      return albumCover(part, index + entity.id);
    case 'spinnerDisc':
      return sparklyVinyl(part, index);
    case 'bridge':
      return microphone(part);
    case 'slidingWall':
      return floppy(part, index, entity.id);
    default:
      return undefined;
  }
}

/** The stage disc under a drum (replaces the clock face). */
export function stageDisc(radius: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.CircleGeometry(radius, 72), decal(stageRing(), false, 0.4));
}

// ---- the set: champagne bottles along the floors, napkins in the air --------------------------------------

function bottleGeometry(): THREE.BufferGeometry[] {
  const pts = [
    [0, 0],
    [0.34, 0],
    [0.36, 0.05],
    [0.36, 1.15],
    [0.3, 1.4],
    [0.13, 1.7],
    [0.12, 2.15],
    [0, 2.15],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.LatheGeometry(pts, 18);
  const foil = new THREE.CylinderGeometry(0.135, 0.15, 0.55, 14).translate(0, 1.95, 0);
  const label = new THREE.CylinderGeometry(0.365, 0.365, 0.45, 18, 1, true).translate(0, 0.65, 0);
  return [glass, foil, label];
}

/**
 * Giant LED screens beside the course showing a picture the player adds on their own machine:
 * apps/web/public/event/local/stage.png (or .jpg). That folder is gitignored, so the picture is never committed.
 * With no picture the screens stay hidden.
 */
function localScreens(course: CourseDef): THREE.Group {
  const g = new THREE.Group();
  g.name = 'chalga:local-screens';
  g.visible = false;
  const { min, max } = course.bounds;
  const cx = (min[0] + max[0]) / 2;
  const halfW = (max[0] - min[0]) / 2;
  const tryLoad = (urls: string[]) => {
    const url = urls[0];
    if (!url) return;
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const img = tex.image as { width: number; height: number };
        const h = 36;
        const w = (h * img.width) / Math.max(1, img.height);
        const screen = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false });
        const spots: [number, number, number][] = [];
        for (let z = max[2] - 10; z > min[2]; z -= 90)
          for (const side of [-1, 1]) spots.push([cx + side * (halfW + 45 + w / 2), z, side]);
        spots.push([cx, min[2] - 50, 0]);
        for (const [x, z, side] of spots) {
          const s = new THREE.Group();
          s.add(new THREE.Mesh(new THREE.BoxGeometry(w + 2, h + 2, 1), gold()));
          const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screen);
          face.position.z = 0.55;
          s.add(face);
          s.position.set(x, min[1] + h / 2 + 6, z);
          s.rotation.y = side === 0 ? 0 : side < 0 ? Math.PI / 2.6 : -Math.PI / 2.6;
          g.add(s);
        }
        g.visible = true;
      },
      undefined,
      () => tryLoad(urls.slice(1)),
    );
  };
  tryLoad(['/event/local/stage.png', '/event/local/stage.jpg']);
  return g;
}

export interface ChalgaSet {
  group: THREE.Group;
  update(t: number): void;
}

export function createChalgaSet(course: CourseDef): ChalgaSet {
  const g = new THREE.Group();
  g.name = 'chalga:set';
  const r = rng(77);
  g.add(localScreens(course));

  // champagne bottles on the sides of every floor, some knocked over
  const spots: { x: number; y: number; z: number; yaw: number; tip: number; s: number }[] = [];
  for (const e of course.entities) {
    if (e.kind !== 'platform') continue;
    const size = (e.params.size as [number, number, number] | undefined) ?? [10, 1, 10];
    const top = e.pos[1] + size[1];
    const c = Math.cos(e.yaw);
    const s = Math.sin(e.yaw);
    for (let z = -size[2] + 2; z < size[2] - 1; z += 5 + r() * 4) {
      for (const side of [-1, 1]) {
        if (r() < 0.35) continue;
        const lx = side * (size[0] - 0.7 - r() * 0.6);
        const tip = r() < 0.25 ? Math.PI / 2 : 0;
        spots.push({
          x: e.pos[0] + lx * c + z * s,
          y: top + (tip ? 0.36 : 0),
          z: e.pos[2] - lx * s + z * c,
          yaw: r() * 6.28,
          tip,
          s: 0.8 + r() * 0.5,
        });
      }
    }
  }
  const [glassG, foilG, labelG] = bottleGeometry();
  const parts: [THREE.BufferGeometry, THREE.Material][] = [
    [glassG, new THREE.MeshStandardMaterial({ color: '#0f4a2a', roughness: 0.1, metalness: 0.3 })],
    [foilG, new THREE.MeshStandardMaterial({ color: '#ffcc33', metalness: 1, roughness: 0.3, emissive: '#5a3a00' })],
    [labelG, new THREE.MeshStandardMaterial({ color: '#fbf3dc', roughness: 0.6, side: THREE.DoubleSide })],
  ];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (const [geo, material] of parts) {
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, spots.length));
    mesh.count = spots.length;
    spots.forEach((b, i) => {
      q.setFromEuler(e.set(b.tip, b.yaw, 0, 'YXZ'));
      mesh.setMatrixAt(i, m.compose(p.set(b.x, b.y, b.z), q, sc.setScalar(b.s)));
    });
    mesh.castShadow = true;
    mesh.computeBoundingSphere();
    g.add(mesh);
  }

  // napkins flying over the course: thrown up, fluttering down, wrapping round
  const { min, max } = course.bounds;
  const N = 420;
  const nap = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.55, 0.55),
    new THREE.MeshStandardMaterial({
      map: napkinTex(),
      transparent: true,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.9,
      emissive: '#ffffff',
      emissiveIntensity: 0.25,
    }),
    N,
  );
  nap.frustumCulled = false;
  const seeds = new Float32Array(N * 6);
  for (let i = 0; i < N; i++) {
    seeds[i * 6] = min[0] - 8 + r() * (max[0] - min[0] + 16);
    seeds[i * 6 + 1] = min[2] - 5 + r() * (max[2] - min[2] + 10);
    seeds[i * 6 + 2] = r() * 100;
    seeds[i * 6 + 3] = 0.6 + r() * 0.8; // fall speed
    seeds[i * 6 + 4] = r() * 6.28;
    seeds[i * 6 + 5] = 0.6 + r() * 0.8; // size
  }
  const lo = min[1] - 2;
  const span = Math.max(12, max[1] - min[1] + 22);
  g.add(nap);

  return {
    group: g,
    update(t) {
      for (let i = 0; i < N; i++) {
        const k = i * 6;
        const ph = seeds[k + 4];
        const y = lo + span - ((seeds[k + 2] + t * seeds[k + 3] * 1.6) % span);
        p.set(seeds[k] + Math.sin(t * 0.9 + ph) * 1.2, y, seeds[k + 1] + Math.cos(t * 0.7 + ph) * 1.2);
        q.setFromEuler(e.set(t * 2.1 + ph, t * 1.3 + ph * 2, Math.sin(t * 3 + ph) * 0.8));
        nap.setMatrixAt(i, m.compose(p, q, sc.setScalar(seeds[k + 5])));
      }
      nap.instanceMatrix.needsUpdate = true;
    },
  };
}
