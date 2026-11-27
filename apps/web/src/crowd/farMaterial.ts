// Far-tier material (#9): Lambert with per-instance skin colours and a vertex-shader pose
// (bob, run tilt and sway, jump stretch, dive and prone lean, stumble wobble, celebrate hop).
import * as THREE from 'three';

/** Per-instance attribute names on the far-tier InstancedMesh. */
export const FAR_ATTR = Object.freeze({ primary: 'iPrimary', belly: 'iBelly', limbs: 'iLimbs', anim: 'iAnim' });

const VERT_HEAD = /* glsl */ `
attribute float part;
attribute vec3 iPrimary;
attribute vec3 iBelly;
attribute vec3 iLimbs;
attribute vec3 iAnim; // anim, phase, speed (m/s)
uniform float uTime;
varying vec3 vCrowdColor;
mat3 crowdRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 crowdRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void main() {
  int crowdAnim = int(iAnim.x + 0.5);
  float crowdT = uTime + iAnim.y;
  float crowdSpeed = iAnim.z;
  float pitch = 0.0; // negative leans toward -Z (forward)
  float roll = 0.0;
  float lift = 0.0;
  vec3 stretch = vec3(1.0);
  if (crowdAnim == 0) { lift = 0.015 * (1.0 + sin(crowdT * 3.0)); }
  else if (crowdAnim == 1) {
    float f = 7.0 + crowdSpeed * 0.8;
    lift = 0.05 * abs(sin(crowdT * f));
    pitch = -0.25 * min(crowdSpeed / 8.0, 1.0);
    roll = 0.12 * sin(crowdT * f);
  }
  else if (crowdAnim == 2) { stretch = vec3(0.92, 1.14, 0.92); }
  else if (crowdAnim == 3) { roll = 0.3 * sin(crowdT * 11.0); stretch = vec3(1.05, 0.95, 1.05); }
  else if (crowdAnim == 4) { pitch = -1.35; lift = 0.3; }
  else if (crowdAnim == 5) { pitch = -1.5; lift = 0.34; }
  else if (crowdAnim == 6) { roll = 0.35 * sin(crowdT * 8.0); pitch = -0.3; }
  else if (crowdAnim == 7) { lift = 0.25 * abs(sin(crowdT * 5.0)); }
  mat3 crowdRot = crowdRotX(pitch) * crowdRotZ(roll);
  vec3 crowdLift = vec3(0.0, lift, 0.0);
  vCrowdColor = part < 0.5 ? iPrimary : part < 1.5 ? iBelly : part < 2.5 ? iLimbs : vec3(0.05);
`;

/** Build the shared far-tier material. `uniforms.uTime.value` is advanced by the crowd. */
export function createFarMaterial(): { material: THREE.MeshLambertMaterial; time: { value: number } } {
  const time = { value: 0 };
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  material.name = 'crowd:far';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', VERT_HEAD)
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n objectNormal = crowdRot * objectNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n transformed = crowdRot * (transformed * stretch) + crowdLift;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec3 vCrowdColor;\nvoid main() {')
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( diffuse * vCrowdColor, opacity );',
      );
  };
  material.customProgramCacheKey = () => 'crowd:far:v1';
  return { material, time };
}

/** Soft round blob shadow: a flat unit quad with a radial alpha falloff. */
export function createBlobMaterial(): THREE.MeshBasicMaterial {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.round(255 * (1 - r * r) * (r < 1 ? 1 : 0));
      const o = (y * size + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = a; // alphaMap reads green
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.35,
    alphaMap: tex,
    depthWrite: false,
  });
  material.name = 'crowd:blob';
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  return material;
}
