// Obstacle art for the Chain Reaction Desk. Every obstacle part becomes a desk object at racer scale, built in
// the part's own frame and sized to the part, so what players see matches what they collide with.
//
//   platform A: green cutting mat · platform B / ramp: lined notebook paper · movingPlatform: keyboard keycaps
//   carousel: polaroid photos · spinnerDisc: vinyl record · bridge: hexagonal pencil · sweeper: clock hands
//   bumper: thread spool · pendulum: chrome cradle ball on a string · gate: marker pillars + ruler crossbar
//   wall: stacked dominoes · bouncePad: pink eraser · arrowTile: sticky note with a marker arrow
//   slidingWall: chrome toaster ends + popping toast · snowBlower: desk-fan console with spinning blades
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { EntityDef, PartDef, Pose } from '@wobble/shared/types';
import { decalMat, deskPainted, mat } from './materials.ts';
import {
  clockFace,
  cuttingMat,
  dominoFace,
  indexCard,
  keycap,
  linedPaper,
  polaroid,
  repeated,
  ruler,
  stickyNote,
  toast,
  vinyl,
  checker,
} from './textures.ts';

export interface PieceContext {
  entity: EntityDef;
  part: PartDef;
  index: number;
  parts: PartDef[];
  /** World poses of every part at t = 0. */
  poses0: Pose[];
}

// ---- helpers ------------------------------------------------------------------------------------------

const pick = <T>(list: readonly T[], n: number): T => list[((n % list.length) + list.length) % list.length];

function rbox(w: number, h: number, d: number, r: number, m: THREE.Material): THREE.Mesh {
  const rr = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, rr), m);
}

function box(w: number, h: number, d: number, m: THREE.Material | THREE.Material[]): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
}

function cyl(rTop: number, rBottom: number, h: number, m: THREE.Material, seg = 32): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), m);
}

/** Flat textured rectangle lying on top of something, facing up; texture top = local -Z. */
function topDecal(w: number, d: number, m: THREE.Material, y: number): THREE.Mesh {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
  p.rotation.x = -Math.PI / 2;
  p.position.y = y;
  return p;
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.add(...children);
  return g;
}

/** Half extents of a box part, or [radius, halfHeight, radius] for a cylinder, [r, r, r] for a sphere. */
function half(part: PartDef): [number, number, number] {
  const [a, b] = part.size;
  if (part.shape === 'box') return [part.size[0], part.size[1], part.size[2]];
  if (part.shape === 'cylinder') return [a, b, a];
  return [a, a, a];
}

const PASTELS = ['#fff6e8', '#c9f2e3', '#ffd9c9', '#e2d6ff', '#fff1a8', '#cfe6ff'];
const INKS = ['#e5484d', '#2f6fd6', '#2e9e62', '#8e5cd9', '#e08a1e'];
const PENCILS = ['#f6c330', '#3a7bd5', '#38b36b', '#e5484d', '#8e5cd9', '#ff8a3d'];
const THREADS = ['#e5484d', '#3a7bd5', '#f6c330', '#38b36b', '#ff7bc0', '#8e5cd9'];

// ---- pieces per kind ---------------------------------------------------------------------------------

function platform({ part, entity }: PieceContext): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  const w = hx * 2;
  const h = hy * 2;
  const d = hz * 2;
  const slot = (entity.params.slot as string | undefined) ?? part.slot;
  if (slot !== 'platformA') {
    // Every other floor is a pad of lined notebook paper; the cover underneath shows the slot's colour.
    const cover = slot === 'platformB' ? '#efe6cf' : slot === 'accent' ? '#ffcf3f' : '#9fd8ff';
    const body = rbox(w, h, d, Math.min(0.25, h * 0.45), mat('paper', cover));
    const top = topDecal(w - 0.08, d - 0.08, decalMat(repeated(linedPaper(), w / 4, d / 4)), hy + 0.004);
    return group(body, top);
  }
  const body = rbox(w, h, d, Math.min(0.3, h * 0.45), mat('plastic', '#1f5a42'));
  const top = topDecal(w - 0.1, d - 0.1, decalMat(repeated(cuttingMat(), w / 4, d / 4)), hy + 0.004);
  return group(body, top);
}

