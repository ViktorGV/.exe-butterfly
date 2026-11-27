import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { Anim, PLAYER } from '@wobble/shared/constants';
import { fixtureSkin } from '@wobble/shared';
import type { Prim, SkinDef } from '@wobble/shared/types';
import {
  ANCHOR_POS,
  BUDGET,
  LOD_PART,
  cacheStats,
  createWobbler,
  getLodGeometry,
  setPatternCanvasFactory,
  skinToInstance,
  type Wobbler,
} from './index.ts';
import { BLEND_SECONDS } from './animation.ts';
import { triangles } from './geometry.ts';

// --- helpers ----------------------------------------------------------------------------------------------

const clone = (): SkinDef => structuredClone(fixtureSkin);
const EYES = ['dot', 'oval', 'sleepy', 'star', 'wide'] as const;
const MOUTHS = ['smile', 'o', 'flat', 'grin', 'none'] as const;
const SHAPES: Prim['shape'][] = ['sphere', 'box', 'cylinder', 'cone', 'torus', 'capsule'];

function meshes(w: Wobbler): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  w.object3d.traverse((o) => {
    if (o instanceof THREE.Mesh && o.visible) out.push(o);
  });
  return out;
}

function stats(w: Wobbler): { triangles: number; drawCalls: number } {
  let tris = 0;
  const list = meshes(w);
  for (const m of list) tris += triangles(m.geometry) * (m instanceof THREE.InstancedMesh ? m.count : 1);
  return { triangles: tris, drawCalls: list.length };
}

/** Body (lathe) mesh: the one with uv coordinates. */
const bodyMesh = (w: Wobbler): THREE.Mesh =>
  meshes(w).find((m) => m.geometry.getAttribute('uv') && !(m instanceof THREE.InstancedMesh))!;
const detailMesh = (w: Wobbler): THREE.Mesh =>
  meshes(w).find((m) => m.geometry.getAttribute('color') && m.material instanceof THREE.MeshLambertMaterial)!;
const limbMesh = (w: Wobbler): THREE.InstancedMesh =>
  meshes(w).find((m) => m instanceof THREE.InstancedMesh) as THREE.InstancedMesh;

function hasColor(g: THREE.BufferGeometry, hex: string): boolean {
  const c = new THREE.Color(hex);
  const a = g.getAttribute('color');
  for (let i = 0; i < a.count; i++) {
    if (Math.abs(a.getX(i) - c.r) < 1e-3 && Math.abs(a.getY(i) - c.g) < 1e-3 && Math.abs(a.getZ(i) - c.b) < 1e-3)
      return true;
  }
  return false;
}

/** Fake 2D canvas: records drawing so tests run without a DOM. */
function fakeCanvasFactory(log: string[]) {
  return (size: number) => {
    const ctx = {
      fillStyle: '',
      fillRect: (x: number, y: number, w: number, h: number) =>
        log.push(`fillRect ${ctx.fillStyle} ${x} ${y} ${w} ${h}`),
    };
    return { width: size, height: size, getContext: () => ctx };
  };
}

function worstCaseSkin(): SkinDef {
  const s = clone();
  s.face = { eyes: 'wide', eyeColor: '#000000', mouth: 'grin', cheeks: '#ff0000' };
  s.accessories = (['headTop', 'back', 'waist'] as const).map((anchor, a) => ({
    anchor,
    prims: Array.from({ length: 8 }, (_, i) => ({
      shape: (['torus', 'sphere', 'capsule'] as const)[(a + i) % 3],
      pos: [0, i * 0.02, 0] as [number, number, number],
      rot: [0, 0, 0] as [number, number, number],
      scale: [0.2, 0.2, 0.2] as [number, number, number],
      color: '#abcdef',
      ...(i % 2 ? { emissive: '#ffee00' } : {}),
    })),
  }));
  return s;
}

