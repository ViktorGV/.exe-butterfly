// Ambient GPU particles (#64): one THREE.Points per system, positions wrap in a box around the
// camera entirely in the vertex shader (no per-frame CPU work besides two uniforms).
import * as THREE from 'three';
import type { Particles } from '@wobble/shared/types';
import type { ResourceTracker } from './images.ts';
import { createRng, hashString } from './layout.ts';
import { particleCount, type ThemeQuality } from './quality.ts';

export const PARTICLE_BOX = 48;

interface KindLook {
  vel: [number, number, number];
  size: number;
  additive: boolean;
  sway: number;
}

export const PARTICLE_LOOKS: Record<Particles['kind'], KindLook> = {
  snow: { vel: [0.2, -1.4, 0], size: 0.14, additive: false, sway: 0.6 },
  rain: { vel: [0.5, -16, 0], size: 0.07, additive: false, sway: 0 },
  embers: { vel: [0.2, 1.6, 0], size: 0.12, additive: true, sway: 0.5 },
  bubbles: { vel: [0, 1.1, 0], size: 0.22, additive: false, sway: 0.4 },
  leaves: { vel: [0.8, -1.1, 0.2], size: 0.24, additive: false, sway: 1.2 },
  petals: { vel: [0.6, -0.9, 0.3], size: 0.18, additive: false, sway: 1 },
  sparkles: { vel: [0, 0.25, 0], size: 0.12, additive: true, sway: 0.3 },
  dust: { vel: [0.4, 0.05, 0.1], size: 0.09, additive: false, sway: 0.2 },
  ash: { vel: [0.1, -0.5, 0], size: 0.12, additive: false, sway: 0.4 },
};

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime; uniform vec3 uCenter; uniform vec3 uVel; uniform float uBox; uniform float uSize; uniform float uSway; uniform float uScale;
attribute float aSeed;
varying float vSeed;
void main() {
  vec3 p = position * uBox + uVel * uTime;
  p.x += sin(uTime * 1.3 + aSeed * 6.28) * uSway;
  vec3 w = uCenter + (fract((p - uCenter) / uBox) - 0.5) * uBox;
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uSize * uScale * (0.6 + aSeed) / -mvPosition.z;
  vSeed = aSeed;
  #include <fog_vertex>
}`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor; uniform float uTime;
varying float vSeed;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d) * (0.65 + 0.35 * sin(uTime * 3.0 + vSeed * 40.0));
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createParticleSystem(
  def: Particles,
  quality: ThemeQuality,
  tracker: ResourceTracker,
  pixelHeight = 800,
) {
  const count = particleCount(def.density, quality);
  if (count === 0) return null;
  const look = PARTICLE_LOOKS[def.kind];
  const rng = createRng(hashString(def.kind + def.color));
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng();
    pos[i * 3 + 1] = rng();
    pos[i * 3 + 2] = rng();
    seed[i] = rng();
  }
  const geometry = tracker.track(new THREE.BufferGeometry());
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const speed = 0.4 + Math.min(1, Math.max(0, def.speed)) * 1.2;
  const material = tracker.track(
    new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uCenter: { value: new THREE.Vector3() },
          uVel: { value: new THREE.Vector3(...look.vel).multiplyScalar(speed) },
          uBox: { value: PARTICLE_BOX },
          uSize: { value: look.size },
          uSway: { value: look.sway },
          uScale: { value: pixelHeight },
          uColor: { value: new THREE.Color(def.color) },
        },
      ]),
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: look.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    }),
  );
  const points = new THREE.Points(geometry, material);
  points.name = `theme:particles:${def.kind}`;
  points.frustumCulled = false;
  return {
    points,
    count,
    update(time: number, center: THREE.Vector3, viewportHeight: number) {
      material.uniforms.uTime.value = time;
      material.uniforms.uCenter.value.copy(center);
      material.uniforms.uScale.value = viewportHeight;
    },
  };
}
