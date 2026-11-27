// Feature builders: each one adds to the scene, follows theme swaps and cleans up after itself.
// #64 (ThemeDef v2) plugs extra features in through `applyTheme(..., { features })`.
import type * as THREE from 'three';
import type { ThemeDef, Vec3 } from '@wobble/shared/types';

export interface ThemeFeature {
  /** Re-apply a (resolved) theme in place. */
  update(theme: ThemeDef): void;
  /** Per-frame hook; must not allocate. */
  tick?(timeSec: number): void;
  dispose(): void;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface ThemeFeatureContext {
  scene: THREE.Scene;
  renderer?: THREE.WebGLRenderer;
  /** Playable area; decor and other dressing stays outside it. */
  bounds: Bounds;
}

export type ThemeFeatureFactory = (theme: ThemeDef, ctx: ThemeFeatureContext) => ThemeFeature;
