// Ground below the course (#64): one big animated shader plane per ground.kind, always below killY.
// It moves and shimmers so it never reads as a walkable floor. 'void' draws nothing.
import * as THREE from 'three';
import { GROUND_KINDS } from '@wobble/shared/constants';
import type { ThemeDefV2 } from '@wobble/shared/types';
import type { ResourceTracker } from './images.ts';

export const GROUND_SIZE = 1400;

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime; uniform float uMotion; uniform int uKind;
varying vec2 vXZ;
void main() {
  vec3 p = position;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vXZ = w.xz;
  float amp = (uKind == 1 || uKind == 4) ? 0.6 : (uKind == 3 ? 1.2 : 0.0);
  w.y += amp * uMotion * sin(w.x * 0.08 + uTime * 0.9) * cos(w.z * 0.07 + uTime * 0.7);
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor; uniform vec3 uEmissive; uniform float uTime; uniform float uMotion; uniform int uKind;
varying vec2 vXZ;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  float t = uTime * (0.2 + uMotion);
  vec2 p = vXZ * 0.04;
  vec3 col = uColor;
  float glow = 0.0;
  if (uKind == 1) {        // water: drifting ripples and bright crests
    float n = fbm(p * 3.0 + vec2(t * 0.3, t * 0.2)) + 0.5 * fbm(p * 6.0 - vec2(t * 0.4, 0.0));
    col = mix(uColor * 0.55, uColor * 1.35 + 0.1, smoothstep(0.55, 1.05, n));
  } else if (uKind == 2) { // lava: dark crust over glowing cracks
    float n = fbm(p * 2.0 + vec2(t * 0.05, t * 0.08));
    float crack = 1.0 - smoothstep(0.02, 0.09, abs(n - 0.5));
    col = mix(uColor * 0.25, uColor * 1.6, crack);
    glow = crack;
  } else if (uKind == 3) { // clouds: soft puffs drifting
    float n = fbm(p * 1.5 + vec2(t * 0.06, 0.0));
    col = mix(uColor * 0.78, uColor * 1.08, smoothstep(0.3, 0.8, n));
  } else if (uKind == 4) { // goo: slow blobs
    float n = fbm(p * 2.5 + vec2(sin(t * 0.3), cos(t * 0.2)));
    col = mix(uColor * 0.5, uColor * 1.3, smoothstep(0.45, 0.65, n));
    glow = 0.3 * smoothstep(0.6, 0.7, n);
  } else if (uKind == 5) { // sand: dune bands
    float n = sin(vXZ.x * 0.15 + fbm(p * 2.0) * 6.0 + t * 0.2);
    col = mix(uColor * 0.8, uColor * 1.1, n * 0.5 + 0.5);
  } else if (uKind == 6) { // ice: cracked sheet with sheen
    float n = fbm(p * 4.0);
    float crack = 1.0 - smoothstep(0.0, 0.03, abs(n - 0.5));
    col = mix(uColor, vec3(1.0), 0.25 * crack + 0.15 * sin(vXZ.x * 0.05 + t));
  }
  gl_FragColor = vec4(col + uEmissive * (0.4 + glow), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function groundKindIndex(kind: ThemeDefV2['ground']['kind']): number {
  return GROUND_KINDS.indexOf(kind);
}

export function createGround(theme: ThemeDefV2, y: number, tracker: ResourceTracker) {
  const g = theme.ground;
  if (g.kind === 'void') return null;
  const material = tracker.track(
    new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uColor: { value: new THREE.Color(g.color) },
          uEmissive: { value: new THREE.Color(g.emissive ?? '#000000') },
          uTime: { value: 0 },
          uMotion: { value: Math.min(1, Math.max(0, g.motion)) },
          uKind: { value: groundKindIndex(g.kind) },
        },
      ]),
      vertexShader,
      fragmentShader,
      fog: true,
    }),
  );
  const geometry = tracker.track(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 48, 48));
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `theme:ground:${g.kind}`;
  mesh.position.y = y;
  mesh.frustumCulled = false;
  return {
    mesh,
    update(time: number) {
      material.uniforms.uTime.value = time;
    },
  };
}
