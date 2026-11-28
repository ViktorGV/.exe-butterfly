// Scenery for the Chain Reaction Desk: the wooden desk far below the course, stacks of books holding the
// course up, paperclip checkpoint arches, the finish strip, giant desk objects for scale (mug, lamp, monitor,
// pencil cup, plant, scissors), a domino chain that topples along both sides (the butterfly effect) and paper
// butterflies. Also the lights: a warm window sun with shadows and the desk lamp.
import * as THREE from 'three';
import type { CourseDef, Volume } from '@wobble/shared/types';
import { decalMat, mat } from './materials.ts';
import { checker, repeated, ruler, screen, wing, wood } from './textures.ts';

export interface Scenery {
  sun: THREE.DirectionalLight;
  /** The school props (giant desk objects, paper butterflies): an event theme hides them for its landmarks. */
  props: THREE.Object3D[];
  /** School structure an event theme replaces with its own: book stacks and paperclip checkpoint arches. */
  school: THREE.Object3D[];
  update(t: number): void;
}

const COVERS = ['#c0392b', '#2e86de', '#27ae60', '#8e44ad', '#f39c12', '#16a085', '#e17055', '#6c5ce7', '#2d3436'];

function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** One instanced mesh of books (covers) and one of their page blocks. */
function bookShelf() {
  const covers: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const pages: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  return {
    add(x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, color: string) {
      q.setFromEuler(e.set(0, yaw, 0));
      covers.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + h / 2, z), q, new THREE.Vector3(w, h, d)));
      colors.push(new THREE.Color(color));
      const off = new THREE.Vector3(0.12, 0, 0).applyQuaternion(q);
      pages.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x + off.x, y + h / 2, z + off.z),
          q,
          new THREE.Vector3(w - 0.1, h * 0.8, d - 0.3),
        ),
      );
    },
    build(): THREE.Object3D[] {
      const unit = new THREE.BoxGeometry(1, 1, 1);
      const c = new THREE.InstancedMesh(unit, mat('plastic', '#ffffff'), covers.length);
      const p = new THREE.InstancedMesh(unit, mat('paper', '#f3ecd8'), pages.length);
      covers.forEach((m, i) => {
        c.setMatrixAt(i, m);
        c.setColorAt(i, colors[i]);
      });
      pages.forEach((m, i) => p.setMatrixAt(i, m));
      return [c, p];
    },
  };
}

/** A bent-wire paperclip standing up as an arch, width 2W, height H, in its XY plane. */
function paperclipArch(W: number, H: number): THREE.Mesh {
  const rr = Math.min(3, W * 0.2);
  const g = 1.8;
  const path = new THREE.CurvePath<THREE.Vector3>();
  const v = (x: number, y: number) => new THREE.Vector3(x, y, 0);
  const line = (a: THREE.Vector3, b: THREE.Vector3) => path.add(new THREE.LineCurve3(a, b));
  const turn = (a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3) =>
    path.add(new THREE.QuadraticBezierCurve3(a, c, b));
  line(v(-W, 0), v(-W, H - rr));
  turn(v(-W, H - rr), v(-W, H), v(-W + rr, H));
  line(v(-W + rr, H), v(W - rr, H));
  turn(v(W - rr, H), v(W, H), v(W, H - rr));
  line(v(W, H - rr), v(W, 1.4));
  turn(v(W, 1.4), v(W, 0.3), v(W - g / 2, 0.3));
  turn(v(W - g / 2, 0.3), v(W - g, 0.3), v(W - g, 1.4));
  line(v(W - g, 1.4), v(W - g, H - g - rr));
  turn(v(W - g, H - g - rr), v(W - g, H - g), v(W - g - rr, H - g));
  line(v(W - g - rr, H - g), v(-W + 2 * g + rr, H - g));
  turn(v(-W + 2 * g + rr, H - g), v(-W + 2 * g, H - g), v(-W + 2 * g, H - g - rr));
  line(v(-W + 2 * g, H - g - rr), v(-W + 2 * g, 2.6));
  return new THREE.Mesh(new THREE.TubeGeometry(path, 600, 0.22, 10, false), mat('chrome', '#e8ebf1'));
}

