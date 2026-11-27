import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { MATERIAL_SLOTS } from '@wobble/shared/constants';
import { assembleCourse, getObstacleKind } from '@wobble/shared';
import { fixtureCourse, fixtureRecipe, fixtureThemeV2 } from '@wobble/shared/fixtures/index';
import type { EntityDef, Pose, Prim, ThemeDefV2, Vec3 } from '@wobble/shared/types';
import { dressingCoverage, shouldHideBase } from './coverage.ts';
import { createDressingLayer } from './dressing.ts';
import type { ImageSource } from './images.ts';
import { applyThemeV2, computeAnchors, courseForTheme } from './index.ts';
import { insideBounds, landmarkPose, scatterOutside } from './layout.ts';
import { MAX_PARTICLES, THEME_QUALITY, decorCount, particleCount, pickImage } from './quality.ts';

const prim = (shape: Prim['shape'], pos: Prim['pos'], scale: Prim['scale']): Prim => ({
  shape,
  pos,
  rot: [0, 0, 0],
  scale,
  color: '#ffffff',
});

describe('anchors', () => {
  it('computes start, finish, checkpoints and side banners from the CourseDef', () => {
    const a = computeAnchors(fixtureCourse);
    expect(a.start.pos).toEqual([...fixtureCourse.spawn.pos]);
    expect(a.finish.pos).toEqual([...fixtureCourse.finish.pos]);
    expect(a.checkpoints).toHaveLength(fixtureCourse.checkpoints.length);
    expect(a.checkpoints[0].pos).toEqual([...fixtureCourse.checkpoints[0].volume.pos]);
    expect(a.sideBanners.length).toBeGreaterThanOrEqual(4);
    expect(a.sideBanners.length % 2).toBe(0);
    for (const b of a.sideBanners) expect(insideBounds(b.pos[0], b.pos[2], fixtureCourse.bounds)).toBe(false);
  });

  it('places every landmark outside the playable bounds', () => {
    for (const def of [fixtureCourse, assembleCourse(fixtureRecipe)]) {
      const course = courseForTheme(def);
      for (const anchor of ['start', 'finish', 'skylineLeft', 'skylineRight', 'midway'] as const) {
        const p = landmarkPose(anchor, course).pos;
        expect(insideBounds(p[0], p[2], def.bounds, 10)).toBe(false);
        expect(p[1]).toBeLessThan(def.killY);
      }
    }
  });
});

describe('decor scatter', () => {
  it('never places decor inside the bounds plus margin, and is deterministic', () => {
    const b = fixtureCourse.bounds;
    const pts = scatterOutside(500, b, 42, { margin: 6 });
    expect(pts).toHaveLength(500);
    for (const [x, z] of pts) expect(insideBounds(x, z, b, 6)).toBe(false);
    expect(scatterOutside(20, b, 42)).toEqual(scatterOutside(20, b, 42));
    expect(scatterOutside(20, b, 7)).not.toEqual(scatterOutside(20, b, 42));
  });
});

describe('quality scaling', () => {
  it('scales particles and decor down with the preset and clamps density', () => {
    expect(particleCount(1, THEME_QUALITY.high)).toBe(MAX_PARTICLES);
    expect(particleCount(0.5, THEME_QUALITY.low)).toBeLessThan(particleCount(0.5, THEME_QUALITY.medium));
    expect(particleCount(0.5, THEME_QUALITY.medium)).toBeLessThan(particleCount(0.5, THEME_QUALITY.high));
    expect(particleCount(5, THEME_QUALITY.high)).toBe(MAX_PARTICLES);
    expect(particleCount(-1, THEME_QUALITY.high)).toBe(0);
    expect(particleCount(Number.NaN, THEME_QUALITY.high)).toBe(0);
    expect(decorCount(0.4, THEME_QUALITY.low)).toBeLessThan(decorCount(0.4, THEME_QUALITY.high));
  });

  it('uses the @0.5x file on low quality, or a half-size decode when there is none', () => {
    const ref = { src: 'sky.webp', w: 4096, h: 2048, alpha: false, lowSrc: 'sky@0.5x.webp' };
    expect(pickImage(ref, THEME_QUALITY.low)).toEqual({ src: 'sky@0.5x.webp', scale: 1 });
    expect(pickImage(ref, THEME_QUALITY.high)).toEqual({ src: 'sky.webp', scale: 1 });
    expect(pickImage({ ...ref, lowSrc: null }, THEME_QUALITY.low)).toEqual({ src: 'sky.webp', scale: 0.5 });
  });
});