function variedSkin(i: number): SkinDef {
  const s = clone();
  const hex = (n: number) => `#${((n * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(-6)}`;
  s.body.color = hex(i + 1);
  s.body.belly = hex(i + 101);
  s.body.pattern = { type: i % 2 ? 'stripes' : 'none', colors: [hex(i + 201)], scale: 1 + (i % 3) };
  s.body.height = 0.85 + (i % 7) * 0.05;
  s.body.girth = 1.15 - (i % 5) * 0.06;
  s.face = {
    eyes: EYES[i % 5],
    mouth: MOUTHS[(i * 3) % 5],
    eyeColor: hex(i + 301),
    cheeks: i % 3 ? hex(i + 401) : null,
  };
  s.limbs.color = hex(i + 501);
  s.accessories = [
    {
      anchor: (['headTop', 'face', 'back', 'waist'] as const)[i % 4],
      prims: Array.from({ length: 1 + (i % 6) }, (_, k) => ({
        shape: SHAPES[(i + k) % SHAPES.length],
        pos: [0, k * 0.05, 0] as [number, number, number],
        rot: [0, k, 0] as [number, number, number],
        scale: [0.15, 0.15, 0.15] as [number, number, number],
        color: hex(i * 10 + k),
      })),
    },
  ];
  return s;
}

function allFinite(w: Wobbler): boolean {
  w.object3d.updateMatrixWorld(true);
  let ok = true;
  w.object3d.traverse((o) => {
    for (const e of o.matrixWorld.elements) if (!Number.isFinite(e)) ok = false;
    if (o instanceof THREE.InstancedMesh) for (const e of o.instanceMatrix.array) if (!Number.isFinite(e)) ok = false;
  });
  return ok;
}

const live: Wobbler[] = [];
function make(skin: unknown): Wobbler {
  const w = createWobbler(skin);
  live.push(w);
  return w;
}

afterEach(() => {
  for (const w of live.splice(0)) w.dispose();
  setPatternCanvasFactory(null);
});

beforeAll(() => {
  // Warm-up: build the skin-independent shared meshes and prim templates once.
  createWobbler(worstCaseSkin()).dispose();
  createWobbler(variedSkin(0)).dispose();
});

// --- budgets ----------------------------------------------------------------------------------------------

