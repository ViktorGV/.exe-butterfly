// Crumple, the paper storm: the Chain Reaction Desk's villain. In the butterfly effect a tiny flap grows into a
// storm, and this is that storm: a giant grumpy thundercloud of crumpled paper with folded-paper lightning bolts
// for arms. It floats over the last section and throws crumpled paper balls; a red circle on the floor shows
// where each ball will land a moment before it does. Visual only (the server decides who is thrown at).
import * as THREE from 'three';
import { mat } from './materials.ts';

export interface StormVillain {
  group: THREE.Group;
  /** Throw a paper ball at a floor point; it lands after `flightSec`, the warning circle shows from now. */
  throwAt(target: THREE.Vector3, flightSec?: number): void;
  update(t: number, dt: number): void;
  /** Drop every ball and circle in flight. */
  clear(): void;
  dispose(): void;
}

/** Smooth bumpy noise on the unit sphere: the same point always gets the same bump, so facets stay joined. */
function crumple(x: number, y: number, z: number, seed: number): number {
  return (
    Math.sin(x * 5.1 + seed) * Math.sin(y * 4.3 + seed * 2) * Math.sin(z * 4.7 + seed * 3) +
    0.5 * Math.sin(x * 11.3 - y * 9.1 + seed) * Math.sin(z * 10.7 + seed * 5)
  );
}

/** A crumpled-paper ball: a sphere pushed in and out in sharp facets, paler on top, stormy underneath. */
export function crumpledGeometry(radius: number, seed: number, detail = 3, amount = 0.14): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute('position');
  const col: number[] = [];
  const top = new THREE.Color('#fbf8ef');
  const under = new THREE.Color('#a7a3bf');
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const r = radius * (1 + amount * crumple(v.x, v.y, v.z, seed));
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
    c.copy(under).lerp(top, THREE.MathUtils.clamp(v.y * 0.6 + 0.6, 0, 1));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

const paperMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });

/** A folded-paper lightning bolt hanging down from its top (local origin), thickness along Z. */
function boltGeometry(scale: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const pts: [number, number][] = [
    [-0.6, 0],
    [1.4, 0],
    [0.6, -2.4],
    [1.9, -2.4],
    [-0.4, -6.6],
    [0.3, -3.4],
    [-1.0, -3.4],
  ];
  s.moveTo(pts[0][0] * scale, pts[0][1] * scale);
  for (const [x, y] of pts.slice(1)) s.lineTo(x * scale, y * scale);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.5 * scale,
    bevelEnabled: true,
    bevelSize: 0.08 * scale,
    bevelThickness: 0.08 * scale,
    bevelSegments: 1,
  });
  geo.translate(0, 0, -0.25 * scale);
  return geo;
}

interface Ball {
  mesh: THREE.Mesh;
  ring: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  flight: number;
  active: boolean;
  burst: THREE.Points;
  burstAt: number;
}

