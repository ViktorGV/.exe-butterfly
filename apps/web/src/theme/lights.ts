// Hemisphere fill plus one shadow-casting sun whose shadow box follows a movable focus point.
// Shadow map size and type stay under the engine's quality preset (engine.setQuality); we never touch them.
import * as THREE from 'three';
import type { ThemeDef } from '@wobble/shared/types';
import type { ThemeFeature } from './feature.ts';

/** Half-size of the sun's shadow box around the focus, in metres. */
export const SHADOW_EXTENT = 24;
const SUN_DISTANCE = 60;

export interface LightsFeature extends ThemeFeature {
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  setShadowFocus(x: number, y: number, z: number): void;
}

export function createLights(scene: THREE.Scene, theme: ThemeDef): LightsFeature {
  const hemi = new THREE.HemisphereLight();
  hemi.name = 'theme:hemi';
  const sun = new THREE.DirectionalLight();
  sun.name = 'theme:sun';
  sun.castShadow = true;
  const cam = sun.shadow.camera;
  cam.left = -SHADOW_EXTENT;
  cam.right = SHADOW_EXTENT;
  cam.top = SHADOW_EXTENT;
  cam.bottom = -SHADOW_EXTENT;
  cam.near = 1;
  cam.far = SUN_DISTANCE * 2;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  sun.target.name = 'theme:sunTarget';
  scene.add(hemi, sun, sun.target);

  const dir = new THREE.Vector3(); // unit vector from the scene toward the sun
  const ground = new THREE.Color();
  const toward = new THREE.Color();

  const place = (): void => {
    const t = sun.target.position;
    sun.position.set(t.x + dir.x * SUN_DISTANCE, t.y + dir.y * SUN_DISTANCE, t.z + dir.z * SUN_DISTANCE);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
  };

  const update = (th: ThemeDef): void => {
    const d = th.light.sunDir;
    dir.set(-d[0], -d[1], -d[2]).normalize();
    hemi.color.set(th.light.ambient);
    // Ground bounce tinted by the lower sky and lifted toward the ambient: no harsh blacks under things.
    ground.set(th.sky.bottom);
    toward.set(th.light.ambient);
    hemi.groundColor.copy(ground).lerp(toward, 0.35);
    hemi.intensity = th.light.ambientIntensity;
    sun.color.set(th.light.sun);
    sun.intensity = th.light.sunIntensity;
    place();
  };
  update(theme);

  return {
    hemi,
    sun,
    update,
    setShadowFocus(x, y, z) {
      sun.target.position.set(x, y, z);
      place();
    },
    dispose() {
      scene.remove(hemi, sun, sun.target);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sun.dispose();
      hemi.dispose();
    },
  };
}