describe('budgets', () => {
  it('fixture Wobbler: <= 2,500 triangles and <= 4 draw calls', () => {
    const s = stats(make(fixtureSkin));
    console.log(`fixture Wobbler: ${s.triangles} triangles, ${s.drawCalls} draw calls`);
    expect(s.triangles).toBeLessThanOrEqual(BUDGET.triangles);
    expect(s.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  });

  it('every face variant stays inside the budget', () => {
    for (const eyes of EYES) {
      for (const mouth of MOUTHS) {
        const s = clone();
        s.face = { eyes, mouth, eyeColor: '#111111', cheeks: '#ff8899' };
        const st = stats(make(s));
        expect(st.triangles).toBeLessThanOrEqual(BUDGET.triangles);
        expect(st.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
      }
    }
  });

  it('worst case (3 accessories, 24 heavy prims, half emissive) stays inside the budget', () => {
    const s = stats(make(worstCaseSkin()));
    console.log(`worst-case Wobbler: ${s.triangles} triangles, ${s.drawCalls} draw calls`);
    expect(s.triangles).toBeLessThanOrEqual(BUDGET.triangles);
    expect(s.drawCalls).toBe(4);
  });

  it('accessory prims are merged: one detail mesh however many prims', () => {
    const plain = clone();
    plain.accessories = [];
    expect(stats(make(plain)).drawCalls).toBe(3);
    expect(stats(make(fixtureSkin)).drawCalls).toBe(3);
  });

  it('LOD geometry: <= 300 triangles, shared, with a part attribute', () => {
    const g = getLodGeometry();
    console.log(`LOD geometry: ${triangles(g)} triangles`);
    expect(triangles(g)).toBeLessThanOrEqual(BUDGET.lodTriangles);
    expect(getLodGeometry()).toBe(g);
    const part = g.getAttribute('part');
    const seen = new Set<number>();
    for (let i = 0; i < part.count; i++) seen.add(part.getX(i));
    expect([...seen].sort()).toEqual(Object.values(LOD_PART).sort());
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeLessThanOrEqual(PLAYER.height);
  });
});

// --- skin mapping -----------------------------------------------------------------------------------------

describe('skin to Wobbler', () => {
  it('maps body, belly, face, cheek and limb colours', () => {
    const s = clone();
    s.body.pattern = { type: 'none', colors: ['#000000'], scale: 1 };
    const w = make(s);
    expect((bodyMesh(w).material as THREE.MeshLambertMaterial).color.getHexString()).toBe('ff8a3d');
    expect((limbMesh(w).material as THREE.MeshLambertMaterial).color.getHexString()).toBe('e8702b');
    const g = detailMesh(w).geometry;
    expect(hasColor(g, '#ffe4b8')).toBe(true); // belly
    expect(hasColor(g, '#1d1b2f')).toBe(true); // eyes and mouth
    expect(hasColor(g, '#ff6b8b')).toBe(true); // cheeks
    expect(hasColor(g, '#4cc9f0')).toBe(true); // hat
  });

  it('omits cheeks when null', () => {
    const s = clone();
    s.face.cheeks = null;
    expect(hasColor(detailMesh(make(s)).geometry, '#ff6b8b')).toBe(false);
  });

  it('rasterises the pattern with drawPattern into a small shared CanvasTexture', () => {
    const log: string[] = [];
    setPatternCanvasFactory(fakeCanvasFactory(log));
    const a = make(fixtureSkin);
    const b = make(clone());
    const mat = bodyMesh(a).material as THREE.MeshLambertMaterial;
    expect(mat.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(bodyMesh(b).material).toBe(mat);
    const img = mat.map!.image as { width: number; height: number };
    expect(img.width).toBeLessThanOrEqual(256);
    expect(img.height).toBe(img.width);
    expect(log).toEqual([
      `fillRect #ff8a3d 0 0 ${img.width} ${img.width}`,
      `fillRect #ff8a3d 0 0 ${img.width} ${img.width}`,
    ]);
    expect(mat.color.getHexString()).toBe('ffffff');
  });

  it('falls back to a flat body colour when no canvas is available', () => {
    setPatternCanvasFactory(() => null);
    const mat = bodyMesh(make(fixtureSkin)).material as THREE.MeshLambertMaterial;
    expect(mat.map).toBeNull();
    expect(mat.color.getHexString()).toBe('ff8a3d');
  });

  it('every eye style and mouth gives distinct face geometry', () => {
    const sig = (eyes: SkinDef['face']['eyes'], mouth: SkinDef['face']['mouth']) => {
      const s = clone();
      s.face = { eyes, mouth, eyeColor: '#111111', cheeks: null };
      s.accessories = [];
      const g = detailMesh(make(s)).geometry;
      const p = g.getAttribute('position');
      let sum = 0;
      for (let i = 0; i < p.count; i++) sum += p.getX(i) * 3 + p.getY(i) * 7;
      return `${triangles(g)}:${sum.toFixed(4)}`;
    };
    expect(new Set(EYES.map((e) => sig(e, 'none'))).size).toBe(5);
    expect(new Set(MOUTHS.map((m) => sig('dot', m))).size).toBe(5);
  });

  it('height and girth scale the visuals only, and fit the player capsule', () => {
    const s = clone();
    s.accessories = [];
    const sizeOf = (h: number, g: number) => {
      s.body.height = h;
      s.body.girth = g;
      const w = make(s);
      w.object3d.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(w.object3d, true);
    };
    const base = sizeOf(1, 1);
    const big = sizeOf(1.15, 1.15);
    const small = sizeOf(0.85, 0.85);
    expect(big.max.y).toBeGreaterThan(base.max.y);
    expect(small.max.y).toBeLessThan(base.max.y);
    expect(big.max.y).toBeLessThanOrEqual(PLAYER.height);
    expect(base.min.y).toBeGreaterThan(-0.02);
    // Body within the capsule radius; the stubby arms may poke out by a couple of centimetres.
    for (const v of [base.max.x, -base.min.x, base.max.z, -base.min.z])
      expect(v).toBeLessThanOrEqual(PLAYER.radius + 0.02);
  });

  it('places accessory prims at their anchors', () => {
    for (const anchor of ['headTop', 'face', 'back', 'waist'] as const) {
      const s = clone();
      s.face.mouth = 'none';
      s.accessories = [
        {
          anchor,
          prims: [
            {
              shape: 'box',
              pos: [0, 0, 0],
              rot: [0, 0, 0],
              scale: [0.05, 0.05, 0.05],
              color: '#00ff00',
              emissive: '#00ff00',
            },
          ],
        },
      ];
      const glow = meshes(make(s)).find((m) => m.material instanceof THREE.MeshBasicMaterial)!;
      glow.geometry.computeBoundingBox();
      const c = glow.geometry.boundingBox!.getCenter(new THREE.Vector3());
      expect(c.distanceTo(new THREE.Vector3(...ANCHOR_POS[anchor]))).toBeLessThan(1e-4);
    }
  });

  it('a broken skin still builds a complete Wobbler', () => {
    for (const bad of [null, {}, { body: { color: 'nope', height: NaN }, accessories: [{ anchor: 'x' }] }]) {
      const w = make(bad);
      expect(stats(w).drawCalls).toBe(3);
      w.setPose({ pos: [0, 0, 0], yaw: 0, anim: Anim.RUN, speed: 5 }, 1 / 60);
      expect(allFinite(w)).toBe(true);
    }
  });
});

// --- caching ----------------------------------------------------------------------------------------------

describe('caching and reference-counted dispose', () => {
  it('Wobblers with the same skin share geometry, materials and textures', () => {
    setPatternCanvasFactory(fakeCanvasFactory([]));
    const a = make(fixtureSkin);
    const b = make(clone());
    expect(detailMesh(a).geometry).toBe(detailMesh(b).geometry);
    expect(bodyMesh(a).geometry).toBe(bodyMesh(b).geometry);
    expect(bodyMesh(a).material).toBe(bodyMesh(b).material);
    expect(limbMesh(a).material).toBe(limbMesh(b).material);
    expect(limbMesh(a).geometry).toBe(limbMesh(b).geometry);
    // A different limb colour shares the body and face, not the limb material.
    const s = clone();
    s.limbs.color = '#010203';
    const c = make(s);
    expect(bodyMesh(c).material).toBe(bodyMesh(a).material);
    expect(detailMesh(c).geometry).toBe(detailMesh(a).geometry);
    expect(limbMesh(c).material).not.toBe(limbMesh(a).material);
  });

  it('frees shared resources only when the last user is disposed', () => {
    setPatternCanvasFactory(fakeCanvasFactory([]));
    const before = cacheStats();
    const a = createWobbler(fixtureSkin);
    const b = createWobbler(clone());
    const geometry = detailMesh(a).geometry;
    const material = bodyMesh(a).material as THREE.MeshLambertMaterial;
    const texture = material.map!;
    const freed: string[] = [];
    geometry.addEventListener('dispose', () => freed.push('geometry'));
    material.addEventListener('dispose', () => freed.push('material'));
    texture.addEventListener('dispose', () => freed.push('texture'));
    expect(cacheStats()).toEqual({
      bodyMaterials: before.bodyMaterials + 1,
      limbMaterials: before.limbMaterials + 1,
      details: before.details + 1,
    });

    const scene = new THREE.Scene();
    scene.add(a.object3d);
    a.dispose();
    expect(a.object3d.parent).toBeNull();
    expect(freed).toEqual([]);
    a.dispose(); // idempotent: must not release b's reference
    expect(freed).toEqual([]);
    b.dispose();
    expect(freed.sort()).toEqual(['geometry', 'material', 'texture']);
    expect(cacheStats()).toEqual(before);
  });

  it('creates 24 Wobblers with different skins in < 50 ms after warm-up', () => {
    setPatternCanvasFactory(fakeCanvasFactory([]));
    const skins = Array.from({ length: 24 }, (_, i) => variedSkin(i + 1));
    const t0 = performance.now();
    for (const s of skins) make(s);
    const ms = performance.now() - t0;
    console.log(`24 different Wobblers built in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(50);
    expect(cacheStats().details).toBeGreaterThanOrEqual(24);
  });
});

// --- animation --------------------------------------------------------------------------------------------

describe('animation', () => {
  const ALL = Object.values(Anim);

  it('every Anim state produces a finite pose, across transitions and speeds', () => {
    const w = make(fixtureSkin);
    for (const anim of ALL) {
      for (let f = 0; f < 90; f++) {
        w.setPose({ pos: [1, 2, 3], yaw: f * 0.1, anim, speed: (f % 10) * 1.2 }, 1 / 60);
        expect(allFinite(w)).toBe(true);
      }
    }
  });

  it('distinct states produce distinct poses', () => {
    const poses = ALL.map((anim) => {
      const w = make(fixtureSkin);
      for (let f = 0; f < 30; f++) w.setPose({ pos: [0, 0, 0], yaw: 0, anim, speed: PLAYER.runSpeed }, 1 / 60);
      w.object3d.updateMatrixWorld(true);
      return [...limbMesh(w).instanceMatrix.array, ...limbMesh(w).matrixWorld.elements].map((v) => v.toFixed(3)).join();
    });
    expect(new Set(poses).size).toBe(ALL.length);
  });

  it('ignores garbage input instead of producing NaN', () => {
    const w = make(fixtureSkin);
    w.setPose({ pos: [0, 0, 0], yaw: 0, anim: Anim.IDLE, speed: 0 }, 1 / 60);
    w.setPose({ pos: [NaN, 0, Infinity], yaw: NaN, anim: 99, speed: NaN }, NaN);
    w.setPose({ pos: [], yaw: Infinity, anim: -1, speed: -Infinity }, -5);
    w.setPose({ pos: [0, 0, 0], yaw: 0, anim: Anim.RUN, speed: 1e9 }, 1e9);
    expect(allFinite(w)).toBe(true);
  });

  it('blends between states over ~150 ms', () => {
    const dt = 1 / 120;
    const sample = (anim: number, frames: number) => {
      const w = make(fixtureSkin);
      for (let f = 0; f < 60; f++) w.setPose({ pos: [0, 0, 0], yaw: 0, anim: Anim.IDLE, speed: 0 }, dt);
      for (let f = 0; f < frames; f++) w.setPose({ pos: [0, 0, 0], yaw: 0, anim, speed: 0 }, dt);
      return (w.object3d.children[0] as THREE.Object3D).rotation.x; // body pitch
    };
    const full = sample(Anim.DIVE, 120);
    const half = sample(Anim.DIVE, Math.round(BLEND_SECONDS / 2 / dt));
    const done = sample(Anim.DIVE, Math.round(BLEND_SECONDS / dt) + 1);
    expect(full).toBeLessThan(-1.3);
    expect(half / full).toBeGreaterThan(0.35);
    expect(half / full).toBeLessThan(0.65);
    expect(done).toBeCloseTo(full, 5);
  });

  it('snaps yaw on the first pose, then turns smoothly the short way round', () => {
    const w = make(fixtureSkin);
    w.setPose({ pos: [0, 0, 0], yaw: 3, anim: Anim.IDLE, speed: 0 }, 1 / 60);
    expect(w.object3d.rotation.y).toBeCloseTo(3, 6);
    w.setPose({ pos: [0, 0, 0], yaw: -3, anim: Anim.IDLE, speed: 0 }, 1 / 60);
    const y = w.object3d.rotation.y;
    // The short way from 3 to -3 crosses +pi: yaw increases (or wraps), it never swings back through 0.
    expect(Math.abs(y)).toBeGreaterThan(3);
    for (let f = 0; f < 60; f++) w.setPose({ pos: [0, 0, 0], yaw: -3, anim: Anim.IDLE, speed: 0 }, 1 / 60);
    expect(w.object3d.rotation.y).toBeCloseTo(-3, 3);
  });

  it('places the feet at pos', () => {
    const w = make(fixtureSkin);
    w.setPose({ pos: [4, 5, -6], yaw: 0, anim: Anim.IDLE, speed: 0 }, 1 / 60);
    expect(w.object3d.position.toArray()).toEqual([4, 5, -6]);
  });
});

// --- crowd helpers ----------------------------------------------------------------------------------------

describe('skinToInstance', () => {
  it('returns primary, belly and limb colours', () => {
    const c = skinToInstance(fixtureSkin);
    expect(c.primary.getHexString()).toBe('ff8a3d');
    expect(c.belly.getHexString()).toBe('ffe4b8');
    expect(c.limbs.getHexString()).toBe('e8702b');
  });

  it('reuses the output object and falls back on broken skins', () => {
    const out = skinToInstance(fixtureSkin);
    const again = skinToInstance({ body: { color: 'bad' } }, out);
    expect(again).toBe(out);
    expect(again.primary.getHexString()).toBe('ff8a3d');
  });
});
