// Game-feel effects (#29): one pooled THREE.Points cloud draws every particle effect in a single
// draw call. All buffers are preallocated; spawning and updating never allocate.
import * as THREE from 'three';
import type { RemoteState, Vec3 } from '@wobble/shared/types';
import { WIRE } from '@wobble/shared/constants';

/** Particle shapes, picked in the fragment shader. */
export const Shape = Object.freeze({ DOT: 0, STAR: 1, CONFETTI: 2, RING: 3 });

export const FX = Object.freeze({
  /** Hard cap on live particles; a full pool recycles the oldest. */
  maxParticles: 768,
  /** Remote players only get effects within this distance (metres) of the camera. */
  remoteNear: 18,
  /** Camera shake peak offset (metres) at strength 1. */
  shakeAmp: 0.12,
  /** Shake decay rate (1/s). */
  shakeDecay: 9,
  /** Max remote players tracked for edge detection. */
  maxRemote: 128,
});

export interface FxColors {
  confetti: readonly string[];
  checkpoint: string;
  hit: string;
}

export const DEFAULT_FX_COLORS: FxColors = Object.freeze({
  confetti: Object.freeze(['#ff5a7a', '#ffd23f', '#3fd0ff', '#7cff6b', '#c47bff']),
  checkpoint: '#ffe066',
  hit: '#ff8a3d',
});

export interface FxOptions {
  scene: THREE.Object3D;
  colors?: FxColors;
  /** Disables camera shake. Default: the prefers-reduced-motion media query (live). */
  reducedMotion?: boolean;
  random?: () => number;
}

export interface Fx {
  readonly object3d: THREE.Points;
  /** Live particle count. */
  readonly count: number;
  setColors(colors: FxColors | null | undefined): void;
  dust(pos: Readonly<Vec3>, strength?: number): void;
  ring(pos: Readonly<Vec3>): void;
  stars(pos: Readonly<Vec3>): void;
  sparkle(pos: Readonly<Vec3>): void;
  poof(pos: Readonly<Vec3>): void;
  confetti(pos: Readonly<Vec3>): void;
  /** Streaks trailing behind a diving player. */
  speedLines(pos: Readonly<Vec3>, vel: Readonly<Vec3>): void;
  /** Light camera shake (0..1); ignored under reduced motion. */
  shake(strength?: number): void;
  /** Reduced effects (land dust, respawn poof) for remote players near the camera. */
  watchRemote(remote: ReadonlyMap<number, RemoteState>, camPos: { x: number; y: number; z: number }): void;
  /** Advance particles; then offsets `camera` by the shake (call after the follow camera's update). */
  update(dt: number, camera?: THREE.Camera): void;
  clear(): void;
  dispose(): void;
}

const VERT = /* glsl */ `
attribute vec3 color;
attribute vec3 extra; // size, alpha, shape
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vColor = color;
  vAlpha = extra.y;
  vShape = extra.z;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = extra.x * 600.0 / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float a;
  if (vShape < 0.5) a = 1.0 - smoothstep(0.6, 1.0, r);
  else if (vShape < 1.5) { vec2 q = abs(p); a = 1.0 - smoothstep(0.05, 0.2, min(q.x, q.y) * 3.0 + r * 0.35 - 0.1); a *= step(r, 1.0); }
  else if (vShape < 2.5) a = step(abs(p.y), 0.45);
  else a = 1.0 - smoothstep(0.12, 0.25, abs(r - 0.8));
  a *= vAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor, a);
}`;

function reducedMotionQuery(): { matches: boolean } | null {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  if (typeof mm !== 'function') return null;
  try {
    return mm('(prefers-reduced-motion: reduce)');
  } catch {
    return null;
  }
}

