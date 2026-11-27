// One stable MeshStandardMaterial per slot. Theme swaps recolour them in place, so course meshes never rebuild.
// Patterns are rasterised with drawPattern into a small CanvasTexture and sampled with world-space box UVs,
// so a stripe is the same width on a 2 m and a 30 m platform.
import * as THREE from 'three';
import { drawPattern } from '@wobble/shared';
import { MATERIAL_SLOTS } from '@wobble/shared/constants';
import type { MaterialDef, MaterialSlot, Pattern, ThemeDef } from '@wobble/shared/types';
import type { ThemeFeature } from './feature.ts';

/** Pattern texture size in pixels (phone budget: at most 256). */
export const PATTERN_PX = 128;
/** World size of one pattern tile at `pattern.scale === 1`, in metres. */
export const PATTERN_TILE_METRES = 2;

type PatternCtx = Parameters<typeof drawPattern>[0];
export interface PatternCanvas {
  canvas: unknown; // HTMLCanvasElement | OffscreenCanvas, or a stand-in under tests
  ctx: PatternCtx;
}
/** Makes a square 2D canvas; returns null where no canvas exists (patterns are then skipped). */
export type CanvasFactory = (sizePx: number) => PatternCanvas | null;

export const defaultCanvasFactory: CanvasFactory = (size) => {
  let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
  } else if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(size, size);
  }
  const ctx = canvas?.getContext('2d') as PatternCtx | null | undefined;
  return canvas && ctx ? { canvas, ctx } : null;
};

/** World-space box projection for the map, plus a soft sky-tinted rim for the toy look. */
function patchShader(material: THREE.MeshStandardMaterial, tile: { value: number }, rim: { value: THREE.Color }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTile = tile;
    shader.uniforms.uRim = rim;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBoxPos;\nvarying vec3 vBoxNormal;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  vec4 boxPos = vec4(transformed, 1.0);
  vec3 boxNormal = objectNormal;
  #ifdef USE_INSTANCING
    boxPos = instanceMatrix * boxPos;
    boxNormal = mat3(instanceMatrix) * boxNormal;
  #endif
  vBoxPos = (modelMatrix * boxPos).xyz;
  vBoxNormal = mat3(modelMatrix) * boxNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTile;\nuniform vec3 uRim;\nvarying vec3 vBoxPos;\nvarying vec3 vBoxNormal;',
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec3 boxN = abs(vBoxNormal);
  vec2 boxUv = boxN.x > boxN.y && boxN.x > boxN.z ? vBoxPos.zy : (boxN.y > boxN.z ? vBoxPos.xz : vBoxPos.xy);
  diffuseColor *= texture2D(map, boxUv * uTile);
#endif`,
      )
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight += uRim * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'wobble-theme-box-uv';
}

export interface MaterialsFeature extends ThemeFeature {
  get(slot: MaterialSlot): THREE.MeshStandardMaterial;
}

export function createMaterials(theme: ThemeDef, canvasFactory: CanvasFactory): MaterialsFeature {
  const materials = new Map<MaterialSlot, THREE.MeshStandardMaterial>();
  const tiles = new Map<MaterialSlot, { value: number }>();
  const rim = { value: new THREE.Color() };

  for (const slot of MATERIAL_SLOTS) {
    const m = new THREE.MeshStandardMaterial();
    m.name = `theme:${slot}`;
    const tile = { value: 1 / PATTERN_TILE_METRES };
    patchShader(m, tile, rim);
    materials.set(slot, m);
    tiles.set(slot, tile);
  }

  const makeTexture = (pattern: Pattern): THREE.Texture | null => {
    if (pattern.type === 'none') return null;
    const surface = canvasFactory(PATTERN_PX);
    if (!surface) return null;
    drawPattern(surface.ctx, pattern, PATTERN_PX);
    const tex = new THREE.CanvasTexture(surface.canvas as HTMLCanvasElement);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };

  const apply = (slot: MaterialSlot, def: MaterialDef): void => {
    const m = materials.get(slot) as THREE.MeshStandardMaterial;
    const old = m.map;
    const tex = def.pattern ? makeTexture(def.pattern) : null;
    // Patterns carry their own colours; the slot colour tints flat surfaces only.
    m.color.set(tex ? '#ffffff' : def.color);
    m.roughness = def.roughness;
    m.metalness = def.metalness;
    m.emissive.set(def.emissive ?? '#000000');
    m.map = tex;
    if (!!old !== !!tex) m.needsUpdate = true; // USE_MAP define changes; shader recompiles once
    old?.dispose();
    (tiles.get(slot) as { value: number }).value = 1 / (PATTERN_TILE_METRES * (def.pattern?.scale ?? 1));
  };

  const update = (t: ThemeDef): void => {
    rim.value.set(t.sky.top).multiplyScalar(0.18);
    for (const slot of MATERIAL_SLOTS) apply(slot, t.materials[slot]);
  };
  update(theme);

  return {
    get(slot) {
      return materials.get(slot) ?? (materials.get('platformA') as THREE.MeshStandardMaterial);
    },
    update,
    dispose() {
      for (const m of materials.values()) {
        m.map?.dispose();
        m.map = null;
        m.dispose();
      }
    },
  };
}
