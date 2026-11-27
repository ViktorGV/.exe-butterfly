import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { MATERIAL_SLOTS } from '@wobble/shared/constants';
import { fixtureTheme } from '@wobble/shared/fixtures/index';
import type { Prim, ThemeDef } from '@wobble/shared/types';
import { DECOR_MARGIN, buildPropGeometry, scatterDecor } from './decor.ts';
import { type Bounds, type CanvasFactory, applyTheme, DEFAULT_BOUNDS, DEFAULT_THEME, resolveTheme } from './index.ts';
import { PATTERN_PX, type PatternCanvas } from './materials.ts';

// A stand-in 2D canvas so pattern textures get created without a DOM.
const fakeCanvas: CanvasFactory = (size) => {
  expect(size).toBeLessThanOrEqual(256);
  const ctx = { fillStyle: '', fillRect() {} } as unknown as PatternCanvas['ctx'];
  return { canvas: { width: size, height: size }, ctx };
};

const prim = (shape: Prim['shape'], color: string, x = 0): Prim => ({
  shape,
  pos: [x, 0, 0],
  rot: [0, 0, 0],
  scale: [1, 1, 1],
  color,
});

const loud: ThemeDef = {
  ...fixtureTheme,
  name: 'Neon Night',
  sky: { top: '#05001a', horizon: '#ff00aa', bottom: '#1a0033' },
  materials: {
    ...fixtureTheme.materials,
    platformA: {
      color: '#00ffcc',
      roughness: 0.2,
      metalness: 0.1,
      emissive: '#002211',
      pattern: { type: 'dots', colors: ['#00ffcc', '#ff00ff'], scale: 2 },
    },
    hazard: { color: '#ff0000', roughness: 0.4, metalness: 0 },
  },
  decor: Array.from({ length: 6 }, (_, i) => ({
    name: `prop${i}`,
    prims: [prim('sphere', '#ff00ff'), prim('box', '#00ffff', 1), prim('torus', '#ffff00', -1)],
    density: 1,
    minScale: 0.5,
    maxScale: 3,
  })),
};

function makeScene() {
  return new THREE.Scene();
}

/** Every geometry, material and texture reachable from the scene. */
function resources(scene: THREE.Scene) {
  const set = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) set.add(mesh.geometry);
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      set.add(m);
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) set.add(v);
    }
  });
  return set;
}

