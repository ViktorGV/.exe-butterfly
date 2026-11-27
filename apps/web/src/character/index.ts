// Character (#8): the Wobbler, built from a SkinDef, plus the low-detail mesh and colours for the crowd.
import * as THREE from 'three';
import { buildLodGeometry } from './parts.ts';
import { normalizeSkin } from './skin.ts';

export { createWobbler, TURN_RATE, type Wobbler, type WobblerPose } from './wobbler.ts';
export { setPatternCanvasFactory, cacheStats, type PatternCanvas, type PatternCanvasFactory } from './cache.ts';
export { BUDGET, LOD_PART } from './parts.ts';
export { ANCHOR_POS } from './shape.ts';
export { normalizeSkin, DEFAULT_PARAMS, SKIN_LIMITS, type WobblerParams } from './skin.ts';
export { BLEND_SECONDS } from './animation.ts';

let lod: THREE.BufferGeometry | null = null;

/**
 * Shared low-detail Wobbler (<= 300 triangles) in rest pose, feet at the origin, facing -Z.
 * Its `part` attribute (see LOD_PART) says which skin colour each vertex takes. Do not dispose it.
 */
export function getLodGeometry(): THREE.BufferGeometry {
  return (lod ??= buildLodGeometry());
}

export interface InstanceColors {
  primary: THREE.Color;
  belly: THREE.Color;
  limbs: THREE.Color;
}

/** Per-instance colours for the crowd renderer. Pass `out` to reuse Color objects. */
export function skinToInstance(skin: unknown, out?: InstanceColors): InstanceColors {
  const p = normalizeSkin(skin);
  const o = out ?? { primary: new THREE.Color(), belly: new THREE.Color(), limbs: new THREE.Color() };
  o.primary.set(p.body.color);
  o.belly.set(p.body.belly);
  o.limbs.set(p.limbs.color);
  return o;
}
