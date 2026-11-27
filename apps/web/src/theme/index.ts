// Theme renderer (#10): sky dome, fog, lights, patterned slot materials and instanced decor from a ThemeDef.
import type * as THREE from 'three';
import type { MaterialSlot, ThemeDef } from '@wobble/shared/types';
import { createDecor } from './decor.ts';
import type { Bounds, ThemeFeature, ThemeFeatureFactory } from './feature.ts';
import { createLights } from './lights.ts';
import { type CanvasFactory, createMaterials, defaultCanvasFactory } from './materials.ts';
import { resolveTheme } from './resolve.ts';
import { createSky } from './sky.ts';

export type { Bounds, ThemeFeature, ThemeFeatureContext, ThemeFeatureFactory } from './feature.ts';
export type { CanvasFactory } from './materials.ts';
export { DEFAULT_THEME, resolveTheme } from './resolve.ts';

/** Used when no course bounds are given: the fixture course's playable box. */
export const DEFAULT_BOUNDS: Bounds = { min: [-30, -12, -80], max: [30, 20, 20] };

export interface ApplyThemeOptions {
  scene: THREE.Scene;
  renderer?: THREE.WebGLRenderer;
  /** Playable area; decor is scattered around it, never over it. */
  bounds?: Bounds;
  /** Same as `bounds`, in the issue's `course: { bounds }` shape. `bounds` wins if both are given. */
  course?: { bounds: Bounds };
  /** Extra feature builders (ThemeDef v2, #64), updated and disposed with the core ones. */
  features?: ThemeFeatureFactory[];
  /** Canvas source for pattern textures. Defaults to a DOM / Offscreen canvas; patterns are skipped without one. */
  canvasFactory?: CanvasFactory;
}

export interface ThemeRuntime {
  /** Stable per slot for the runtime's whole life, across `update` swaps. */
  getMaterial(slot: MaterialSlot): THREE.Material;
  /** Obstacle dressing is #64; always null here. */
  getDressing(kind: string, part: string): THREE.Object3D | null;
  /** Resolves when the theme is fully built (everything is synchronous in v1). */
  ready: Promise<void>;
  /** Hot-swap to another theme in place. Materials keep their identity; nothing leaks. */
  update(themeDef: ThemeDef): void;
  /** Drive decor animation from the game clock. Without calls the wall clock is used. Allocation-free. */
  tick(timeSec: number): void;
  /** Centre the sun's shadow box (e.g. on the local player). Allocation-free. */
  setShadowFocus(x: number, y: number, z: number): void;
  /** The resolved theme currently shown. */
  readonly theme: ThemeDef;
  dispose(): void;
}

/** Kept for code written against the #2 seam. */
export type AppliedTheme = ThemeRuntime;

export function applyTheme(themeDef: ThemeDef, options: ApplyThemeOptions): ThemeRuntime {
  const { scene, renderer } = options;
  const bounds = options.bounds ?? options.course?.bounds ?? DEFAULT_BOUNDS;
  let theme = resolveTheme(themeDef);
  let manualClock = false;
  const features: ThemeFeature[] = [];

  const tick = (timeSec: number): void => {
    for (let i = 0; i < features.length; i++) features[i]?.tick?.(timeSec);
  };
  const onSkyFrame = (): void => {
    if (!manualClock) tick(performance.now() / 1000);
  };

  const materials = createMaterials(theme, options.canvasFactory ?? defaultCanvasFactory);
  const lights = createLights(scene, theme);
  features.push(materials, createSky(scene, theme, onSkyFrame), lights, createDecor(scene, theme, bounds));
  for (const factory of options.features ?? []) features.push(factory(theme, { scene, renderer, bounds }));

  let disposed = false;
  return {
    getMaterial: (slot) => materials.get(slot),
    getDressing: () => null,
    ready: Promise.resolve(),
    get theme() {
      return theme;
    },
    update(next) {
      if (disposed) return;
      theme = resolveTheme(next);
      for (const f of features) f.update(theme);
    },
    tick(timeSec) {
      manualClock = true;
      tick(timeSec);
    },
    setShadowFocus: (x, y, z) => lights.setShadowFocus(x, y, z),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (let i = features.length - 1; i >= 0; i--) features[i]?.dispose();
      features.length = 0;
    },
  };
}