describe('applyTheme', () => {
  it('provides a MeshStandardMaterial per slot with the theme values', () => {
    const scene = makeScene();
    const rt = applyTheme(fixtureTheme, { scene, canvasFactory: fakeCanvas });
    for (const slot of MATERIAL_SLOTS) expect(rt.getMaterial(slot)).toBeInstanceOf(THREE.MeshStandardMaterial);
    const a = rt.getMaterial('platformA') as THREE.MeshStandardMaterial;
    expect(a.color.getHexString()).toBe('7ad7ff');
    expect(a.roughness).toBe(0.55);
    expect(a.map).toBeNull();
    const hazard = rt.getMaterial('hazard') as THREE.MeshStandardMaterial;
    expect(hazard.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(hazard.map?.wrapS).toBe(THREE.RepeatWrapping);
    expect((hazard.map?.image as { width: number }).width).toBe(PATTERN_PX);
    const bouncy = rt.getMaterial('bouncy') as THREE.MeshStandardMaterial;
    expect(bouncy.emissive.getHexString()).toBe('3d2a00');
    rt.dispose();
  });

  it('adds a sky dome, fog matched to the horizon, a hemisphere and one shadow-casting sun', () => {
    const scene = makeScene();
    const rt = applyTheme(fixtureTheme, { scene });
    const lights: THREE.Light[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) lights.push(o as THREE.Light);
    });
    expect(lights.filter((l) => l instanceof THREE.HemisphereLight)).toHaveLength(1);
    const suns = lights.filter((l) => l instanceof THREE.DirectionalLight);
    expect(suns).toHaveLength(1);
    expect(suns[0]?.castShadow).toBe(true);
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    expect((scene.fog as THREE.Fog).color.getHexString()).toBe('ffd9f2');
    const sky = scene.getObjectByName('theme:sky') as THREE.Mesh;
    expect(sky.material).toBeInstanceOf(THREE.ShaderMaterial);
    rt.dispose();
  });

  it('works without a canvas (patterns skipped) and without options beyond the scene', () => {
    const scene = makeScene();
    const rt = applyTheme(fixtureTheme, { scene });
    expect((rt.getMaterial('hazard') as THREE.MeshStandardMaterial).map).toBeNull();
    rt.dispose();
  });

  it('keeps material objects stable across hot-swaps and applies the new values', () => {
    const scene = makeScene();
    const rt = applyTheme(fixtureTheme, { scene, canvasFactory: fakeCanvas });
    const before = MATERIAL_SLOTS.map((s) => rt.getMaterial(s));
    rt.update(loud);
    MATERIAL_SLOTS.forEach((s, i) => expect(rt.getMaterial(s)).toBe(before[i] as THREE.Material));
    const a = rt.getMaterial('platformA') as THREE.MeshStandardMaterial;
    expect(a.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(a.emissive.getHexString()).toBe('002211');
    expect((rt.getMaterial('hazard') as THREE.MeshStandardMaterial).map).toBeNull();
    expect((scene.fog as THREE.Fog).color.getHexString()).toBe('ff00aa');
    expect(rt.theme.name).toBe('Neon Night');
    rt.dispose();
  });

  it('moves the shadow box with setShadowFocus, keeping the sun direction', () => {
    const scene = makeScene();
    const rt = applyTheme(fixtureTheme, { scene });
    const sun = scene.getObjectByName('theme:sun') as THREE.DirectionalLight;
    const offset = sun.position.clone().sub(sun.target.position);
    rt.setShadowFocus(5, 1, -300);
    expect(sun.target.position.toArray()).toEqual([5, 1, -300]);
    const offset2 = sun.position.clone().sub(sun.target.position);
    expect(offset2.distanceTo(offset)).toBeLessThan(1e-9);
    expect(offset.y).toBeGreaterThan(0); // sun is above, shining down
    rt.dispose();
  });

  it('draws all decor in at most 6 draw calls', () => {
    const scene = makeScene();
    const rt = applyTheme(loud, { scene });
    const decor = scene.getObjectByName('theme:decor') as THREE.Group;
    const meshes = decor.children as THREE.Mesh[];
    expect(meshes.length).toBe(6);
    for (const m of meshes) expect(m).toBeInstanceOf(THREE.InstancedMesh);
    // 7 decor kinds in the input are capped at 6.
    rt.update({ ...loud, decor: [...loud.decor, ...loud.decor] });
    expect(decor.children.length).toBeLessThanOrEqual(6);
    rt.dispose();
  });

  it('animates decor from tick() through one uniform, without per-instance updates', () => {
    const scene = makeScene();
    const rt = applyTheme(loud, { scene });
    const mesh = (scene.getObjectByName('theme:decor') as THREE.Group).children[0] as THREE.InstancedMesh;
    const version = mesh.instanceMatrix.version;
    rt.tick(12.5);
    expect(mesh.instanceMatrix.version).toBe(version);
    rt.dispose();
  });

  it('dispose removes everything it added and restores the scene', () => {
    const scene = makeScene();
    const keep = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(keep);
    const rt = applyTheme(loud, { scene, canvasFactory: fakeCanvas });
    const created = resources(scene);
    const slots = MATERIAL_SLOTS.map((s) => rt.getMaterial(s) as THREE.MeshStandardMaterial);
    for (const m of slots) {
      created.add(m);
      if (m.map) created.add(m.map);
    }
    const disposed = new Set<unknown>();
    for (const r of created) r.addEventListener('dispose', () => disposed.add(r));
    rt.dispose();
    expect(scene.children).toEqual([keep]);
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
    for (const r of created) if (r !== keep.geometry && r !== keep.material) expect(disposed.has(r)).toBe(true);
    expect(disposed.has(keep.geometry)).toBe(false);
    expect(slots.filter((m) => disposed.has(m))).toHaveLength(MATERIAL_SLOTS.length);
    rt.dispose(); // idempotent
  });

  it('does not leak after 50 theme swaps', () => {
    const scene = makeScene();
    const rt = applyTheme(fixtureTheme, { scene, canvasFactory: fakeCanvas });
    // Put every slot material in the scene, as a course would.
    for (const slot of MATERIAL_SLOTS) scene.add(new THREE.Mesh(new THREE.BoxGeometry(), rt.getMaterial(slot)));
    const live = new Set<unknown>();
    const seen = new Set<unknown>();
    const track = () => {
      for (const r of resources(scene)) {
        if (seen.has(r)) continue;
        seen.add(r);
        live.add(r);
        r.addEventListener('dispose', () => live.delete(r));
      }
    };
    track();
    const baseline = resources(scene).size;
    for (let i = 0; i < 50; i++) {
      rt.update(i % 2 ? fixtureTheme : loud);
      track();
    }
    rt.update(fixtureTheme);
    track();
    expect(resources(scene).size).toBe(baseline);
    // Everything ever created that is no longer in the scene has been disposed.
    const current = resources(scene);
    for (const r of live) expect(current.has(r as THREE.Texture)).toBe(true);
    expect(seen.size).toBeGreaterThan(baseline); // swaps did create and release resources
    rt.dispose();
  });
});

