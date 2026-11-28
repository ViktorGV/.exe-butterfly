// Slot materials with world-space (triplanar) texture mapping (#64): textures tile at a fixed
// density in metres, whatever the part size, and work for merged and instanced course meshes.
import * as THREE from 'three';
import { MATERIAL_SLOTS } from '@wobble/shared/constants';
import type { MaterialSlot, ThemeDefV2 } from '@wobble/shared/types';
import type { ResourceTracker, TextureLoaderV2 } from './images.ts';

/** Texture repeats per metre. */
export const TEXTURE_DENSITY = 0.25;
const WHITE = new THREE.Color('#ffffff');

const VERT_DECL = 'varying vec3 vTriPos;\nvarying vec3 vTriNormal;\n';
const VERT_BODY = /* glsl */ `
  vec4 triWorld = vec4(transformed, 1.0);
  vec3 triN = objectNormal;
  #ifdef USE_INSTANCING
    triWorld = instanceMatrix * triWorld;
    triN = mat3(instanceMatrix) * triN;
  #endif
  vTriPos = (modelMatrix * triWorld).xyz;
  vTriNormal = normalize(mat3(modelMatrix) * triN);
`;
const FRAG_MAP = /* glsl */ `
#ifdef USE_MAP
  vec3 triW = pow(abs(normalize(vTriNormal)), vec3(4.0));
  triW /= (triW.x + triW.y + triW.z);
  vec3 triP = vTriPos * uTriDensity;
  vec4 triTex = texture2D(map, triP.zy) * triW.x + texture2D(map, triP.xz) * triW.y + texture2D(map, triP.xy) * triW.z;
  diffuseColor *= triTex;
#endif
`;

/** Patch a standard material so `map` is sampled in world space. */
export function useWorldMapping(material: THREE.MeshStandardMaterial, density = TEXTURE_DENSITY) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTriDensity = { value: density };
    shader.vertexShader =
      VERT_DECL + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader =
      `${VERT_DECL}uniform float uTriDensity;\n` + shader.fragmentShader.replace('#include <map_fragment>', FRAG_MAP);
  };
  material.customProgramCacheKey = () => 'theme-v2-triplanar';
}

export function createSlotMaterials(theme: ThemeDefV2, loader: TextureLoaderV2, tracker: ResourceTracker) {
  const materials = new Map<MaterialSlot, THREE.MeshStandardMaterial>();
  for (const slot of MATERIAL_SLOTS) {
    const def = theme.materials[slot];
    const mat = tracker.track(
      new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: def.roughness,
        metalness: def.metalness,
        emissive: def.emissive ?? '#000000',
      }),
    );
    mat.name = `theme:${slot}`;
    useWorldMapping(mat);
    loader.load(
      def.texture,
      (tex) => {
        mat.map = tex;
        // The texture already carries the theme's colours; tinting it by the (often dark) slot colour too
        // multiplies dark by dark and turns floors black. Keep only a light tint.
        mat.color.set(def.color).lerp(WHITE, 0.75);
        mat.needsUpdate = true;
      },
      { repeat: true },
    );
    materials.set(slot, mat);
  }
  return materials;
}