function ramp(ctx: PieceContext): THREE.Object3D {
  const [hx, hy, hz] = half(ctx.part);
  const g = group(
    rbox(hx * 2, hy * 2, hz * 2, Math.min(0.25, hy * 0.9), mat('paper', '#efe6cf')),
    topDecal(hx * 2 - 0.1, hz * 2 - 0.1, decalMat(repeated(linedPaper(), hx / 2, hz / 2)), hy + 0.004),
    at(box(hx * 2, 0.12, hz * 2 + 0.1, mat('plastic', '#3a5fd6')), 0, -hy - 0.04, 0),
  );
  // Spiral binding wrapped over the left edge.
  const ringGeo = new THREE.TorusGeometry(0.42, 0.06, 8, 20);
  const chrome = mat('chrome', '#d8dbe2');
  for (let z = -hz + 0.6; z < hz - 0.3; z += 1.1) {
    const r = new THREE.Mesh(ringGeo, chrome);
    r.position.set(-hx + 0.05, 0, z);
    g.add(r);
  }
  return g;
}

function keycapPiece({ part, entity }: PieceContext): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  const color = pick(PASTELS, entity.id);
  const letter = pick('FLUTTERWASDQ'.split(''), entity.id * 7 + 3);
  return group(
    rbox(hx * 2 * 0.94, hy * 2, hz * 2 * 0.94, 0.4, mat('plastic', color)),
    at(
      rbox(hx * 2, hy * 1.3, hz * 2, 0.3, mat('plastic', new THREE.Color(color).multiplyScalar(0.88))),
      0,
      -hy * 0.35,
      0,
    ),
    topDecal(hx * 2 * 0.74, hz * 2 * 0.74, decalMat(keycap(letter, pick(INKS, entity.id)), 'plastic'), hy + 0.005),
  );
}

function polaroidPiece({ part, index }: PieceContext): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  const g = group(
    rbox(hx * 2, hy * 2, hz * 2, 0.12, mat('paper', '#f7f5ef')),
    topDecal(hx * 2 - 0.06, hz * 2 - 0.06, decalMat(polaroid(index)), hy + 0.004),
  );
  g.rotation.y = (index % 2 ? 1 : -1) * 0.03;
  return g;
}

function vinylPiece({ part }: PieceContext): THREE.Object3D {
  const [r, hh] = part.size;
  const disc = cyl(r, r, hh * 2, mat('plastic', '#141318'), 64);
  const top = new THREE.Mesh(new THREE.CircleGeometry(r - 0.03, 64), decalMat(vinyl(), 'plastic'));
  top.rotation.x = -Math.PI / 2;
  top.position.y = hh + 0.004;
  return group(disc, top, at(cyl(0.11, 0.11, 0.3, mat('chrome', '#e8e8ee'), 16), 0, hh + 0.15, 0));
}

function pencilPiece({ part, entity }: PieceContext): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  const R = hx / Math.cos(Math.PI / 6); // flat-to-flat = width
  const axisY = hy - hx; // flat top face level with the collision top
  const color = pick(PENCILS, entity.id);
  const g = new THREE.Group();
  const hex = (len: number, rTop: number, rBottom: number, m: THREE.Material) => {
    const geo = new THREE.CylinderGeometry(rTop, rBottom, len, 6);
    geo.rotateY(Math.PI / 6);
    geo.rotateX(Math.PI / 2);
    return new THREE.Mesh(geo, m);
  };
  const tail = 1.4;
  const point = 1.7; // sharpened end, kept inside the bridge's length so the art never overhangs the collider
  g.add(at(hex(hz * 2 - tail - point, R, R, mat('plastic', color)), 0, axisY, (point - tail) / 2));
  // Ferrule and eraser at the start end (+Z).
  const round = (len: number, r: number, m: THREE.Material) => {
    const c = cyl(r, r, len, m, 20);
    c.rotation.x = Math.PI / 2;
    return c;
  };
  g.add(at(round(0.55, hx * 1.06, mat('chrome', '#cfc6b4')), 0, axisY, hz - tail + 0.275));
  g.add(at(round(0.85, hx * 0.98, mat('rubber', '#ff8fa6')), 0, axisY, hz - 0.425));
  // Sharpened wood cone (wide end against the body) and graphite point at the finish end (-Z).
  const cone = hex(point - 0.4, R, 0.18, mat('wood', '#f1cfa0'));
  g.add(at(cone, 0, axisY, -hz + 0.4 + (point - 0.4) / 2));
  const lead = cyl(0, 0.18, 0.4, mat('plastic', '#2a2830'), 12);
  lead.rotation.x = -Math.PI / 2;
  g.add(at(lead, 0, axisY, -hz + 0.2));
  return g;
}