describe('resolveTheme fallbacks', () => {
  it('returns the default theme for garbage input', () => {
    for (const bad of [null, undefined, 42, 'theme', [], {}]) {
      const t = resolveTheme(bad);
      expect(t.sky).toEqual(DEFAULT_THEME.sky);
      expect(t.materials).toEqual(DEFAULT_THEME.materials);
      expect(t.light).toEqual(DEFAULT_THEME.light);
    }
  });

  it('replaces each invalid field with its default and clamps ranges', () => {
    const broken = {
      ...fixtureTheme,
      sky: { top: 'blue', horizon: '#123456' },
      fog: { color: '#000000', near: 300, far: 10 },
      light: { ...fixtureTheme.light, sunIntensity: Number.NaN, sunDir: [0, 1, 0], ambientIntensity: 99 },
      materials: {
        ...fixtureTheme.materials,
        platformA: { color: '#zzzzzz', roughness: 5, metalness: -1 },
        hazard: { ...fixtureTheme.materials.hazard, pattern: { type: 'plaid', colors: [], scale: 1 } },
        rail: undefined,
      },
      decor: [{ name: 'x', prims: [{ shape: 'blob' }], density: 1, minScale: 1, maxScale: 2 }, 'nope'],
    };
    const t = resolveTheme(broken);
    expect(t.sky).toEqual({ top: DEFAULT_THEME.sky.top, horizon: '#123456', bottom: DEFAULT_THEME.sky.bottom });
    expect(t.fog.far).toBeGreaterThan(t.fog.near);
    expect(t.light.sunIntensity).toBe(DEFAULT_THEME.light.sunIntensity);
    expect(t.light.sunDir).toEqual(DEFAULT_THEME.light.sunDir);
    expect(t.light.ambientIntensity).toBeLessThanOrEqual(4);
    expect(t.materials.platformA.color).toBe(DEFAULT_THEME.materials.platformA.color);
    expect(t.materials.platformA.roughness).toBe(1);
    expect(t.materials.platformA.metalness).toBe(0);
    expect(t.materials.hazard.pattern).toEqual(DEFAULT_THEME.materials.hazard.pattern);
    expect(t.materials.rail).toEqual(DEFAULT_THEME.materials.rail);
    expect(t.decor).toEqual([]);
  });

  it('applyTheme survives a broken theme', () => {
    const scene = makeScene();
    const rt = applyTheme({ name: 'broken' } as unknown as ThemeDef, { scene });
    for (const slot of MATERIAL_SLOTS) expect(rt.getMaterial(slot)).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((scene.fog as THREE.Fog).color.getHexString()).toBe(DEFAULT_THEME.sky.horizon.slice(1));
    rt.dispose();
  });
});

describe('decor scatter', () => {
  const bounds: Bounds = { min: [-12, -5, -300], max: [12, 15, 10] };

  it('is deterministic for a seed and differs between seeds', () => {
    const a = scatterDecor(42, 40, bounds, 2, 0.5, 2);
    const b = scatterDecor(42, 40, bounds, 2, 0.5, 2);
    const c = scatterDecor(43, 40, bounds, 2, 0.5, 2);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('never places a prop over the playable area', () => {
    for (let seed = 0; seed < 50; seed++) {
      const radius = 3;
      for (const p of scatterDecor(seed, 48, bounds, radius, 0.5, 4)) {
        // Distance from the prop centre to the bounds rectangle on XZ.
        const dx = Math.max(bounds.min[0] - p.x, 0, p.x - bounds.max[0]);
        const dz = Math.max(bounds.min[2] - p.z, 0, p.z - bounds.max[2]);
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(DECOR_MARGIN + radius * p.scale - 1e-9);
        expect(p.scale).toBeGreaterThanOrEqual(0.5);
        expect(p.scale).toBeLessThanOrEqual(4);
      }
    }
  });

  it('applyTheme scatters the same layout for the same theme and keeps instances off the course', () => {
    const run = () => {
      const scene = makeScene();
      const rt = applyTheme(loud, { scene, bounds });
      const meshes = (scene.getObjectByName('theme:decor') as THREE.Group).children as THREE.InstancedMesh[];
      const out = meshes.map((m) => Array.from(m.instanceMatrix.array));
      const radii = meshes.map((m) => {
        const s = m.geometry.boundingSphere as THREE.Sphere;
        return s.center.length() + s.radius;
      });
      const mat = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      meshes.forEach((m, k) => {
        for (let i = 0; i < m.count; i++) {
          m.getMatrixAt(i, mat);
          mat.decompose(pos, q, scl);
          const dx = Math.max(bounds.min[0] - pos.x, 0, pos.x - bounds.max[0]);
          const dz = Math.max(bounds.min[2] - pos.z, 0, pos.z - bounds.max[2]);
          expect(Math.hypot(dx, dz)).toBeGreaterThan((radii[k] as number) * scl.x);
        }
      });
      rt.dispose();
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('uses the default bounds when none are given', () => {
    expect(DEFAULT_BOUNDS.min[2]).toBeLessThan(DEFAULT_BOUNDS.max[2]);
  });

  it('merges a prop into one vertex-coloured geometry', () => {
    const g = buildPropGeometry([prim('sphere', '#ff0000'), prim('cone', '#00ff00', 2)]);
    expect(g.getAttribute('color')).toBeDefined();
    expect(g.getAttribute('aEmissive')).toBeDefined();
    expect(g.getAttribute('position').count).toBe(g.getAttribute('color').count);
    g.dispose();
  });
});