/** A row of washi-tape pennants hanging under a span from x = -W to W at height y. */
function pennants(W: number, y: number): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const hues = ['#ff7b6b', '#ffcf3f', '#6fd6a8', '#7ab8ff', '#c79bff', '#ff9ccf'];
  const c = new THREE.Color();
  let k = 0;
  for (let x = -W + 1; x < W - 1; x += 1.7, k++) {
    const sag = Math.sin(((x + W) / (2 * W)) * Math.PI) * 0.9;
    const top = y - sag;
    pos.push(x - 0.65, top, 0, x + 0.65, top, 0, x, top - 1.3, 0);
    c.set(hues[k % hues.length]);
    for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
  );
}

function place(o: THREE.Object3D, vol: Volume, y: number): THREE.Object3D {
  o.position.set(vol.pos[0], y, vol.pos[2]);
  o.rotation.y = vol.yaw;
  return o;
}

const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 40) =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);

export function buildScenery(course: CourseDef, root: THREE.Group): Scenery {
  const deskY = course.killY - 2;
  const zStart = course.bounds.max[2] + 10;
  const zEnd = course.bounds.min[2];
  const r = rnd(7);

  // --- the desk -------------------------------------------------------------------------------------
  const deskLen = zStart - zEnd + 260;
  const deskZ = (zStart + zEnd) / 2 - 30;
  const desk = new THREE.Mesh(
    new THREE.PlaneGeometry(340, deskLen),
    mat('wood', '#ffffff', repeated(wood(), 340 / 24, deskLen / 24)),
  );
  desk.rotation.x = -Math.PI / 2;
  desk.position.set(0, deskY, deskZ);
  desk.receiveShadow = true;
  root.add(desk);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(340, 6, 2), mat('wood', '#8a5a34'));
  edge.position.set(0, deskY - 3, deskZ + deskLen / 2);
  root.add(edge);

  // --- stacks of books under the solid floors -------------------------------------------------------
  const books = bookShelf();
  for (const e of course.entities) {
    if (e.kind !== 'platform' && e.kind !== 'ramp') continue;
    const size = (e.params.size as [number, number, number] | undefined) ?? [10, 1, 10];
    const top = e.kind === 'platform' ? e.pos[1] - size[1] : e.pos[1];
    const n = Math.max(1, Math.round(size[0] / 20));
    for (let k = 0; k < n; k++) {
      const ox = (k - (n - 1) / 2) * (size[0] / n);
      const bw = Math.min(size[0] / n, 18) * (0.6 + r() * 0.2);
      const bd = Math.min(size[2], 14) * (0.6 + r() * 0.2);
      let y = deskY;
      while (y < top - 0.05) {
        const h = Math.min(top - y, 1.3 + r() * 1.1);
        const c = Math.cos(e.yaw);
        const s = Math.sin(e.yaw);
        books.add(
          e.pos[0] + ox * c,
          y,
          e.pos[2] - ox * s,
          bw,
          h,
          bd,
          e.yaw + (r() - 0.5) * 0.25,
          COVERS[(r() * COVERS.length) | 0],
        );
        y += h;
      }
    }
  }
  const bookMeshes = books.build();
  root.add(...bookMeshes);
  const school: THREE.Object3D[] = [...bookMeshes];

  // --- checkpoints: paperclip arches with pennants; the finish: a checkered strip -------------------
  for (const cp of course.checkpoints) {
    const v = cp.volume;
    const base = v.pos[1] - v.half[1];
    const W = v.half[0] + 0.6;
    const H = 7.5;
    const g = new THREE.Group();
    g.add(paperclipArch(W, H), pennants(W - 2, H - 2.2));
    root.add(place(g, v, base));
    school.push(g);
  }
  const f = course.finish;
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(f.half[0] * 2, 2.4),
    decalMat(repeated(checker(), (f.half[0] * 2) / 2.4, 1)),
  );
  strip.rotation.x = -Math.PI / 2;
  const fg = new THREE.Group();
  strip.position.set(0, 0.02, f.half[2] - 1.2);
  fg.add(strip);
  root.add(place(fg, f, f.pos[1] - f.half[1]));

  const propsFrom = root.children.length;
  // --- giant desk objects for scale ----------------------------------------------------------------
  // Monitor at the far end, facing the start: the destination you run toward.
  const mon = new THREE.Group();
  const monW = 150;
  const monH = 86;
  mon.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(monW + 6, monH + 6, 4), mat('plastic', '#25232b'))));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(monW, monH), mat('glow', '#ffffff', screen()));
  scr.position.z = 2.05;
  mon.add(scr);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(10, 26, 6), mat('plastic', '#3a3842'));
  stand.position.set(0, -monH / 2 - 10, -4);
  mon.add(stand);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(46, 2, 30), mat('plastic', '#3a3842'));
  foot.position.set(0, -monH / 2 - 22, -4);
  mon.add(foot);
  mon.position.set(0, deskY + monH / 2 + 23, zEnd - 95);
  root.add(mon);

  // Coffee mug with steam.
  const mug = new THREE.Group();
  const mugM = mat('plastic', '#ff7b6b');
  mug.add(cyl(11, 10, 20, mugM, 48));
  const coffee = cyl(10.2, 10.2, 0.4, mat('plastic', '#4a2a17'), 48);
  coffee.position.y = 8.3;
  mug.add(coffee);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(5.2, 1.4, 12, 32), mugM);
  handle.position.set(-11, 0, 0);
  handle.rotation.y = Math.PI / 2;
  mug.add(handle);
  const band = cyl(11.05, 10.55, 3, mat('plastic', '#fff4e0'), 48);
  band.position.y = 3;
  mug.add(band);
  mug.position.set(-78, deskY + 10, -40);
  root.add(mug);
  const steamM = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false });
  const steam = Array.from({ length: 8 }, () => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), steamM.clone());
    root.add(s);
    return s;
  });

  // Desk lamp leaning over the course, with a warm spot.
  const lamp = new THREE.Group();
  const lampM = mat('plastic', '#ffcf3f');
  const lampBase = cyl(12, 13, 3, lampM);
  lampBase.position.set(85, deskY + 1.5, -150);
  lamp.add(lampBase);
  const j1 = new THREE.Vector3(85, deskY + 3, -150);
  const j2 = new THREE.Vector3(70, 38, -150);
  const j3 = new THREE.Vector3(26, 52, -150);
  const rod = (a: THREE.Vector3, b: THREE.Vector3) => {
    const m = cyl(1.3, 1.3, a.distanceTo(b), mat('chrome', '#d8dbe2'), 16);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  lamp.add(rod(j1, j2), rod(j2, j3));
  for (const j of [j2, j3]) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 10), lampM);
    k.position.copy(j);
    lamp.add(k);
  }
  const head = new THREE.Mesh(new THREE.ConeGeometry(11, 13, 32, 1, true), mat('plastic', '#ffcf3f'));
  (head.material as THREE.Material).side = THREE.DoubleSide;
  head.position.set(16, 47, -150);
  head.rotation.z = 0.5;
  lamp.add(head);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 10), mat('glow', '#fff3c4'));
  bulb.position.set(13, 43, -150);
  lamp.add(bulb);
  const spot = new THREE.SpotLight('#ffd9a0', 2.5, 160, 0.75, 0.6, 1.2);
  spot.position.copy(bulb.position);
  spot.target.position.set(0, 0, -150);
  lamp.add(spot, spot.target);
  root.add(lamp);

  // Pencil cup.
  const cup = new THREE.Group();
  cup.add(cyl(8, 7.5, 16, mat('plastic', '#3a7bd5'), 40));
  for (let k = 0; k < 7; k++) {
    const len = 34 + r() * 8;
    const p = cyl(1.1, 1.1, len, mat('plastic', ['#f6c330', '#e5484d', '#38b36b', '#8e5cd9'][k % 4]), 6);
    p.position.set(Math.sin(k * 0.9) * 3.5, len / 2 - 6, Math.cos(k * 0.9) * 3.5);
    p.rotation.set(Math.cos(k * 0.9) * 0.22, 0, -Math.sin(k * 0.9) * 0.22);
    cup.add(p);
  }
  cup.position.set(74, deskY + 8, -300);
  root.add(cup);

  // Potted plant.
  const plant = new THREE.Group();
  plant.add(cyl(9, 7, 13, mat('rubber', '#d9784a'), 32));
  for (let k = 0; k < 11; k++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mat('plastic', k % 2 ? '#3fae6a' : '#2f8f57'));
    const a = (k / 11) * Math.PI * 2;
    leaf.scale.set(2.4, 11 + r() * 5, 1.2);
    leaf.position.set(Math.sin(a) * 4, 13, Math.cos(a) * 4);
    leaf.rotation.set(Math.cos(a) * 0.45, a, -Math.sin(a) * 0.45);
    plant.add(leaf);
  }
  plant.position.set(-80, deskY + 6.5, -255);
  root.add(plant);

  // Scissors lying open on the desk.
  const sc = new THREE.Group();
  for (const s of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.6, 34), mat('chrome', '#dfe3ea'));
    blade.position.set(s * 2.5, 0, -14);
    blade.rotation.y = s * 0.16;
    sc.add(blade);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 1.1, 10, 28), mat('plastic', '#ff8a3d'));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(s * 5.5, 0, 6);
    sc.add(ring);
  }
  sc.position.set(-58, deskY + 0.6, -175);
  sc.rotation.y = 0.6;
  root.add(sc);

  // A long ruler and scattered sticky notes and paperclips on the desk.
  const rl = new THREE.Mesh(new THREE.BoxGeometry(10, 0.8, 130), [
    mat('wood', '#e7c27a'),
    mat('wood', '#e7c27a'),
    mat('wood', '#ffffff', repeated(ruler(), 1, 13)),
    mat('wood', '#e7c27a'),
    mat('wood', '#e7c27a'),
    mat('wood', '#e7c27a'),
  ]);
  rl.position.set(52, deskY + 0.4, -60);
  rl.rotation.y = -0.08;
  root.add(rl);
  for (let k = 0; k < 18; k++) {
    const n = new THREE.Mesh(
      new THREE.BoxGeometry(9, 0.08, 9),
      mat('paper', ['#fff07a', '#ff9ccf', '#8fe3ff', '#b9f07a'][k % 4]),
    );
    const side = k % 2 ? 1 : -1;
    n.position.set(side * (40 + r() * 70), deskY + 0.05, zStart - r() * (zStart - zEnd + 60));
    n.rotation.y = r() * Math.PI;
    root.add(n);
  }
  for (let k = 0; k < 8; k++) {
    const clip = paperclipArch(1.8, 9);
    clip.scale.setScalar(1);
    clip.rotation.set(-Math.PI / 2, 0, r() * Math.PI);
    const side = k % 2 ? 1 : -1;
    clip.position.set(side * (36 + r() * 50), deskY + 0.25, zStart - r() * (zStart - zEnd));
    root.add(clip);
  }

  const props = root.children.slice(propsFrom);
  // --- the domino chain: a wave of falling dominoes running down both sides -------------------------
  const spacing = 1.75;
  const domH = 3.4;
  const domT = 0.5;
  const sideX = 38;
  const count = Math.floor((zStart - zEnd) / spacing);
  const dominoes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.7, domH, domT),
    mat('plastic', '#ffffff'),
    count * 2,
  );
  for (let i = 0; i < count * 2; i++) dominoes.setColorAt(i, new THREE.Color(i % 2 ? '#1b1a20' : '#f7f2e6'));
  root.add(dominoes);
  school.push(dominoes);
  const waveSpeed = 22;
  const cycle = (zStart - zEnd) / waveSpeed + 5;
  const dm = new THREE.Matrix4();
  const dq = new THREE.Quaternion();
  const dp = new THREE.Vector3();
  const ds = new THREE.Vector3(1, 1, 1);
  const dx = new THREE.Vector3(1, 0, 0);
  const maxLean = Math.acos(spacing / domH) > 0 ? Math.PI / 2 - Math.acos((spacing - domT) / domH) : 1.2;

  const butterfliesFrom = root.children.length;
  // --- paper butterflies -----------------------------------------------------------------------------
  const flutter: {
    g: THREE.Group;
    l: THREE.Object3D;
    rr: THREE.Object3D;
    c: THREE.Vector3;
    rad: number;
    sp: number;
    ph: number;
  }[] = [];
  const wingGeo = new THREE.PlaneGeometry(2.6, 2.6);
  wingGeo.translate(1.3, 0, 0);
  wingGeo.rotateX(-Math.PI / 2);
  for (let k = 0; k < 26; k++) {
    const m = decalMat(wing((k * 47) % 360), 'paper', true);
    const g = new THREE.Group();
    const l = new THREE.Mesh(wingGeo, m);
    const rr = new THREE.Mesh(wingGeo, m);
    rr.scale.x = -1;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 1.4, 4, 8), mat('plastic', '#2b2440'));
    body.rotation.x = Math.PI / 2;
    g.add(l, rr, body);
    root.add(g);
    flutter.push({
      g,
      l,
      rr,
      c: new THREE.Vector3((r() - 0.5) * 70, 6 + r() * 14, zStart - r() * (zStart - zEnd)),
      rad: 5 + r() * 12,
      sp: (0.25 + r() * 0.35) * (k % 2 ? 1 : -1),
      ph: r() * Math.PI * 2,
    });
  }

  props.push(...root.children.slice(butterfliesFrom));
  // --- lights --------------------------------------------------------------------------------------
  root.add(new THREE.HemisphereLight('#fff4e6', '#8a6448', 1.1));
  const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
  sun.position.set(60, 90, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc2 = sun.shadow.camera;
  sc2.left = sc2.bottom = -70;
  sc2.right = sc2.top = 70;
  sc2.near = 1;
  sc2.far = 300;
  sun.shadow.bias = -0.0004;
  root.add(sun, sun.target);

  return {
    sun,
    props,
    school,
    update(t: number) {
      // Domino wave.
      const travel = (t % cycle) * waveSpeed;
      const resetting = t % cycle > cycle - 1.2;
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i < count; i++) {
          const s = i * spacing;
          let a = 0;
          if (!resetting) a = Math.min(maxLean, Math.max(0, (travel - s) / spacing) * maxLean);
          if (i === count - 1 && !resetting && travel > s) a = Math.min(Math.PI / 2, a * 1.6);
          const x = (side ? 1 : -1) * sideX;
          const z = zStart - s;
          dq.setFromAxisAngle(dx, -a);
          // Pivot at the bottom front edge (toward -Z).
          dp.set(0, domH / 2, domT / 2).applyQuaternion(dq);
          dp.add(new THREE.Vector3(x, deskY, z - domT / 2));
          dm.compose(dp, dq, ds);
          dominoes.setMatrixAt(side * count + i, dm);
        }
      }
      dominoes.instanceMatrix.needsUpdate = true;
      // Steam rising off the mug.
      steam.forEach((s, k) => {
        const u = (t * 0.25 + k / steam.length) % 1;
        s.position.set(
          mug.position.x + Math.sin(u * 6 + k) * 2.5,
          mug.position.y + 9 + u * 26,
          mug.position.z + Math.cos(u * 5 + k) * 2,
        );
        s.scale.setScalar(0.6 + u * 1.6);
        (s.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - u);
      });
      // Butterflies fly lazy loops, flapping.
      for (const b of flutter) {
        const a = t * b.sp + b.ph;
        b.g.position.set(b.c.x + Math.cos(a) * b.rad, b.c.y + Math.sin(a * 2.3) * 1.5, b.c.z + Math.sin(a) * b.rad);
        b.g.rotation.y = -a - (b.sp > 0 ? 0 : Math.PI);
        const flap = Math.sin(t * 14 + b.ph) * 0.9;
        b.l.rotation.z = flap;
        b.rr.rotation.z = -flap;
      }
    },
  };
}
