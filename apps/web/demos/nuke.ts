// Demo page for the atom bomb: flash, fireball and mushroom cloud over a floor.
import * as THREE from 'three';
import { createEngine } from '../src/engine/index.ts';
import { createFlashOverlay, createNuke } from '../src/nuke/index.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = createEngine({ canvas });
const { scene, camera } = engine;

scene.background = new THREE.Color('#bfe9ff');
scene.add(new THREE.HemisphereLight('#ffffff', '#8fb4c9', 1.1));
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(600, 1, 600),
  new THREE.MeshStandardMaterial({ color: '#7ad7ff', roughness: 0.6 }),
);
floor.position.set(0, -0.5, -150);
scene.add(floor);

const nuke = createNuke({ scene });
const flash = createFlashOverlay();
camera.position.set(0, 25, 60);
camera.lookAt(0, 70, -160);

document.getElementById('drop')!.addEventListener('click', () => nuke.play([0, 0, -160], performance.now()));
engine.onRender(() => flash.set(nuke.update(performance.now())));
engine.start();
