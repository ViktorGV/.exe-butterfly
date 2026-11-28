// Demo page for the villain boss (#84): the boss, a floor, and throws landing on random spots.
import * as THREE from 'three';
import { BUTTERFLY } from '@wobble/shared/constants';
import { createEngine } from '../src/engine/index.ts';
import { createVillainView } from '../src/villain/index.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = createEngine({ canvas });
const { scene, camera } = engine;

scene.background = new THREE.Color('#bfe9ff');
scene.add(new THREE.HemisphereLight('#ffffff', '#8fb4c9', 1.1));
const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
sun.position.set(-12, 24, 10);
scene.add(sun);
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(48, 1, 60),
  new THREE.MeshStandardMaterial({ color: '#7ad7ff', roughness: 0.6 }),
);
floor.position.set(0, -0.5, -20);
scene.add(floor);

const villain = createVillainView({ scene });
villain.setBoss([0, 0, -44]);
camera.position.set(0, 9, 14);
camera.lookAt(0, 0, -22);

let n = 0;
const nowMs = () => performance.now();
function throwOne() {
  const x = (Math.random() - 0.5) * 30;
  const z = -8 - Math.random() * 24;
  villain.throwAt({ n: n++, target: 1, pos: [x, z], landAt: nowMs() + BUTTERFLY.THROW_WARN_MS }, 0, nowMs());
}

document.getElementById('throw-one')!.addEventListener('click', throwOne);
document.getElementById('throw-many')!.addEventListener('click', () => {
  for (let i = 0; i < 5; i++) throwOne();
});
document.getElementById('reset')!.addEventListener('click', () => {
  villain.reset();
  villain.setBoss([0, 0, -44]);
});

engine.onRender((_alpha, dt) => villain.update(nowMs(), dt));
engine.start();
