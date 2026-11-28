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
uniform float uTime; uniform vec3 uPlanet; uniform vec3 uStreak;
varying vec3 vDir;
#define PI 3.141592653589793
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.6)) : mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.5));
  if (uHasMap > 0.5) {
    // The panorama covers the half dome ahead of the course (-Z), mirrored behind, so every pixel lands where
    // players look. The image's horizon (about 43% up, as the skybox prompt asks) sits on the real horizon:
    // it spans elevation -43..+57 degrees, its bottom row continues below so its ground meets the game's
    // ground with no hard edge, and only the very top fades into the gradient.
    float az = atan(d.x, -d.z);
    float fold = abs(az) > 0.5 * PI ? sign(az) * (PI - abs(az)) : az;
    float el = asin(clamp(h, -1.0, 1.0));
    vec2 uv = vec2(0.5 + fold / PI, clamp((el + 0.75) / 1.75, 0.002, 0.998));
    vec3 pano = texture2D(uMap, uv).rgb;
    float band = 1.0 - smoothstep(0.95, 1.2, el);
    col = mix(col, pano, band * uHasMap);
  }
  // Procedural spectacle on top of either sky, in the theme's own colours (stronger when there is no image).
  float up = smoothstep(0.02, 0.25, h);
  float amount = mix(1.0, 0.55, uHasMap);
  // Twinkling stars, brighter in dark skies.
  vec3 g = floor(d * 180.0);
  float star = step(0.9965, hash(g)) * (0.6 + 0.4 * sin(uTime * (1.5 + hash(g + 7.0) * 3.0) + hash(g) * 40.0));
  float dark = 1.0 - clamp(dot(col, vec3(0.299, 0.587, 0.114)) * 1.6, 0.0, 1.0);
  col += star * up * (0.25 + dark) * amount;
  // A giant planet or moon with a glowing rim and a ring band.
  vec3 pd = normalize(vec3(-0.55, 0.32, -0.77));
  float pa = acos(clamp(dot(d, pd), -1.0, 1.0));
  float body = smoothstep(0.2, 0.19, pa);
  float rim = smoothstep(0.26, 0.2, pa) * (1.0 - body);
  vec3 shade = uPlanet * (0.55 + 0.45 * clamp(dot(normalize(d - pd), vec3(0.6, 0.7, 0.2)) + 0.4, 0.0, 1.0));
  col = mix(col, shade, body * amount);
  col += uPlanet * rim * 0.6 * amount;
  vec3 rn = normalize(vec3(0.25, 1.0, 0.1));
  float ring = smoothstep(0.012, 0.0, abs(dot(d - pd, rn))) * smoothstep(0.42, 0.2, pa) * (1.0 - body);
  col = mix(col, uStreak, ring * 0.5 * amount);
  // Streaks crossing the sky: meteors, distant fighters, debris (four lanes, each on its own cycle).
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float cyc = uTime * (0.11 + fi * 0.03) + fi * 0.37;
    float k = floor(cyc);
    float t = fract(cyc);
    float az = hash(vec3(k, fi, 1.0)) * 2.0 * PI;
    float el = 0.25 + hash(vec3(k, fi, 2.0)) * 0.45;
    vec3 a = normalize(vec3(cos(az), el, sin(az)));
    vec3 b = normalize(vec3(cos(az + 0.9), el - 0.25, sin(az + 0.9)));
    vec3 head = normalize(mix(a, b, t));
    vec3 dir = normalize(b - a);
    vec3 rel = d - head;
    float along = dot(rel, dir);
    float across = length(rel - dir * along);
    float tail = smoothstep(-0.18, 0.0, along) * step(along, 0.0);
    float s = smoothstep(0.004, 0.0, across) * tail * smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.8, t);
    col += uStreak * s * 1.6 * up * amount;
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
        uTime: { value: 0 },
        uPlanet: { value: new THREE.Color(theme.hud.accent) },
        uStreak: { value: new THREE.Color(theme.fx.hit) },
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
    tex.wrapS = THREE.MirroredRepeatWrapping;
    // The sky is magnified on screen: skip mipmaps (they only blur it) and filter at full resolution.
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    material.uniforms.uMap.value = tex;
    material.uniforms.uHasMap.value = 1;
  });
  return mesh;
}
