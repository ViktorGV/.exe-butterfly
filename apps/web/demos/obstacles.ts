// Demo page for the course components: arrow tiles, the vertical sliding wall and the carousel.
import * as THREE from 'three';
import { fixtureCourse, fixtureTheme } from '@wobble/shared';
import type { CourseDef, EntityDef } from '@wobble/shared/types';
import { createCourseRuntime } from '../src/course/index.ts';
import { createEngine } from '../src/engine/index.ts';
import { applyTheme } from '../src/theme/index.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = createEngine({ canvas });
const { scene, camera } = engine;

let id = 0;
const add = (kind: string, pos: [number, number, number], params: Record<string, unknown>, yaw = 0): EntityDef => ({
  id: id++,
  kind,
  pos,
  yaw,
  params,
});

const entities: EntityDef[] = [
  // floor for the tiles and the wall
  add('platform', [0, 0, -18], { size: [44, 1, 40], slot: 'platformA' }),
  // a row of arrow tiles, some forward and some back
  ...[-15, -9, -3, 3, 9, 15].map((x, k) =>
    add('arrowTile', [x, 0.12, -6], { size: [6, 0.12, 6], dir: k % 3 === 1 ? -1 : 1 }),
  ),
  // the sliding wall: panels rise and fall on their own phases
  add('slidingWall', [0, 0, -22], { width: 36, panels: 6, height: 2.5, periodSec: 4 }),
  // two carousels over a gap
  add('carousel', [-9, 0, -48], { radius: 4.2, pad: 3.4, rpm: 5, dir: 1 }),
  add('carousel', [9, 0, -48], { radius: 4.2, pad: 3.4, rpm: 5, dir: -1 }),
];

const courseDef: CourseDef = { ...structuredClone(fixtureCourse), id: 'obstacles-demo', entities };
const theme = applyTheme(fixtureTheme, { scene, renderer: engine.renderer });
const course = createCourseRuntime({ courseDef, theme, scene });

scene.add(new THREE.AmbientLight('#ffffff', 0.4));
let t = 0;
engine.onRender((_alpha, dt) => {
  t += dt;
  course.stepColliders(t);
  course.update(t);
  // a slow sweep over the scene
  const a = Math.sin(t * 0.18) * 0.5;
  camera.position.set(Math.sin(a) * 34, 24, 14 + Math.cos(a) * 6);
  camera.lookAt(0, 0, -28);
});
engine.start();
