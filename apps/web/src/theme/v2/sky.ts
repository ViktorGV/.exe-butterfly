// Sky dome (#64): a gradient that a panorama (equirectangular) fades into above the horizon.
// Gradient only while loading or when sky.image is null. Follows the camera; one draw call.
import * as THREE from 'three';
import type { ThemeDefV2 } from '@wobble/shared/types';
import type { ResourceTracker, TextureLoaderV2 } from './images.ts';

export const SKY_RADIUS = 220;

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.9999, p.w); // just inside the far plane, whatever its distance
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
uniform sampler2D uMap; uniform float uHasMap;
varying vec3 vDir;
#define PI 3.141592653589793
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.6)) : mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.5));
  if (uHasMap > 0.5) {
    vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(h, -1.0, 1.0)) / PI + 0.5);
    vec3 pano = texture2D(uMap, uv).rgb;
    col = mix(col, pano, smoothstep(-0.04, 0.12, h) * uHasMap);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky(theme: ThemeDefV2, loader: TextureLoaderV2, tracker: ResourceTracker) {
  const material = tracker.track(
    new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(theme.sky.top) },
        uHorizon: { value: new THREE.Color(theme.sky.horizon) },
        uBottom: { value: new THREE.Color(theme.sky.bottom) },
        uMap: { value: null },
        uHasMap: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  const mesh = new THREE.Mesh(tracker.track(new THREE.SphereGeometry(SKY_RADIUS, 32, 16)), material);
  mesh.name = 'theme:sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  loader.load(theme.sky.image, (tex) => {
    tex.wrapS = THREE.RepeatWrapping;
    material.uniforms.uMap.value = tex;
    material.uniforms.uHasMap.value = 1;
  });
  return mesh;
}