export function createFx({ scene, colors, reducedMotion, random = Math.random }: FxOptions): Fx {
  const N = FX.maxParticles;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const extra = new Float32Array(N * 3);
  // simulation state (struct of arrays)
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N);
  const maxLife = new Float32Array(N);
  const size0 = new Float32Array(N);
  const grow = new Float32Array(N);
  const gravity = new Float32Array(N);
  const drag = new Float32Array(N);
  let count = 0;

  const geom = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  const extraAttr = new THREE.BufferAttribute(extra, 3).setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', posAttr);
  geom.setAttribute('color', colAttr);
  geom.setAttribute('extra', extraAttr);
  geom.setDrawRange(0, 0);
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;
  points.renderOrder = 10;
  points.name = 'fx';
  scene.add(points);

  // palette as linear RGB triples, rebuilt only on setColors
  const tmp = new THREE.Color();
  const confetti = new Float32Array(5 * 3);
  let confettiN = 1;
  const cpCol = new Float32Array(3);
  const hitCol = new Float32Array(3);
  const white = new Float32Array([1, 1, 1]);
  const dustCol = new Float32Array([0.85, 0.8, 0.72]);
  const poofCol = new Float32Array([0.95, 0.95, 1]);
  const lineCol = new Float32Array([1, 1, 1]);
  const putColor = (hex: string, out: Float32Array, o: number) => {
    tmp.set(hex);
    out[o] = tmp.r;
    out[o + 1] = tmp.g;
    out[o + 2] = tmp.b;
  };
  function setColors(c: FxColors | null | undefined) {
    const src = c ?? DEFAULT_FX_COLORS;
    confettiN = Math.max(1, Math.min(5, src.confetti.length));
    for (let i = 0; i < confettiN; i++) putColor(src.confetti[i] ?? '#ffffff', confetti, i * 3);
    putColor(src.checkpoint, cpCol, 0);
    putColor(src.hit, hitCol, 0);
  }
  setColors(colors);

  let oldest = 0;
  /** Index of a free slot; recycles round-robin when the pool is full. */
  function alloc(): number {
    if (count < N) return count++;
    oldest = (oldest + 1) % N;
    return oldest;
  }

  function spawn(
    p: Readonly<Vec3>,
    vx: number,
    vy: number,
    vz: number,
    lifeSec: number,
    size: number,
    growth: number,
    g: number,
    dr: number,
    shape: number,
    c: Float32Array,
    co: number,
  ) {
    const i = alloc();
    const i3 = i * 3;
    pos[i3] = p[0];
    pos[i3 + 1] = p[1];
    pos[i3 + 2] = p[2];
    vel[i3] = vx;
    vel[i3 + 1] = vy;
    vel[i3 + 2] = vz;
    col[i3] = c[co];
    col[i3 + 1] = c[co + 1];
    col[i3 + 2] = c[co + 2];
    extra[i3] = size;
    extra[i3 + 1] = 1;
    extra[i3 + 2] = shape;
    life[i] = lifeSec;
    maxLife[i] = lifeSec;
    size0[i] = size;
    grow[i] = growth;
    gravity[i] = g;
    drag[i] = dr;
  }

  const rnd = (a: number) => (random() * 2 - 1) * a;

  /** `n` particles flying out in a horizontal circle. */
  function radial(p: Readonly<Vec3>, n: number, speed: number, up: number, opts: number[], c: Float32Array) {
    const lifeSec = opts[0]!,
      size = opts[1]!,
      growth = opts[2]!,
      g = opts[3]!,
      dr = opts[4]!,
      shape = opts[5]!;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rnd(0.3);
      const s = speed * (0.7 + random() * 0.6);
      spawn(
        p,
        Math.sin(a) * s,
        up * (0.6 + random() * 0.8),
        Math.cos(a) * s,
        lifeSec,
        size,
        growth,
        g,
        dr,
        shape,
        c,
        0,
      );
    }
  }
  // option tuples, allocated once: life, size, growth, gravity, drag, shape
  const DUST = [0.5, 0.18, 0.5, -1, 4, Shape.DOT];
  const STAR = [0.6, 0.22, -0.2, 9, 2, Shape.STAR];
  const SPARK = [0.8, 0.16, -0.15, 3, 1.5, Shape.STAR];
  const POOF = [0.6, 0.35, 0.9, -1.5, 3.5, Shape.DOT];

  let shakeAmt = 0;
  let shakeT = 0;
  const motionQuery = reducedMotion === undefined ? reducedMotionQuery() : null;
  const reduced = () => reducedMotion ?? motionQuery?.matches ?? false;

  // remote edge detection: flags seen last time per id (fixed-size open table, no Map growth)
  const rIds = new Int32Array(FX.maxRemote).fill(-1);
  const rFlags = new Int32Array(FX.maxRemote);
  const rp: Vec3 = [0, 0, 0];
  function slotOf(id: number): number {
    let h = (id * 2654435761) >>> 0;
    for (let k = 0; k < FX.maxRemote; k++) {
      const s = (h + k) % FX.maxRemote;
      if (rIds[s] === id) return s;
      if (rIds[s] === -1) {
        rIds[s] = id;
        rFlags[s] = -1;
        return s;
      }
    }
    h = h % FX.maxRemote; // table full: share a slot
    rIds[h] = id;
    rFlags[h] = -1;
    return h;
  }

  const near2 = FX.remoteNear * FX.remoteNear;
  let watchCam = { x: 0, y: 0, z: 0 };
  /** Hoisted so watchRemote allocates no closure or entry arrays. */
  function visitRemote(r: RemoteState, id: number) {
    const s = slotOf(id);
    const was = rFlags[s]!;
    rFlags[s] = r.flags;
    if (was < 0) return;
    const dx = r.pos[0] - watchCam.x;
    const dy = r.pos[1] - watchCam.y;
    const dz = r.pos[2] - watchCam.z;
    if (dx * dx + dy * dy + dz * dz > near2) return;
    const rose = r.flags & ~was;
    if (rose & WIRE.FLAG_RESPAWNED) fx.poof(r.pos);
    else if (rose & WIRE.FLAG_GROUNDED) radial(r.pos, 4, 1.4, 0.6, DUST, dustCol);
  }

  const fx: Fx = {
    object3d: points,
    get count() {
      return count;
    },
    setColors,
    dust(p, strength = 1) {
      radial(p, Math.round(4 + 6 * Math.min(1, strength)), 1.6 * strength + 0.6, 0.8, DUST, dustCol);
    },
    ring(p) {
      // a flat expanding ring plus a few sparks
      spawn(p, 0, 0, 0, 0.35, 0.5, 6, 0, 0, Shape.RING, white, 0);
      radial(p, 8, 5, 2, STAR, hitCol);
    },
    stars(p) {
      const n = 7;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        spawn(
          p,
          Math.sin(a) * 2.5,
          3 + random() * 2,
          Math.cos(a) * 2.5,
          0.7,
          0.25,
          -0.2,
          9,
          1.5,
          Shape.STAR,
          hitCol,
          0,
        );
      }
    },
    sparkle(p) {
      radial(p, 14, 2.5, 3, SPARK, cpCol);
      // flag pop: confetti strips shooting up from the gate
      for (let k = 0; k < 6; k++) {
        const c = (k % confettiN) * 3;
        spawn(p, rnd(1.2), 6 + random() * 2, rnd(1.2), 0.9, 0.2, 0, 10, 1, Shape.CONFETTI, confetti, c);
      }
    },
    poof(p) {
      radial(p, 12, 2.2, 1.2, POOF, poofCol);
    },
    confetti(p) {
      for (let k = 0; k < 80; k++) {
        const c = (k % confettiN) * 3;
        spawn(p, rnd(5), 7 + random() * 6, rnd(5), 2.2 + random(), 0.18, 0, 6, 1.2, Shape.CONFETTI, confetti, c);
      }
    },
    speedLines(p, v) {
      for (let k = 0; k < 5; k++) {
        rp[0] = p[0] + rnd(0.4);
        rp[1] = p[1] + 0.6 + rnd(0.4);
        rp[2] = p[2] + rnd(0.4);
        const back = -0.5 - random() * 0.4;
        spawn(rp, v[0] * back, v[1] * back, v[2] * back, 0.25, 0.09, -0.2, 0, 0, Shape.DOT, lineCol, 0);
      }
    },
    shake(strength = 1) {
      if (reduced()) return;
      shakeAmt = Math.min(1, Math.max(shakeAmt, strength));
    },
    watchRemote(remote, cam) {
      watchCam = cam;
      remote.forEach(visitRemote);
    },
    update(dt, camera) {
      if (dt > 0) {
        for (let i = 0; i < count;) {
          life[i] = life[i]! - dt;
          if (life[i]! <= 0) {
            // swap-remove with the last live particle
            const j = --count;
            if (i !== j) copySlot(j, i);
            continue;
          }
          const i3 = i * 3;
          const d = Math.max(0, 1 - drag[i]! * dt);
          vel[i3] = vel[i3]! * d;
          vel[i3 + 1] = vel[i3 + 1]! * d - gravity[i]! * dt;
          vel[i3 + 2] = vel[i3 + 2]! * d;
          pos[i3] = pos[i3]! + vel[i3]! * dt;
          pos[i3 + 1] = pos[i3 + 1]! + vel[i3 + 1]! * dt;
          pos[i3 + 2] = pos[i3 + 2]! + vel[i3 + 2]! * dt;
          const k = life[i]! / maxLife[i]!; // 1 -> 0
          extra[i3] = Math.max(0.01, size0[i]! * (1 + grow[i]! * (1 - k)));
          extra[i3 + 1] = k < 0.4 ? k / 0.4 : 1;
          i++;
        }
        if (oldest >= count) oldest = 0;
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
        extraAttr.needsUpdate = true;
        geom.setDrawRange(0, count);
        points.visible = count > 0;
        shakeT += dt;
        shakeAmt = Math.max(0, shakeAmt - shakeAmt * FX.shakeDecay * dt - dt * 0.2);
      }
      if (camera && shakeAmt > 0 && !reduced()) {
        const a = FX.shakeAmp * shakeAmt * shakeAmt;
        camera.position.x += Math.sin(shakeT * 61) * a;
        camera.position.y += Math.sin(shakeT * 47 + 1.3) * a;
        camera.position.z += Math.sin(shakeT * 53 + 2.1) * a * 0.5;
      }
    },
    clear() {
      count = 0;
      oldest = 0;
      geom.setDrawRange(0, 0);
      points.visible = false;
      shakeAmt = 0;
      rIds.fill(-1);
    },
    dispose() {
      scene.remove(points);
      geom.dispose();
      material.dispose();
    },
  };

  function copySlot(from: number, to: number) {
    const f3 = from * 3;
    const t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      pos[t3 + k] = pos[f3 + k]!;
      vel[t3 + k] = vel[f3 + k]!;
      col[t3 + k] = col[f3 + k]!;
      extra[t3 + k] = extra[f3 + k]!;
    }
    life[to] = life[from]!;
    maxLife[to] = maxLife[from]!;
    size0[to] = size0[from]!;
    grow[to] = grow[from]!;
    gravity[to] = gravity[from]!;
    drag[to] = drag[from]!;
  }

  points.visible = false;
  return fx;
}
