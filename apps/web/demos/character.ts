// Demo page for the character (#8): every built-in skin in a row, with a button per animation.
import * as THREE from 'three';
import { Anim } from '@wobble/shared/constants';
import { BUILTIN_SKIN_PACKS } from '@wobble/shared/assets/builtin/index';
import { createWobbler, type Wobbler } from '../src/character/index.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfe9ff');
scene.add(new THREE.HemisphereLight('#ffffff', '#8fb4c9', 1.2));
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.position.set(-4, 8, -6);
sun.castShadow = true;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(12, 48),
  new THREE.MeshStandardMaterial({ color: '#7ad7ff', roughness: 0.7 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

// Rows of up to 5, the first row nearest the camera. ?n=2 shows just the first two skins, close up;
// ?pick=2,4 shows those skins (by index).
const query = new URLSearchParams(location.search);
const count = Math.max(1, Number(query.get('n')) || BUILTIN_SKIN_PACKS.length);
const picked = (query.get('pick') ?? '')
  .split(',')
  .filter((s) => s !== '')
  .map((s) => BUILTIN_SKIN_PACKS[Number(s)])
  .filter((p) => p !== undefined);
const skins = picked.length ? picked : BUILTIN_SKIN_PACKS.slice(0, count);
const spacing = 1.3;
const PER_ROW = Math.min(5, skins.length);
const wobblers: Wobbler[] = skins.map((pack, i) => {
  const w = createWobbler(pack.data);
  scene.add(w.object3d);
  const row = Math.floor(i / PER_ROW);
  const inRow = Math.min(PER_ROW, skins.length - row * PER_ROW);
  w.object3d.userData.x = ((i % PER_ROW) - (inRow - 1) / 2) * spacing;
  w.object3d.userData.z = -row * 1.6;
  return w;
});

const ANIMS: [string, number, number][] = [
  ['Idle', Anim.IDLE, 0],
  ['Run', Anim.RUN, 7.5],
  ['Jump', Anim.JUMP, 3],
  ['Fall', Anim.FALL, 3],
  ['Dive', Anim.DIVE, 10],
  ['Prone', Anim.PRONE, 0],
  ['Stumble', Anim.STUMBLE, 1],
  ['Celebrate', Anim.CELEBRATE, 0],
  ['Grab', Anim.GRAB, 0],
  ['Knocked down', Anim.KNOCKED, 0],
  ['Get up', Anim.GETUP, 0],
];
let anim: number = Anim.IDLE;
let speed = 0;
const buttons = ANIMS.map(([label, a, s]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.setAttribute('aria-pressed', String(a === anim));
  b.addEventListener('click', () => {
    anim = a;
    speed = s;
    for (const other of buttons) other.setAttribute('aria-pressed', String(other === b));
  });
  panel.appendChild(b);
  return b;
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Fit the whole row on narrow screens too.
  const rowWidth = PER_ROW * spacing + 0.6;
  const dist = Math.max(2.5, rowWidth / (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) + 0.5);
  const rows = Math.ceil(skins.length / PER_ROW);
  // ?zoom=3 moves the camera in on the faces.
  const zoom = Math.max(1, Number(query.get('zoom')) || 1);
  const lookY = zoom > 1 ? 0.85 : rows > 1 ? 0.2 : 0.55;
  camera.position.set(0, zoom > 1 ? 0.9 : dist * 0.3, dist / zoom);
  camera.lookAt(0, lookY, rows > 1 && zoom === 1 ? -1.6 : 0);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const pos = [0, 0, 0];
let last = performance.now();
let t = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  t += dt;
  for (const w of wobblers) {
    pos[0] = w.object3d.userData.x as number;
    pos[2] = w.object3d.userData.z as number;
    // Turn slowly so every side can be seen; face the camera at the start.
    w.setPose({ pos, yaw: Math.PI + Math.sin(t * 0.5) * 1.4, anim, speed }, dt);
  }
  renderer.render(scene, camera);
});