function clockHub({ part }: PieceContext): THREE.Object3D {
  const [r, hh] = part.size;
  const brass = mat('brass', '#d6a443');
  return group(
    cyl(r, r * 1.1, hh * 2, brass),
    at(new THREE.Mesh(new THREE.SphereGeometry(r * 0.8, 20, 12), brass), 0, hh, 0),
  );
}

function clockHand({ part, index, poses0 }: PieceContext): THREE.Object3D {
  const [, hh] = part.size;
  // Bar frame: local Y runs along the bar, local +X is up. Find which end points away from the hub.
  const hub = new THREE.Vector3(...poses0[0].pos);
  const me = new THREE.Vector3(...poses0[index].pos);
  const q = new THREE.Quaternion(...poses0[index].quat);
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const out = Math.sign(axis.dot(me.sub(hub))) || 1;
  const ink = mat('plastic', '#1f1d26');
  const red = mat('plastic', index % 2 ? '#e5484d' : '#1f1d26');
  const g = group(box(0.22, hh * 2 * 0.92, 0.42, ink));
  const tip = box(0.22, 1.0, 1.0, red);
  tip.rotation.x = Math.PI / 4;
  g.add(at(tip, 0, out * (hh - 0.2), 0));
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.11, 8, 20), ink);
  tail.rotation.y = Math.PI / 2;
  g.add(at(tail, 0, -out * (hh - 0.5), 0));
  return g;
}

function spoolPiece({ part, entity }: PieceContext): THREE.Object3D {
  const [r, hh] = part.size;
  const woodM = mat('wood', '#e2b77e');
  return group(
    cyl(r * 0.92, r * 0.92, hh * 2 * 0.84, mat('rubber', pick(THREADS, entity.id)), 32),
    at(cyl(r * 1.12, r * 1.12, 0.16, woodM), 0, hh - 0.08, 0),
    at(cyl(r * 1.12, r * 1.12, 0.16, woodM), 0, -hh + 0.08, 0),
    at(cyl(r * 0.22, r * 0.22, 0.02, mat('plastic', '#3a2a1c'), 16), 0, hh + 0.005, 0),
  );
}

function cradleBall({ part }: PieceContext): THREE.Object3D {
  const [r] = part.size;
  const chrome = mat('chrome', '#eef0f5');
  return group(
    new THREE.Mesh(new THREE.SphereGeometry(r, 40, 24), chrome),
    at(cyl(r * 0.18, r * 0.24, r * 0.3, chrome, 16), 0, r * 0.98, 0),
  );
}

function stringPiece({ part }: PieceContext): THREE.Object3D {
  return cyl(0.035, 0.035, part.size[1] * 2, mat('plastic', '#3b3640'), 6);
}

function gatePiece({ part, index }: PieceContext): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  if (index <= 1) {
    // Felt-tip marker standing on its point: white barrel, coloured cap on top.
    const ink = index === 0 ? '#e5484d' : '#3a7bd5';
    const r = Math.min(hx, hz);
    const capH = Math.min(1.5, hy * 0.6);
    return group(
      at(cyl(r, r, hy * 2 - capH, mat('plastic', '#fbfaf6')), 0, -capH / 2, 0),
      at(cyl(r * 1.02, r * 1.02, 0.5, mat('plastic', ink)), 0, -hy * 0.2, 0),
      at(cyl(r * 1.1, r * 1.1, capH, mat('plastic', ink)), 0, hy - capH / 2, 0),
      at(
        new THREE.Mesh(new THREE.SphereGeometry(r * 1.1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('plastic', ink)),
        0,
        hy,
        0,
      ),
      at(box(0.12, capH * 0.9, r * 0.5, mat('plastic', ink)), r * 1.15, hy - capH / 2, 0),
    );
  }
  if (index === 2) {
    // Wooden ruler crossbar with a checkered banner hanging below.
    const w = hx * 2;
    const face = mat('wood', '#ffffff', repeated(ruler(), w / 10, 1));
    const plain = mat('wood', '#e7c27a');
    const r = box(w, hy * 2, hz * 2, [plain, plain, plain, plain, face, face]);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 2, 0.9),
      decalMat(repeated(checker(), (w - 2) / 1.8, 1), 'paper', false),
    );
    (banner.material as THREE.Material).side = THREE.DoubleSide;
    return group(r, at(banner, 0, -hy - 0.5, 0));
  }
  // Doors: index cards.
  return group(
    box(hx * 2, hy * 2, hz * 2, mat('paper', '#fffdf6')),
    at(new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hy * 2), decalMat(indexCard())), 0, 0, hz + 0.003),
  );
}

