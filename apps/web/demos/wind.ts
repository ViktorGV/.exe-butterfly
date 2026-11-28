// Demo page for the snow blowers' wind: three fans taking turns across a wide floor, with the streaks, the floor
// strip and the HUD arrow. The camera stands at the start of the field looking down it.
import * as THREE from 'three';
import { fixtureCourse, fixtureTheme } from '@wobble/shared';
import { compileWindZones, windAt } from '@wobble/shared/course/obstacles/wind';
import type { CourseDef, EntityDef, Vec3 } from '@wobble/shared/types';
import { createCourseRuntime } from '../src/course/index.ts';
import { createEngine } from '../src/engine/index.ts';
import { applyTheme } from '../src/theme/index.ts';
import { createUI } from '../src/ui/index.ts';
import { createWindView, windOnScreen } from '../src/wind/index.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = createEngine({ canvas });
const { scene, camera } = engine;
const ui = createUI(document.getElementById('ui-root')!);
ui.show('hud', { checkpoints: 4, totalPlayers: 100, qualifyMax: 50, device: 'keyboard' });

const entities: EntityDef[] = [
  { id: 0, kind: 'platform', pos: [0, 0, -16], yaw: 0, params: { size: [60, 1, 40], slot: 'platformB' } },
  ...[0, 1, 2].map((k): EntityDef => ({
    id: k + 1,
    kind: 'snowBlower',
    pos: [k % 2 === 0 ? -30 : 30, 0, -4 - k * 11],
    yaw: k % 2 === 0 ? 0 : Math.PI,
    params: { reach: 60, width: 10.5, height: 3, windSpeed: 7.5, onSec: 3, offSec: 2, warnSec: 0.5, phase: k * 2.5 },
  })),
];
const courseDef: CourseDef = { ...structuredClone(fixtureCourse), id: 'wind-demo', entities };
const theme = applyTheme(fixtureTheme, { scene, renderer: engine.renderer });
const course = createCourseRuntime({ courseDef, theme, scene });
const wind = createWindView({ scene, entities });
const zones = compileWindZones(entities);
const vec: Vec3 = [0, 0, 0];
const player: Vec3 = [0, 0, -15]; // a player standing in the middle of the field

camera.position.set(0, 6, 12);
camera.lookAt(0, 0.5, -20);

let t = 0;
engine.onRender((_alpha, dt) => {
  t += dt;
  course.stepColliders(t);
  course.update(t);
  wind.update(t, dt);
  // the HUD arrow, for a camera looking down the course (yaw 0)
  const n = windAt(zones, player, t, vec);
  ui.hud.setWind(n > 0 ? windOnScreen(vec[0], vec[2], 0).angle : null);
});
scene.add(new THREE.AmbientLight('#ffffff', 0.3));
engine.start();