/** `ringRadius`: outer radius of the landing circle; pass the game's real hit radius. */
export function createStormVillain({ ringRadius = 2.1 }: { ringRadius?: number } = {}): StormVillain {
  const group = new THREE.Group();
  group.name = 'crumple';
  const body = new THREE.Group();
  group.add(body);

  // Cloud: big crumpled puffs, widest in the middle.
  const puffs: [number, number, number, number][] = [
    [0, 0, 0, 7.5],
    [-7, -1, 0.5, 5.5],
    [7, -0.8, 0.3, 5.8],
    [-3.5, 4.2, -0.5, 5.2],
    [3.8, 4.5, -0.8, 5],
    [-11.5, -2.4, -0.5, 3.6],
    [11.8, -2.2, -0.3, 3.8],
    [0, -3.5, 1.5, 5],
  ];
  const cloudMat = paperMat();
  puffs.forEach(([x, y, z, r], i) => {
    const m = new THREE.Mesh(crumpledGeometry(r, i * 1.7 + 0.3), cloudMat);
    m.position.set(x, y, z);
    m.rotation.set(i * 0.7, i * 1.3, i * 0.4);
    body.add(m);
  });

  // Angry marker face on the front (+Z, toward the racers coming up the course).
  const face = new THREE.Group();
  face.position.set(0, 0.6, 7.4);
  const ink = mat('plastic', '#1f1d26');
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1.35, 24, 16), mat('plastic', '#ffffff'));
    eye.scale.set(1, 1.15, 0.45);
    eye.position.set(s * 2.3, 0.8, 0);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12), ink);
    pupil.scale.set(1, 1, 0.5);
    pupil.position.set(s * 2.05, 0.55, 0.55);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), mat('glow', '#ffffff'));
    glint.position.set(s * 2.25, 0.8, 0.8);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.55, 0.5), ink);
    // Angry: the inner ends of the brows dip toward the nose.
    brow.position.set(s * 2.2, 2.45, 0.2);
    brow.rotation.z = s * 0.45;
    face.add(eye, pupil, glint, brow);
  }
  // A jagged, gritted frown: corners pulled down, zigzag in the middle.
  const mouthPts = [-2.4, -1.4, -0.6, 0.2, 1.0, 1.8, 2.4].map(
    (x, i) => new THREE.Vector3(x, -1.5 + (i % 2 ? 0.35 : -0.05) - Math.abs(x) * 0.28, 0.1),
  );
  const mouth = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mouthPts), 40, 0.22, 8), ink);
  face.add(mouth);
  body.add(face);

  // Lightning-bolt arms of folded yellow paper; they flash when it throws.
  const boltMat = new THREE.MeshStandardMaterial({
    color: '#ffd84d',
    roughness: 0.6,
    emissive: '#ffb800',
    emissiveIntensity: 0.15,
  });
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 9.5, -4.5, 1.5);
    const bolt = new THREE.Mesh(boltGeometry(1.15), boltMat);
    bolt.scale.x = s;
    pivot.add(bolt);
    body.add(pivot);
    return pivot;
  });

  // Paper-strip rain under the cloud.
  const rainCount = 60;
  const rain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.9, 0.04), mat('paper', '#9fc7ff'), rainCount);
  const rainSeed = Array.from({ length: rainCount }, (_, i) => [
    Math.sin(i * 12.9898) * 12,
    Math.cos(i * 78.233) * 4,
    (i * 0.137) % 1,
  ]);
  group.add(rain);

  // Thrown paper balls, each with a red landing circle and a puff of paper bits when it lands.
  const ringGeo = new THREE.RingGeometry(ringRadius * 0.67, ringRadius, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const balls: Ball[] = Array.from({ length: 6 }, (_, i) => {
    const mesh = new THREE.Mesh(crumpledGeometry(0.85, 10 + i, 2, 0.22), paperMat());
    mesh.visible = false;
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.85, depthWrite: false }),
    );
    ring.visible = false;
    const bits = new THREE.BufferGeometry();
    bits.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24 * 3), 3));
    const burst = new THREE.Points(bits, new THREE.PointsMaterial({ color: '#fbf8ef', size: 0.35 }));
    burst.visible = false;
    return {
      mesh,
      ring,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      start: 0,
      flight: 1.2,
      active: false,
      burst,
      burstAt: -1,
    };
  });
  const world = new THREE.Group(); // balls, rings and bursts live in world space, not under the moving cloud
  for (const b of balls) world.add(b.mesh, b.ring, b.burst);

  let now = 0;
  let flash = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const look = new THREE.Vector3();

  return {
    group,
    throwAt(target, flightSec = 1.3) {
      const b = balls.find((x) => !x.active) ?? balls[0];
      group.updateMatrixWorld();
      b.from.set(0, -2, 6).applyMatrix4(group.matrixWorld);
      b.to.copy(target);
      b.start = now;
      b.flight = flightSec;
      b.active = true;
      b.mesh.visible = true;
      b.ring.visible = true;
      b.ring.position.set(target.x, target.y + 0.04, target.z);
      flash = 1;
      look.copy(target);
    },
    update(t, dt) {
      now = t;
      if (!world.parent && group.parent) group.parent.add(world);
      // Float, breathe and lean toward the last target.
      body.position.y = Math.sin(t * 0.8) * 0.8;
      body.rotation.z = Math.sin(t * 0.55) * 0.05;
      const s = 1 + Math.sin(t * 1.6) * 0.025;
      body.scale.set(s, 1 / s, s);
      arms.forEach((a, i) => {
        a.rotation.z = (i ? -1 : 1) * (0.25 + Math.sin(t * 2.2 + i) * 0.12 + flash * 0.5);
      });
      flash = Math.max(0, flash - dt * 2);
      boltMat.emissiveIntensity = 0.15 + flash * 2.5 + (Math.sin(t * 23) > 0.96 ? 1.2 : 0);
      // Rain.
      for (let i = 0; i < rainCount; i++) {
        const [x, z, ph] = rainSeed[i];
        const u = (t * 0.6 + ph) % 1;
        p.set(x, -6 - u * 14, z + 1);
        m4.compose(p, q, sc);
        rain.setMatrixAt(i, m4);
      }
      rain.instanceMatrix.needsUpdate = true;
      // Balls in flight, warning circles, landing bursts.
      for (const b of balls) {
        if (b.active) {
          const u = (now - b.start) / b.flight;
          if (u >= 1) {
            b.active = false;
            b.mesh.visible = false;
            b.ring.visible = false;
            b.burst.visible = true;
            b.burstAt = now;
            b.burst.position.copy(b.to);
          } else {
            b.mesh.position.lerpVectors(b.from, b.to, u);
            b.mesh.position.y += Math.sin(u * Math.PI) * 9;
            b.mesh.rotation.set(u * 9, u * 7, 0);
            const pulse = 0.85 + Math.sin(now * 18) * 0.15;
            b.ring.scale.setScalar(pulse * (1.2 - u * 0.4));
          }
        }
        if (b.burst.visible) {
          const u = (now - b.burstAt) / 0.6;
          if (u >= 1) b.burst.visible = false;
          else {
            const a = b.burst.geometry.getAttribute('position');
            for (let k = 0; k < a.count; k++) {
              const ang = k * 2.39996;
              a.setXYZ(k, Math.cos(ang) * u * 3, Math.sin(k * 1.7) * 0.5 + u * 2 - u * u * 2.5, Math.sin(ang) * u * 3);
            }
            a.needsUpdate = true;
          }
        }
      }
    },
    clear() {
      for (const b of balls) {
        b.active = false;
        b.mesh.visible = false;
        b.ring.visible = false;
        b.burst.visible = false;
      }
    },
    dispose() {
      group.removeFromParent();
      world.removeFromParent();
    },
  };
}

