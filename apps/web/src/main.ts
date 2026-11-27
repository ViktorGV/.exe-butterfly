// Scaffold entry point: proves the toolchain with a lit, spinning rounded shape.
// Replaced by the game state machine in #26.
import * as THREE from 'three';
import { fixtureTheme } from '@wobble/shared/fixtures/index';
import { applyTheme } from './theme/index.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(0, 1.6, 5);
camera.lookAt(0, 0.6, 0);

const theme = applyTheme(fixtureTheme, { scene, renderer });

const wobbler = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 0.6, 8, 24), theme.getMaterial('platformB'));
wobbler.position.y = 0.9;
wobbler.castShadow = true;
scene.add(wobbler);

const ground = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.3, 48), theme.getMaterial('platformA'));
ground.position.y = -0.15;
ground.receiveShadow = true;
scene.add(ground);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop((ms: number) => {
  const t = ms / 1000;
  wobbler.rotation.y = t * 0.8;
  wobbler.position.y = 0.9 + Math.abs(Math.sin(t * 3)) * 0.25;
  wobbler.scale.set(1 + Math.sin(t * 6) * 0.04, 1 - Math.sin(t * 6) * 0.04, 1 + Math.sin(t * 6) * 0.04);
  renderer.render(scene, camera);
});
