// Decor (#64): prim decor as one InstancedMesh per entry, sprite decor as instanced alpha-tested
// billboards with a soft idle sway. Everything is scattered outside the playable bounds.
import * as THREE from 'three';
import type { DecorV2 } from '@wobble/shared/types';
import type { ResourceTracker, TextureLoaderV2 } from './images.ts';
import { createRng, hashString, scatterOutside, type Bounds } from './layout.ts';
import { primsGeometry, primsMaterial } from './prims.ts';
import { decorCount, type ThemeQuality } from './quality.ts';

const spriteVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float size = length(instanceMatrix[0].xyz);
  vec3 toCam = cameraPosition - center; toCam.y = 0.0;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam + vec3(1e-4, 0.0, 0.0))));
  float sway = sin(uTime * 1.2 + center.x * 0.37 + center.z * 0.21) * 0.06 * position.y;
  vec3 w = center + right * (position.x + sway) * size + vec3(0.0, position.y * size, 0.0);
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const spriteFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uMap; uniform vec3 uTint;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb * uTint, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** A soft round blob, used until (or instead of) a sprite image: missing images still look intentional. */
export function fallbackSpriteTexture(tracker: ResourceTracker): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.65;
      const inside = dx * dx + dy * dy < 0.12 || (Math.abs(dx) < 0.04 && dy < 0);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = inside ? 255 : 0;
    }
  const tex = tracker.track(new THREE.DataTexture(data, n, n));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function placeInstances(mesh: THREE.InstancedMesh, d: DecorV2, bounds: Bounds, y: number, seed: number) {
  const points = scatterOutside(mesh.count, bounds, seed);
  const rng = createRng(seed ^ 0x9e3779b9);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const lo = Math.min(d.minScale, d.maxScale);
  const hi = Math.max(d.minScale, d.maxScale);
  points.forEach(([x, z], i) => {
    const k = lo + rng() * (hi - lo);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    mesh.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(k, k, k)));
  });
  mesh.count = points.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

export function createDecor(
  decor: readonly DecorV2[],
  bounds: Bounds,
  y: number,
  quality: ThemeQuality,
  loader: TextureLoaderV2,
  tracker: ResourceTracker,
) {
  const group = new THREE.Group();
  group.name = 'theme:decor';
  const spriteGroup = new THREE.Group();
  spriteGroup.name = 'theme:sprites';
  const spriteMaterials: THREE.ShaderMaterial[] = [];
  let fallback: THREE.DataTexture | null = null;
  decor.forEach((d, n) => {
    const count = decorCount(d.density, quality);
    if (count === 0) return;
    const seed = hashString(`${d.name}:${n}`);
    if (d.type === 'prims' && d.prims.length > 0) {
      const mesh = new THREE.InstancedMesh(
        tracker.track(primsGeometry(d.prims)),
        tracker.track(primsMaterial()),
        count,
      );
      mesh.name = `decor:${d.name}`;
      placeInstances(mesh, d, bounds, y, seed);
      group.add(mesh);
    } else if (d.type === 'sprite') {
      fallback ??= fallbackSpriteTexture(tracker);
      const aspect = d.image ? Math.min(4, Math.max(0.25, d.image.w / d.image.h)) : 1;
      const geometry = tracker.track(new THREE.PlaneGeometry(2 * aspect, 2));
      geometry.translate(0, 1, 0);
      const material = tracker.track(
        new THREE.ShaderMaterial({
          uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            { uTime: { value: 0 }, uMap: { value: null }, uTint: { value: new THREE.Color(1, 1, 1) } },
          ]),
          vertexShader: spriteVertex,
          fragmentShader: spriteFragment,
          side: THREE.DoubleSide,
          fog: true,
        }),
      );
      material.uniforms.uMap.value = fallback;
      if (!d.image) material.uniforms.uTint.value.set('#ffffff').multiplyScalar(0.9);
      loader.load(d.image, (tex) => (material.uniforms.uMap.value = tex));
      spriteMaterials.push(material);
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.name = `sprite:${d.name}`;
      placeInstances(mesh, d, bounds, y, seed);
      mesh.frustumCulled = false; // billboards: the instance bounds do not match the drawn quads
      spriteGroup.add(mesh);
    }
  });
  return {
    group,
    spriteGroup,
    update(time: number) {
      for (let i = 0; i < spriteMaterials.length; i++) spriteMaterials[i].uniforms.uTime.value = time;
    },
  };
}
