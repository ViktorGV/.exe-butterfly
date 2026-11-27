// Gradient sky dome (one draw call) plus fog and background matched to the horizon.
import * as THREE from 'three';
import type { ThemeDef } from '@wobble/shared/types';
import type { ThemeFeature } from './feature.ts';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // Centred on the camera and pushed to the far plane: never clipped, never occludes anything.
  vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position * 10.0, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.6)) : mix(uHorizon, uBottom, pow(-h, 0.5));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface SkyFeature extends ThemeFeature {
  readonly mesh: THREE.Mesh;
}

/** Sky dome, fog and clear colour. Everything is created once and recoloured on theme swaps. */
export function createSky(scene: THREE.Scene, theme: ThemeDef, onFrame: () => void): SkyFeature {
  const uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
  };
  const geometry = new THREE.SphereGeometry(1, 16, 8); // low segment count: the gradient is per-pixel
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'theme:sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.onBeforeRender = onFrame;

  const prevBackground = scene.background;
  const prevFog = scene.fog;
  const background = new THREE.Color();
  const fog = new THREE.Fog(0xffffff, 1, 2);
  scene.background = background;
  scene.fog = fog;
  scene.add(mesh);

  const update = (t: ThemeDef): void => {
    uniforms.uTop.value.set(t.sky.top);
    uniforms.uHorizon.value.set(t.sky.horizon);
    uniforms.uBottom.value.set(t.sky.bottom);
    background.set(t.sky.horizon);
    fog.color.set(t.sky.horizon); // matched to the horizon so far geometry melts into the dome
    fog.near = t.fog.near;
    fog.far = t.fog.far;
  };
  update(theme);

  return {
    mesh,
    update,
    dispose() {
      scene.remove(mesh);
      if (scene.background === background) scene.background = prevBackground;
      if (scene.fog === fog) scene.fog = prevFog;
      geometry.dispose();
      material.dispose();
    },
  };
}
