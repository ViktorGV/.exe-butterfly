// Far crowd: every far-away player as a camera-facing picture of their racer. Each racer is rendered once, at
// load, from 8 directions in 3 frames (standing, two running steps) into one atlas; a far player is one
// instanced quad that picks the cell for the angle it is seen from, steps through the run frames, bobs, and
// lies flat for dives and knock-downs. One draw call for any number of far players.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { applyPose } from './anim.ts';
import { idle, run } from './anim.ts';
import { RACERS } from './index.ts';
import { instantiateRacer, racerForSkin } from './play.ts';

/** Picture size in metres (the racers are about 1.35 m tall and 1 m across in the A-pose). */
const QUAD_W = 1.05;
const QUAD_H = 1.47;
const CELL_W = 80;
const CELL_H = 112;
const ANGLES = 8;
const FRAMES = 3;
const ATLAS_W = 2048;
const ATLAS_H = 1024;

export interface RacerFarTier {
  readonly object3d: THREE.Object3D;
  begin(): void;
  add(x: number, y: number, z: number, yaw: number, anim: number, phase: number, speed: number, skin: unknown): void;
  end(dt: number): void;
  dispose(): void;
}

/** Render every racer from 8 directions in 3 frames into one atlas (cell = angle * FRAMES + frame, row = racer). */
function bakeAtlas(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(ATLAS_W, ATLAS_H, { samples: 4 });
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.7;
  const key = new THREE.DirectionalLight('#fff6ea', 2.2);
  key.position.set(2, 4, -3);
  scene.add(key, new THREE.AmbientLight('#ffffff', 0.5));
  const cam = new THREE.OrthographicCamera(-QUAD_W / 2, QUAD_W / 2, QUAD_H, 0, 0.1, 10);

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  rt.scissorTest = false;
  renderer.setRenderTarget(rt);
  renderer.clear();

  RACERS.forEach((def, row) => {
    const r = instantiateRacer(def);
    scene.add(r.group);
    for (let f = 0; f < FRAMES; f++) {
      const pose = f === 0 ? idle.pose(r, 0.75, 'actor') : run.pose(r, f === 1 ? 0.11 : 0.33, 'actor');
      pose.x = pose.z = 0;
      applyPose(r, pose);
      r.group.updateMatrixWorld(true);
      for (let a = 0; a < ANGLES; a++) {
        // The racer faces -Z; cell a is seen from a camera turned a * 45 degrees round from straight in front.
        const b = Math.PI + (a * Math.PI * 2) / ANGLES;
        cam.position.set(Math.sin(b) * 4, 0, Math.cos(b) * 4);
        cam.lookAt(0, 0, 0);
        const x = (a * FRAMES + f) * CELL_W;
        const y = row * CELL_H;
        // A render target uses its own viewport and scissor (the renderer's apply to the canvas only).
        rt.viewport.set(x, y, CELL_W, CELL_H);
        rt.scissor.set(x, y, CELL_W, CELL_H);
        rt.scissorTest = true;
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
      }
    }
    scene.remove(r.group);
  });

  rt.scissorTest = false;
  rt.viewport.set(0, 0, ATLAS_W, ATLAS_H);
  rt.scissor.set(0, 0, ATLAS_W, ATLAS_H);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  env.dispose();
  pmrem.dispose();
  return rt;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData; // racer row, yaw, anim, phase
attribute float iSpeed;
uniform float uTime;
uniform vec2 uCell;
uniform vec2 uQuad;
varying vec2 vUv;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 toCam = cameraPosition - iPos;
  toCam.y = 0.0;
  float l = length(toCam);
  toCam = l > 1e-4 ? toCam / l : vec3(0.0, 0.0, 1.0);
  vec3 right = vec3(toCam.z, 0.0, -toCam.x);
  // Angle the player is seen from, relative to where it faces (yaw 0 faces -Z).
  float rel = atan(toCam.x, toCam.z) - (iData.y + PI);
  float a = mod(floor(rel / (PI * 0.25) + 0.5), 8.0);
  int anim = int(iData.z + 0.5);
  float t = uTime + iData.w;
  float frame = 0.0;
  if (anim == 1) frame = 1.0 + mod(floor(t * (2.6 + iSpeed * 0.32)), 2.0);
  vUv = (vec2(a * 3.0 + frame, iData.x) + uv) * uCell;

  vec2 sc = vec2(1.0);
  float lift = 0.0;
  float roll = 0.0;
  if (anim == 0) lift = 0.01 * sin(t * 3.0);
  else if (anim == 1) lift = 0.05 * abs(sin(t * (7.0 + iSpeed * 0.8)));
  else if (anim == 2) sc = vec2(0.95, 1.06);
  else if (anim == 3) { sc = vec2(0.95, 1.06); roll = 0.3 * sin(t * 11.0); }
  else if (anim == 4 || anim == 5 || anim == 9) { sc = vec2(1.2, 0.45); lift = 0.05; }
  else if (anim == 6) roll = 0.3 * sin(t * 8.0);
  else if (anim == 7) lift = 0.25 * abs(sin(t * 5.0));
  vec2 q = vec2(position.x * uQuad.x * sc.x, position.y * uQuad.y * sc.y);
  float cr = cos(roll);
  float sr = sin(roll);
  q = vec2(q.x * cr - q.y * sr, q.x * sr + q.y * cr);
  vec3 world = iPos + right * q.x + vec3(0.0, q.y + lift, 0.0);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 c = texture2D(uAtlas, vUv);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb / max(c.a, 1e-3), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The far tier for `max` players, with the atlas rendered now (about one frame of work). */
export function createRacerFarTier({ renderer, max }: { renderer: THREE.WebGLRenderer; max: number }): RacerFarTier {
  const rt = bakeAtlas(renderer);
  const rowOf = new WeakMap<object, number>();
  const rowFor = (skin: unknown): number => {
    if (typeof skin === 'object' && skin !== null) {
      const known = rowOf.get(skin);
      if (known !== undefined) return known;
      const row = RACERS.indexOf(racerForSkin(skin));
      rowOf.set(skin, row);
      return row;
    }
    return RACERS.indexOf(racerForSkin(skin));
  };

  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  geo.setIndex(quad.getIndex());
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  const iSpeed = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  for (const a of [iPos, iData, iSpeed]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iData', iData);
  geo.setAttribute('iSpeed', iSpeed);
  geo.instanceCount = 0;

  const time = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uAtlas: { value: null },
        uCell: { value: new THREE.Vector2(CELL_W / ATLAS_W, CELL_H / ATLAS_H) },
        uQuad: { value: new THREE.Vector2(QUAD_W, QUAD_H) },
        uTime: time,
      },
    ]),
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
  });
  // Set after the merge: merging copies uniform values, and a render target's texture cannot be copied.
  material.uniforms.uTime = time;
  material.uniforms.uAtlas = { value: rt.texture };
  material.name = 'racers:far';
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'racers:far';
  mesh.frustumCulled = false;
  const pos = iPos.array as Float32Array;
  const data = iData.array as Float32Array;
  const spd = iSpeed.array as Float32Array;
  let n = 0;

  return {
    object3d: mesh,
    begin() {
      n = 0;
    },
    add(x, y, z, yaw, anim, phase, speed, skin) {
      if (n >= max) return;
      pos[n * 3] = x;
      pos[n * 3 + 1] = y;
      pos[n * 3 + 2] = z;
      data[n * 4] = rowFor(skin);
      data[n * 4 + 1] = yaw;
      data[n * 4 + 2] = anim;
      data[n * 4 + 3] = phase;
      spd[n] = speed;
      n++;
    },
    end(dt) {
      time.value += dt;
      geo.instanceCount = n;
      if (n > 0) iPos.needsUpdate = iData.needsUpdate = iSpeed.needsUpdate = true;
    },
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      quad.dispose();
      material.dispose();
      rt.dispose();
    },
  };
}