/** The throw message the game receives (`docs/CONTRACTS.md` §6): impact (x, z) and landing time (server ms). */
export interface ThrowMessage {
  pos: readonly [number, number];
  landAt: number;
}

/**
 * Crumple as the game's villain view: the same calls as `createVillainView` (apps/web/src/villain), so the game
 * swaps one for the other. It floats high above the course just before the finish and throws paper balls that
 * land exactly where and when the server says.
 */
export function createStormVillainView({ scene, ringRadius }: { scene: THREE.Object3D; ringRadius: number }) {
  const storm = createStormVillain({ ringRadius });
  storm.group.visible = false;
  scene.add(storm.group);
  const target = new THREE.Vector3();
  let lastNow = 0;
  return {
    get bossVisible() {
      return storm.group.visible;
    },
    /** Show the storm hovering above and in front of the finish (`feetPos` = where a standing boss would be). */
    setBoss(feetPos: readonly [number, number, number]) {
      storm.group.position.set(feetPos[0], feetPos[1] + 19, feetPos[2] + 30);
      storm.group.visible = true;
    },
    throwAt(info: ThrowMessage, floorY: number, nowServerMs: number) {
      target.set(info.pos[0], floorY, info.pos[1]);
      storm.throwAt(target, Math.max(0.3, (info.landAt - nowServerMs) / 1000));
    },
    update(nowServerMs: number, frameDt: number) {
      lastNow = nowServerMs;
      storm.update(nowServerMs / 1000, frameDt);
    },
    reset() {
      storm.group.visible = false;
      storm.clear();
    },
    get lastUpdateMs() {
      return lastNow;
    },
    dispose() {
      storm.dispose();
    },
  };
}
