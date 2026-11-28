// Wind you can see (#84 follow-up): at the end of the course the snow blowers push players across the floor, and
// nothing showed it. Each fan now streams white streaks across its zone while it blows (a few, building up,
// while it warns), lays a rippling strip on the floor so you can see where the wind blows and which way, and
// the HUD shows an arrow while you are actually being pushed (see windOnScreen).
//
//   const wind = createWindView({ scene, entities: courseDef.entities });
//   engine.onRender((_a, dt) => wind.update(raceTime, dt));
//
// One draw call for every streak of every fan, one small plane per fan; nothing is allocated per frame.
import * as THREE from 'three';
import { compileWindZones } from '@wobble/shared/course/obstacles/wind';
import type { EntityDef } from '@wobble/shared/types';
import { createWindField, type WindField } from './field.ts';

export { createWindField, STREAKS_PER_ZONE, type WindField } from './field.ts';
export { cssRotation, windOnScreen, type WindOnScreen } from './screen.ts';

const STREAK_VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec2 iDir;
  attribute vec2 iSize;
  attribute float iAlpha;
  uniform float uNapkin;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    if (uNapkin > 0.5) {
      // a napkin tumbling along the wind: a camera-facing square spinning as it travels
      float a = iPos.x * 1.7 + iPos.z * 1.3 + iPos.y * 2.0;
      vec2 p = mat2(cos(a), sin(a), -sin(a), cos(a)) * position.xy;
      float s = 0.5 + iSize.y * 2.0;
      vec4 view = viewMatrix * vec4(iPos, 1.0);
      view.xy += p * s * vec2(1.0, 0.55 + 0.45 * abs(sin(a * 1.3)));
      vUv = position.xy + 0.5;
      vAlpha = iAlpha;
      gl_Position = projectionMatrix * view;
      return;
    }
    vec3 dir = vec3(iDir.x, 0.0, iDir.y);
    vec3 toCam = normalize(cameraPosition - iPos);
    vec3 side = cross(dir, toCam);
    float l = length(side);
    side = l > 0.001 ? side / l : vec3(0.0, 1.0, 0.0);
    // a ribbon along the wind that always turns its face toward the camera
    vec3 world = iPos + dir * position.x * iSize.x + side * position.y * iSize.y;
    vUv = position.xy + 0.5;
    vAlpha = iAlpha;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const STREAK_FRAG = /* glsl */ `
  uniform float uNapkin;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    if (uNapkin > 0.5) {
      // a white paper napkin with a fold cross and a soft grey edge
      vec2 c = abs(vUv - 0.5);
      float edge = max(c.x, c.y);
      if (vAlpha < 0.05 || edge > 0.48) discard;
      float fold = min(c.x, c.y) < 0.015 ? 0.85 : 1.0;
      vec3 col = mix(vec3(1.0), vec3(0.82, 0.8, 0.88), smoothstep(0.38, 0.48, edge)) * fold;
      gl_FragColor = vec4(col, min(1.0, vAlpha * 2.5));
      return;
    }
    // pointed at both ends, softer toward its edges
    float along = sin(vUv.x * 3.14159265);
    float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
    float a = vAlpha * along * smoothstep(0.0, 0.45, across);
    if (a < 0.01) discard;
    // a white core with a soft blue-grey rim, so a streak shows on a pale floor as well as a dark one
    vec3 col = mix(vec3(0.36, 0.46, 0.74), vec3(1.0), smoothstep(0.35, 0.8, across));
    gl_FragColor = vec4(col, a);
  }
`;

const FLOOR_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLOOR_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uLen;
  varying vec2 vUv;
  void main() {
    float edge = smoothstep(0.0, 0.14, vUv.y) * (1.0 - smoothstep(0.86, 1.0, vUv.y));
    float ends = smoothstep(0.0, 0.05, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
    // bands that drift downwind
    float bands = 0.5 + 0.5 * sin(6.2831853 * (vUv.x * uLen / 7.0 - uTime * 0.9));
    float a = uIntensity * edge * ends * (0.10 + 0.20 * bands);
    if (a < 0.004) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, a);
  }