describe('hideBase coverage rule', () => {
  const ball = { shape: 'sphere' as const, size: [1.1, 0, 0] as [number, number, number] };
  it('measures coverage of the part bounds', () => {
    expect(dressingCoverage([prim('sphere', [0, 0, 0], [1.2, 1.2, 1.2])], ball)).toBe(1);
    expect(dressingCoverage([prim('box', [0, 0.55, 0], [1.1, 0.55, 1.1])], ball)).toBeCloseTo(0.5, 2);
    expect(dressingCoverage([prim('box', [5, 0, 0], [1, 1, 1])], ball)).toBe(0);
  });

  it('honours hideBase only when requested and coverage >= 80%', () => {
    const full = [prim('sphere', [0, 0, 0], [1.2, 1.2, 1.2])];
    const half = [prim('box', [0, 0.55, 0], [1.1, 0.55, 1.1])];
    expect(shouldHideBase({ hideBase: true, prims: full }, ball)).toBe(true);
    expect(shouldHideBase({ hideBase: false, prims: full }, ball)).toBe(false);
    expect(shouldHideBase({ hideBase: true, prims: half }, ball)).toBe(false);
    // Rotation is respected: a long thin box turned 90 degrees no longer covers a long thin part.
    const bar = { shape: 'box' as const, size: [3, 0.3, 0.3] as [number, number, number] };
    const along = { ...prim('box', [0, 0, 0], [3.1, 0.4, 0.4]) };
    expect(shouldHideBase({ hideBase: true, prims: [along] }, bar)).toBe(true);
    expect(shouldHideBase({ hideBase: true, prims: [{ ...along, rot: [0, Math.PI / 2, 0] }] }, bar)).toBe(false);
  });
});

const noImages: ImageSource = async () => null;
const fakeImages: ImageSource = async () => ({ width: 16, height: 16 }) as unknown as TexImageSource;