function dominoStack({ part, entity }: PieceContext): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  const g = new THREE.Group();
  const n = 3;
  const th = (hy * 2) / n;
  for (let i = 0; i < n; i++) {
    const a = (entity.id * 3 + i * 2) % 7;
    const b = (entity.id + i * 5) % 7;
    const d = group(
      rbox(hx * 2, th * 0.96, hz * 2, 0.08, mat('plastic', '#1b1a20')),
      topDecal(hx * 2 - 0.12, hz * 2 - 0.12, decalMat(dominoFace(a, b), 'plastic'), th * 0.48 + 0.003),
    );
    d.position.y = -hy + th * (i + 0.5);
    d.rotation.y = (i - 1) * 0.05;
    g.add(d);
  }
  return g;
}

function eraserPiece({ part }: PieceContext): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  return group(
    rbox(hx * 2, hy * 2, hz * 2, Math.min(0.18, hy * 0.9), mat('rubber', '#ff8fa6')),
    at(box(hx * 0.9, hy * 2 + 0.04, hz * 2 + 0.04, mat('paper', '#2f6fd6')), hx * 0.4, 0, 0),
    at(box(hx * 0.9, hy * 2 + 0.05, 0.12, mat('paper', '#ffffff')), hx * 0.4, 0, 0),
  );
}

function stickyPiece({ part, entity }: PieceContext): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  const forward = (entity.params.dir as number | undefined) !== -1;
  // a fading tile (drops away 3 s after someone steps on it) is a pale blue note
  const fading = entity.params.fade === true;
  const paper = fading ? '#9fdcff' : forward ? '#d6f05a' : '#ff9a8a';
  const ink = fading ? '#1d3f6c' : forward ? '#1d5c3a' : '#8a1f2d';
  const decal = topDecal(hx * 2 - 0.04, hz * 2 - 0.04, decalMat(stickyNote(paper, ink)), hy + 0.003);
  if (!forward) decal.rotation.z = Math.PI;
  const g = group(box(hx * 2, hy * 2, hz * 2, mat('paper', paper)), decal);
  g.rotation.y = (((entity.id * 37) % 9) - 4) * 0.008;
  return g;
}

function toasterPiece({ part, index }: PieceContext): THREE.Object3D {
  const [hx, hy, hz] = half(part);
  if (index <= 1) {
    const chrome = mat('chrome', '#dfe3ea');
    return group(
      rbox(hx * 2, hy * 2, hz * 2, 0.3, chrome),
      at(box(0.14, 0.5, 0.36, mat('plastic', '#1f1d26')), hx + 0.06, hy * 0.3, 0),
    );
  }
  if (deskPainted()) {
    // In a theme a slice of toast reads as bread whatever its colour: draw a blast-door panel instead, an armoured
    // plate with ribs, a hazard band and a glowing energy strip along the top (same size, so it reads true).
    const plate = mat('chrome', '#4a4f5a');
    const rib = mat('plastic', '#23252c');
    const ribs = [-0.5, 0, 0.5].map((f) => at(box(0.18, hy * 2 - 0.4, hz * 2 + 0.12, rib), f * (hx * 2 - 0.8), 0, 0));
    return group(
      rbox(hx * 2, hy * 2, hz * 2, Math.min(0.12, hx * 0.1), plate),
      ...ribs,
      at(box(hx * 2 + 0.04, 0.35, hz * 2 + 0.16, mat('rubber', '#ffc21a')), 0, -hy + 0.5, 0),
      at(box(hx * 2 - 0.3, 0.16, hz * 2 + 0.2, mat('glow', '#66e0ff')), 0, hy - 0.25, 0),
    );
  }
  const crust = mat('rubber', '#a8662c');
  const inside = decalMat(toast());
  const face = (z: number) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 - 0.3, hy * 2 - 0.3), inside);
    p.position.z = z;
    if (z < 0) p.rotation.y = Math.PI;
    return p;
  };
  return group(rbox(hx * 2, hy * 2, hz * 2, Math.min(0.45, hx * 0.3), crust), face(-hz - 0.004), face(hz + 0.004));
}

