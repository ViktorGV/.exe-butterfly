// Themed supports (#64): the desk map stands every solid floor on a stack of books. An event theme replaces the
// desk, so it gets the same structure in its own look: stacked blocks under each platform and ramp, from the
// ground up, drawn with the theme's textured slot materials (main blocks in `rail`, trim bands in `accent`), so
// every theme supports its course in its own style. Visual only; placement follows desk/scenery.ts.
import * as THREE from 'three';
import { getObstacleKind } from '@wobble/shared';
import type { CourseDef, MaterialSlot } from '@wobble/shared/types';

export interface ThemeSupports {
  group: THREE.Group;
  dispose(): void;
}

/** Deterministic random numbers, so every player sees the same stacks. */
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

interface Block {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  yaw: number;
}

/** Stacked blocks under the solid floors (platforms and ramps), from `groundY` up to each floor's underside. */
export function supportBlocks(course: CourseDef, groundY: number): Block[] {
  const r = rnd(7);
  const out: Block[] = [];
  for (const e of course.entities) {
    if (e.kind !== 'platform' && e.kind !== 'ramp') continue;
    // Real size from the obstacle registry (part 0 is the floor box; size is half extents).
    let half: readonly number[] = [5, 0.5, 5];
    try {
      half = getObstacleKind(e.kind)?.parts(e)[0]?.size ?? half;
    } catch {
      // keep the default
    }
    const size = [half[0] * 2, half[1] * 2, half[2] * 2];
    // A platform's top is at pos.y and it is size.y thick; a ramp starts at pos.y (as in desk/scenery.ts).
    const top = e.kind === 'platform' ? e.pos[1] - size[1] : e.pos[1];
    const n = Math.max(1, Math.round(size[0] / 20));
    const c = Math.cos(e.yaw);
    const s = Math.sin(e.yaw);
    for (let k = 0; k < n; k++) {
      const ox = (k - (n - 1) / 2) * (size[0] / n);
      const w = Math.min(size[0] / n, 18) * (0.6 + r() * 0.2);
      const d = Math.min(size[2], 14) * (0.6 + r() * 0.2);
      let y = groundY;
      while (y < top - 0.05) {
        const h = Math.min(top - y, 2.2 + r() * 1.8);
        out.push({ x: e.pos[0] + ox * c, y, z: e.pos[2] - ox * s, w, h, d, yaw: e.yaw + (r() - 0.5) * 0.12 });
        y += h;
      }
    }
  }
  return out;
}

/** A themed gate over each checkpoint: two posts and a crossbar, as blocks (posts and bar in rail, trim in accent). */
export function gateBlocks(course: CourseDef): Block[] {
  const out: Block[] = [];
  const H = 7.5;
  const post = 0.9;
  for (const cp of course.checkpoints) {
    const v = cp.volume;
    const base = v.pos[1] - v.half[1];
    const W = v.half[0] + 0.6;
    const c = Math.cos(v.yaw);
    const s = Math.sin(v.yaw);
    for (const side of [-1, 1]) {
      out.push({ x: v.pos[0] + side * W * c, y: base, z: v.pos[2] - side * W * s, w: post, h: H, d: post, yaw: v.yaw });
    }
    out.push({ x: v.pos[0], y: base + H, z: v.pos[2], w: W * 2 + post, h: 0.9, d: post, yaw: v.yaw });
  }
  return out;
}

export function createThemeSupports(opts: {
  course: CourseDef;
  groundY: number;
  getMaterial: (slot: MaterialSlot) => THREE.Material;
  /** Also build glowing gates over the checkpoints, in this colour (in place of the desk's paperclip arches). */
  gateColor?: string | null;
}): ThemeSupports {
  const group = new THREE.Group();
  group.name = 'theme:supports';
  const blocks = supportBlocks(opts.course, opts.groundY);
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0); // origin at the bottom face
  const body = new THREE.InstancedMesh(box, opts.getMaterial('rail'), Math.max(1, blocks.length));
  const trim = new THREE.InstancedMesh(box, opts.getMaterial('accent'), Math.max(1, blocks.length));
  body.name = 'theme:supports:body';
  trim.name = 'theme:supports:trim';
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  blocks.forEach((b, i) => {
    q.setFromAxisAngle(up, b.yaw);
    // Body slightly inset so the trim band at the top of each block reads as a seam between stacked blocks.
    body.setMatrixAt(i, m.compose(p.set(b.x, b.y, b.z), q, sc.set(b.w * 0.96, b.h, b.d * 0.96)));
    trim.setMatrixAt(i, m.compose(p.set(b.x, b.y + b.h - 0.18, b.z), q, sc.set(b.w, 0.18, b.d)));
  });
  body.count = trim.count = blocks.length;
  // Gates glow in the theme's checkpoint colour so a row of them reads as markers, not dark scaffolding.
  const gateList = opts.gateColor ? gateBlocks(opts.course) : [];
  const gateMat = new THREE.MeshStandardMaterial({
    color: opts.gateColor ?? '#ffffff',
    emissive: opts.gateColor ?? '#000000',
    emissiveIntensity: 0.9,
    roughness: 0.4,
    metalness: 0.3,
  });
  const gates = new THREE.InstancedMesh(box, gateMat, Math.max(1, gateList.length));
  gates.name = 'theme:supports:gates';
  gateList.forEach((b, i) => {
    q.setFromAxisAngle(up, b.yaw);
    gates.setMatrixAt(i, m.compose(p.set(b.x, b.y, b.z), q, sc.set(b.w, b.h, b.d)));
  });
  gates.count = gateList.length;
  for (const mesh of [body, trim, gates]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return {
    group,
    dispose() {
      group.removeFromParent();
      body.dispose();
      trim.dispose();
      gates.dispose();
      gateMat.dispose();
      box.dispose();
    },
  };
}