`;

export interface WindView {
  /** Advance to race time `t` (seconds; negative during the countdown), `dt` seconds after the last call. */
  update(t: number, dt: number): void;
  readonly field: WindField;
  /** Draw the wind as flying napkins instead of streaks (the Chalga theme). */
  setNapkins(on: boolean): void;
  /** Number of fans. */
  readonly zones: number;
  /** True while any fan is blowing or warning (something is drawn). */
  readonly active: boolean;
  dispose(): void;
}

export function createWindView(opts: {
  scene: THREE.Object3D;
  entities: readonly EntityDef[];
  random?: () => number;
}): WindView {
  const zones = compileWindZones(opts.entities);
  const field = createWindField(zones, opts.random);
  const root = new THREE.Group();
  root.name = 'wind';
  root.visible = false;
  opts.scene.add(root);
  if (zones.length === 0) {
    return {
      update() {},
      setNapkins() {},
      field,
      zones: 0,
      active: false,
      dispose: () => void opts.scene.remove(root),
    };
  }

  // ---- streaks: every fan's streaks in one instanced draw
  const base = new THREE.PlaneGeometry(1, 1);
  const streaksGeo = new THREE.InstancedBufferGeometry();
  streaksGeo.index = base.index;
  streaksGeo.setAttribute('position', base.getAttribute('position'));
  const attrs = [
    new THREE.InstancedBufferAttribute(field.pos, 3),
    new THREE.InstancedBufferAttribute(field.dir, 2),
    new THREE.InstancedBufferAttribute(field.size, 2),
    new THREE.InstancedBufferAttribute(field.alpha, 1),
  ];
  const names = ['iPos', 'iDir', 'iSize', 'iAlpha'];
  attrs.forEach((a, i) => {
    a.setUsage(THREE.DynamicDrawUsage);
    streaksGeo.setAttribute(names[i]!, a);
  });
  streaksGeo.instanceCount = field.count;
  const streakMat = new THREE.ShaderMaterial({
    uniforms: { uNapkin: { value: 0 } },
    vertexShader: STREAK_VERT,
    fragmentShader: STREAK_FRAG,
    transparent: true,
    depthWrite: false,
    // the ribbon is built facing the camera, which winds it away from it: draw both sides or it is culled
    side: THREE.DoubleSide,
  });
  const streaks = new THREE.Mesh(streaksGeo, streakMat);
  streaks.name = 'wind:streaks';
  streaks.frustumCulled = false; // positions are written straight into the instance buffers
  streaks.renderOrder = 5;
  root.add(streaks);

  // ---- a rippling strip on the floor under each fan's wind
  const floorGeo = new THREE.PlaneGeometry(1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  const floors = zones.map((zone) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uLen: { value: zone.params.reach } },
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(floorGeo, mat);
    mesh.name = 'wind:floor';
    const { reach, width } = zone.params;
    mesh.scale.set(reach, 1, width);
    // centred half a reach downwind of the fan, just above its floor; local +X follows the wind
    mesh.position.set(zone.pos[0] + (zone.c * reach) / 2, zone.pos[1] + 0.04, zone.pos[2] - (zone.s * reach) / 2);
    mesh.rotation.y = Math.atan2(zone.s, zone.c);
    mesh.visible = false;
    mesh.renderOrder = 4;
    root.add(mesh);
    return { mesh, mat };
  });

  let active = false;
  return {
    update(t, dt) {
      field.update(t, dt);
      let any = false;
      for (let i = 0; i < floors.length; i++) {
        const live = field.intensity[i]!;
        const f = floors[i]!;
        f.mesh.visible = live > 0;
        f.mat.uniforms.uTime!.value = t;
        f.mat.uniforms.uIntensity!.value = live;
        if (live > 0) any = true;
      }
      active = any;
      root.visible = any;
      if (any) for (const a of attrs) a.needsUpdate = true;
    },
    setNapkins(on) {
      streakMat.uniforms.uNapkin!.value = on ? 1 : 0;
    },
    field,
    zones: zones.length,
    get active() {
      return active;
    },
    dispose() {
      opts.scene.remove(root);
      base.dispose();
      streaksGeo.dispose();
      streakMat.dispose();
      floorGeo.dispose();
      for (const f of floors) f.mat.dispose();
    },
  };
}