function fanPiece({ part, index, poses0 }: PieceContext): THREE.Object3D {
  if (index === 0) {
    const [hx, hy, hz] = half(part);
    const body = mat('plastic', '#9fe3d4');
    const g = group(rbox(hx * 2, hy * 2, hz * 2, 0.35, body));
    // Vents on the back (-X).
    for (let k = -3; k <= 3; k++)
      g.add(at(box(0.04, 0.12, hz * 1.3, mat('plastic', '#3c6b62')), -hx - 0.01, k * 0.32, 0));
    // Cage around the rotor on the front (+X), fixed to the housing.
    const inv = new THREE.Matrix4()
      .compose(new THREE.Vector3(...poses0[0].pos), new THREE.Quaternion(...poses0[0].quat), new THREE.Vector3(1, 1, 1))
      .invert();
    const rotorAt = new THREE.Vector3(...poses0[1].pos).applyMatrix4(inv);
    const chrome = mat('chrome', '#e3e6ec');
    const cage = new THREE.Group();
    cage.position.copy(rotorAt);
    for (const rr of [1.4, 0.95, 0.5]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.05, 8, 40), chrome);
      ring.rotation.y = Math.PI / 2;
      cage.add(ring);
    }
    for (let k = 0; k < 4; k++) {
      const s = box(0.06, 2.8, 0.06, chrome);
      s.rotation.x = (k * Math.PI) / 4;
      cage.add(s);
    }
    cage.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), mat('plastic', '#ffcf3f')), 0.05, 0, 0));
    g.add(cage);
    return g;
  }
  // Rotor: three blades round the cylinder's axis (local Y).
  const blades = new THREE.Group();
  const bladeM = mat('plastic', '#ffffff');
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), bladeM);
    b.scale.set(0.42, 0.05, 0.62);
    b.position.set(Math.sin((k * Math.PI * 2) / 3) * 0.62, 0, Math.cos((k * Math.PI * 2) / 3) * 0.62);
    b.rotation.y = (k * Math.PI * 2) / 3;
    b.rotation.z = 0.35;
    blades.add(b);
  }
  return blades;
}

/** The art for one obstacle part, in the part's frame, or null to draw nothing. */
export function buildPiece(ctx: PieceContext): THREE.Object3D | null {
  const { entity, part, index } = ctx;
  switch (entity.kind) {
    case 'platform':
      return platform(ctx);
    case 'ramp':
      return ramp(ctx);
    case 'movingPlatform':
      return keycapPiece(ctx);
    case 'carousel':
      return polaroidPiece(ctx);
    case 'spinnerDisc':
      return vinylPiece(ctx);
    case 'bridge':
      return pencilPiece(ctx);
    case 'sweeper':
      return index === 0 ? clockHub(ctx) : clockHand(ctx);
    case 'bumper':
      return spoolPiece(ctx);
    case 'pendulum':
      return index === 0 ? cradleBall(ctx) : stringPiece(ctx);
    case 'gate':
      return gatePiece(ctx);
    case 'wall':
      return dominoStack(ctx);
    case 'bouncePad':
      return eraserPiece(ctx);
    case 'arrowTile':
      return index === 0 ? stickyPiece(ctx) : null;
    case 'slidingWall':
      return toasterPiece(ctx);
    case 'snowBlower':
      return fanPiece(ctx);
    default:
      if (!part.visible) return null;
      return part.shape === 'box'
        ? box(part.size[0] * 2, part.size[1] * 2, part.size[2] * 2, mat('plastic', '#ffcf3f'))
        : null;
  }
}

/**
 * Static decorations that belong to a whole obstacle, in world space: the clock face under a sweeper, the
 * toaster slot along a sliding wall.
 */
export function buildEntityExtras(entity: EntityDef): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const [x, y, z] = entity.pos;
  if (entity.kind === 'sweeper') {
    const r = ((entity.params.armLength as number | undefined) ?? 6) + 0.9;
    const face = new THREE.Mesh(new THREE.CircleGeometry(r, 72), decalMat(clockFace()));
    face.rotation.set(-Math.PI / 2, 0, -entity.yaw);
    face.position.set(x, y + 0.012, z);
    out.push(face);
  }
  if (entity.kind === 'slidingWall') {
    const w = (entity.params.width as number | undefined) ?? 20;
    const t = ((entity.params.thickness as number | undefined) ?? 0.6) + 0.6;
    const rail = group(
      box(w, 0.03, t, mat('chrome', '#dfe3ea')),
      at(box(w - 0.4, 0.01, t - 0.45, mat('plastic', '#141318')), 0, 0.016, 0),
    );
    rail.position.set(x, y + 0.015, z);
    rail.rotation.y = entity.yaw;
    out.push(rail);
  }
  return out;
}
