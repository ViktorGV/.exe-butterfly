// Theme renderer v2 (#64). See README.md.
//
//   const theme = applyThemeV2(themeDef, { scene, renderer, course: courseForTheme(courseDef), baseUrl });
//   const course = createCourseRuntime({ courseDef, theme, scene });   // theme.getDressing for #7
//   engine.onRender((_a, dt) => theme.update(dt, camera));
//   await theme.ready;                                                  // every image decoded (or missing)
//   theme.dispose();                                                    // leaks nothing; a new theme can follow
//
// Returns immediately with fallbacks (gradient sky, untextured slots, blob sprites, no signs) and
// swaps each image in as it decodes.
import * as THREE from 'three';
import type { MaterialSlot, ThemeDefV2 } from '@wobble/shared/types';
import type { QualityPreset } from '../../engine/quality.ts';
import { createDecor } from './decor.ts';
import { createDressingTemplates, type DressingTemplate } from './dressing.ts';
import { createGround } from './ground.ts';
import { createTextureLoader, createTracker, urlImageSource, type ImageSource } from './images.ts';
import { groundYOf, type ThemeCourse } from './layout.ts';
import { createSlotMaterials } from './materials.ts';
import { createParticleSystem } from './particles.ts';
import { THEME_QUALITY } from './quality.ts';
import { createLandmarks, createSignage } from './setPieces.ts';
import { createSky } from './sky.ts';

export { computeAnchors, courseForTheme, type ThemeAnchors, type ThemeCourse } from './layout.ts';
export { createDressingLayer, type DressingTemplate } from './dressing.ts';
export { shouldHideBase, dressingCoverage, HIDE_BASE_COVERAGE } from './coverage.ts';
export { THEME_QUALITY, type ThemeQuality } from './quality.ts';
export { urlImageSource, type ImageSource } from './images.ts';

export const THEME_FEATURES = [
  'sky',
  'lights',
  'textures',
  'ground',
  'particles',
  'landmarks',
  'decor',
  'sprites',
  'signage',
] as const;
export type ThemeFeature = (typeof THEME_FEATURES)[number];

export interface ApplyThemeV2Options {
  scene: THREE.Scene;
  renderer?: THREE.WebGLRenderer;
  course?: ThemeCourse;
  /** Folder of the theme's images, e.g. '/event/themes/<slug>/'. */
  baseUrl: string;
  quality?: QualityPreset;
  /** Overrides how images are fetched (demo, tests). Default: fetch from baseUrl. */
  imageSource?: ImageSource;
  /** Element that receives --hud-accent / --hud-font. Default document.documentElement. */
  hudRoot?: HTMLElement | null;
}

/** docs/CONTRACTS.md §9, plus update() and per-feature handles for the demo. */
export interface ThemeRuntime {
  getMaterial(slot: MaterialSlot): THREE.Material;
  getDressing(kind: string, partIndex: number): DressingTemplate | null;
  fx: ThemeDefV2['fx'];
  hud: ThemeDefV2['hud'];
  /** For audio.setMusic (#13). */
  music: ThemeDefV2['music'];
  ready: Promise<void>;
  /** Per frame: moves the sky and particles with the camera and advances animations. */
  update(dt: number, camera: THREE.Camera): void;
  /** Root object of each feature (null when the theme has none); toggle `.visible` to switch off. */
  features: Record<ThemeFeature, THREE.Object3D | null>;
  setFeature(feature: ThemeFeature, on: boolean): void;
  dispose(): void;
}

export const HUD_FONT_STACKS: Record<ThemeDefV2['hud']['font'], string> = {
  rounded: "'Nunito', 'Varela Round', ui-rounded, system-ui, sans-serif",
  blocky: "'Arial Black', Impact, system-ui, sans-serif",
  handwritten: "'Comic Neue', 'Segoe Print', 'Bradley Hand', cursive",
  pixel: "'Press Start 2P', ui-monospace, monospace",
  serif: "Georgia, 'Times New Roman', serif",
};

const DEFAULT_COURSE: ThemeCourse = {
  bounds: { min: [-16, -12, -200], max: [16, 10, 12] },
  anchors: {
    start: { pos: [0, 0, 0], quat: [0, 0, 0, 1] },
    finish: { pos: [0, 0, -190], quat: [0, 0, 0, 1] },
    checkpoints: [],
    sideBanners: [],
  },
};

