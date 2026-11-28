// One physical material for every sculpted racer mesh. The finish varies per vertex (attribute aFinish:
// roughness, metalness, clearcoat, glow), so plastic, fabric, brass and glowing parts share one draw call.
// Baked ambient occlusion (attribute aAO) darkens creases.
import * as THREE from 'three';

let shared: THREE.MeshPhysicalMaterial | null = null;

export function racerMaterial(): THREE.MeshPhysicalMaterial {
  if (shared) return shared;
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    sheen: 0.35,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color('#ffffff'),
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aFinish;\nattribute float aAO;\nvarying vec4 vFinish;\nvarying float vAO;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFinish = aFinish;\nvAO = aAO;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vFinish;\nvarying float vAO;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vFinish.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vFinish.y;')
      .replace('material.clearcoat = clearcoat;', 'material.clearcoat = clearcoat * vFinish.z;')
      // Sheen only on rough (fabric) parts.
      .replace(
        'material.sheenColor = sheenColor;',
        'material.sheenColor = sheenColor * smoothstep( 0.55, 0.85, vFinish.x ) * diffuseColor.rgb;',
      )
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += diffuseColor.rgb * vFinish.w;')
      .replace(
        '#include <aomap_fragment>',
        `
        float ambientOcclusion = vAO;
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        reflectedLight.directDiffuse *= mix( 1.0, ambientOcclusion, 0.55 );
        #if defined( USE_CLEARCOAT )
          clearcoatSpecularIndirect *= ambientOcclusion;
        #endif
        #if defined( USE_SHEEN )
          sheenSpecularIndirect *= ambientOcclusion;
        #endif
        #if defined( USE_ENVMAP )
          float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
          reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
        #endif
        `,
      );
  };
  shared = m;
  return m;
}