describe('applyThemeV2', () => {
  it('provides the ThemeRuntime shape and falls back cleanly when every image is missing', async () => {
    const scene = new THREE.Scene();
    const theme = applyThemeV2(fixtureThemeV2, {
      scene,
      baseUrl: '/x/',
      course: courseForTheme(fixtureCourse),
      imageSource: noImages,
      hudRoot: null,
    });
    for (const slot of MATERIAL_SLOTS) expect(theme.getMaterial(slot)).toBeInstanceOf(THREE.Material);
    expect(theme.getDressing('pendulum', 0)).not.toBeNull();
    expect(theme.getDressing('pendulum', 0)).toBe(theme.getDressing('pendulum', 0)!); // cached
    expect(theme.getDressing('sweeper', 0)).toBeNull();
    expect(theme.fx).toEqual(fixtureThemeV2.fx);
    await theme.ready;
    expect((theme.getMaterial('platformA') as THREE.MeshStandardMaterial).map).toBeNull();
    expect(theme.features.sky).not.toBeNull();
    expect(theme.features.signage!.children.every((c) => !c.visible)).toBe(true);
    theme.dispose();
    expect(scene.children).toHaveLength(0);
    expect(scene.fog).toBeNull();
  });

  it('treats 1x1 placeholder images (the fixture files) as missing', async () => {
    const tiny: ImageSource = async () => ({ width: 1, height: 1 }) as unknown as TexImageSource;
    const theme = applyThemeV2(fixtureThemeV2, {
      scene: new THREE.Scene(),
      baseUrl: '/',
      imageSource: tiny,
      hudRoot: null,
    });
    await theme.ready;
    expect((theme.getMaterial('platformA') as THREE.MeshStandardMaterial).map).toBeNull();
    theme.dispose();
  });

  it('swaps textures in as they load', async () => {
    const theme = applyThemeV2(fixtureThemeV2, {
      scene: new THREE.Scene(),
      baseUrl: '/',
      imageSource: fakeImages,
      hudRoot: null,
    });
    await theme.ready;
    expect((theme.getMaterial('platformA') as THREE.MeshStandardMaterial).map).toBeInstanceOf(THREE.Texture);
    expect(theme.features.signage!.children.every((c) => c.visible)).toBe(true);
    theme.dispose();
  });

  it('disposes every geometry, material and texture it created across 50 swaps', async () => {
    const created = new Set<object>();
    const disposed = new Set<object>();
    const protos = [THREE.BufferGeometry.prototype, THREE.Material.prototype, THREE.Texture.prototype];
    const saved = protos.map((proto) => ({ proto, original: proto.dispose }));
    for (const p of protos) {
      const original = p.dispose;
      p.dispose = function (this: object) {
        disposed.add(this);
        return original.call(this);
      };
    }
    try {
      const themes: ThemeDefV2[] = [
        fixtureThemeV2,
        { ...fixtureThemeV2, ground: { ...fixtureThemeV2.ground, kind: 'lava' }, particles: [] },
      ];
      const scene = new THREE.Scene();
      const before = new Set(collect(scene));
      for (let i = 0; i < 50; i++) {
        const theme = applyThemeV2(themes[i % 2], {
          scene,
          baseUrl: '/',
          imageSource: fakeImages,
          course: courseForTheme(fixtureCourse),
          hudRoot: null,
        });
        await theme.ready;
        for (const r of collect(scene)) if (!before.has(r)) created.add(r);
        theme.dispose();
      }
      expect(created.size).toBeGreaterThan(0);
      for (const r of created) expect(disposed.has(r)).toBe(true);
      expect(scene.children).toHaveLength(0);
    } finally {
      for (const { proto, original } of saved) proto.dispose = original;
    }
  });
});

/** Every geometry, material and texture reachable from the scene. */
function collect(scene: THREE.Scene): object[] {
  const out: object[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) out.push(mesh.geometry);
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      out.push(m);
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) out.push(v);
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (u) for (const x of Object.values(u)) if (x.value instanceof THREE.Texture) out.push(x.value);
    }
  });
  return out;
}

describe('dressing layer', () => {
  it('keeps dressing on moving parts with the same pose as the colliders', () => {
    const def = assembleCourse({
      ...fixtureRecipe,
      segments: [{ type: 'pendulumAlley', length: 'short', intensity: 3 }],
    });
    const pendulums = def.entities.filter((e) => e.kind === 'pendulum');
    expect(pendulums.length).toBeGreaterThan(0);
    const theme = applyThemeV2(fixtureThemeV2, {
      scene: new THREE.Scene(),
      baseUrl: '/',
      imageSource: noImages,
      hudRoot: null,
    });
    const layer = createDressingLayer({ getDressing: theme.getDressing, courseDef: def });
    const mesh = layer.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(pendulums.length);
    layer.update(0.8);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.distanceTo(new THREE.Vector3(...firstPartPose(pendulums[0], 0.8)))).toBeLessThan(1e-5);
    layer.dispose();
    theme.dispose();
  });
});

function firstPartPose(def: EntityDef, t: number): Vec3 {
  // The same registry call the course runtime uses for colliders.
  const kind = getObstacleKind(def.kind)!;
  const poses: Pose[] = kind.parts(def).map(() => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
  kind.pose(def, t, poses);
  return poses[0].pos;
}