export function applyThemeV2(theme: ThemeDefV2, opts: ApplyThemeV2Options): ThemeRuntime {
  const { scene, renderer } = opts;
  const course = opts.course ?? DEFAULT_COURSE;
  const quality = THEME_QUALITY[opts.quality ?? 'medium'];
  const tracker = createTracker();
  const loader = createTextureLoader(opts.imageSource ?? urlImageSource(opts.baseUrl), quality, renderer, tracker);
  const root = new THREE.Group();
  root.name = `theme:${theme.name}`;
  const groundY = groundYOf(course);

  // Slot materials; the 'textures' toggle swaps maps off without rebuilding.
  const materials = createSlotMaterials(theme, loader, tracker);
  const maps = new Map<MaterialSlot, THREE.Texture | null>();

  // Lights and fog (v1 fields; #10 will own these once it lands).
  const lights = new THREE.Group();
  lights.name = 'theme:lights';
  const hemi = new THREE.HemisphereLight(theme.sky.top, theme.light.ambient, theme.light.ambientIntensity);
  const sun = new THREE.DirectionalLight(theme.light.sun, theme.light.sunIntensity);
  const d = theme.light.sunDir;
  sun.position.set(-d[0], -d[1], -d[2]).normalize().multiplyScalar(40);
  lights.add(hemi, sun);
  const prevFog = scene.fog;
  const prevBackground = scene.background;
  scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
  scene.background = new THREE.Color(theme.sky.horizon);

  const sky = createSky(theme, loader, tracker);
  const ground = createGround(theme, groundY, tracker);
  const particles = theme.particles
    .slice(0, 2)
    .map((p) => createParticleSystem(p, quality, tracker))
    .filter((p) => p !== null);
  const particleGroup = new THREE.Group();
  particleGroup.name = 'theme:particles';
  for (const p of particles) particleGroup.add(p.points);
  const landmarks = createLandmarks(theme.landmarks, course, tracker);
  const decor = createDecor(theme.decor, course.bounds, groundY + 0.5, quality, loader, tracker);
  const signage = createSignage(theme.signage, course.anchors, loader, tracker);
  const dressing = createDressingTemplates(theme.dressing, tracker);

  const features: Record<ThemeFeature, THREE.Object3D | null> = {
    sky,
    lights,
    textures: null,
    ground: ground?.mesh ?? null,
    particles: particles.length ? particleGroup : null,
    landmarks,
    decor: decor.group.children.length ? decor.group : null,
    sprites: decor.spriteGroup.children.length ? decor.spriteGroup : null,
    signage: signage.children.length ? signage : null,
  };
  for (const f of THEME_FEATURES) if (features[f]) root.add(features[f]!);
  scene.add(root);

  // HUD handoff (#11).
  const hudRoot =
    opts.hudRoot !== undefined ? opts.hudRoot : typeof document !== 'undefined' ? document.documentElement : null;
  const prevHud = hudRoot
    ? [hudRoot.style.getPropertyValue('--hud-accent'), hudRoot.style.getPropertyValue('--hud-font')]
    : null;
  hudRoot?.style.setProperty('--hud-accent', theme.hud.accent);
  hudRoot?.style.setProperty('--hud-font', HUD_FONT_STACKS[theme.hud.font]);

  let time = 0;
  let disposed = false;
  const camPos = new THREE.Vector3();
  const size = new THREE.Vector2();
  const ready = loader.settled();

  return {
    getMaterial: (slot) => materials.get(slot) ?? materials.get('platformA')!,
    getDressing: (kind, partIndex) => dressing.get(kind, partIndex),
    fx: theme.fx,
    hud: theme.hud,
    music: theme.music,
    ready,
    features,
    update(dt, camera) {
      time += dt;
      camera.getWorldPosition(camPos);
      sky.position.copy(camPos);
      (sky.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      if (landmarks) landmarks.material.userData.glow.value = 0.8 + 0.35 * Math.sin(time * 1.7);
      ground?.update(time);
      const h = renderer ? renderer.getDrawingBufferSize(size).y : 800;
      for (let i = 0; i < particles.length; i++) particles[i].update(time, camPos, h);
      decor.update(time);
    },
    setFeature(feature, on) {
      if (feature === 'textures') {
        for (const [slot, mat] of materials) {
          if (!on && mat.map) maps.set(slot, mat.map);
          const next = on ? (maps.get(slot) ?? mat.map) : null;
          if (next !== mat.map) {
            mat.map = next;
            mat.needsUpdate = true;
          }
        }
        return;
      }
      const obj = features[feature];
      if (obj) obj.visible = on;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loader.dispose();
      scene.remove(root);
      root.clear();
      hemi.dispose();
      sun.dispose();
      for (const mesh of [...decor.group.children, ...decor.spriteGroup.children, ...signage.children])
        if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
      tracker.disposeAll();
      materials.clear();
      maps.clear();
      scene.fog = prevFog;
      scene.background = prevBackground;
      if (hudRoot && prevHud) {
        hudRoot.style.setProperty('--hud-accent', prevHud[0]);
        hudRoot.style.setProperty('--hud-font', prevHud[1]);
      }
    },
  };
}
