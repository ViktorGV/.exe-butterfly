// Demo page for the racer concepts: every racer sculpted in code, standing in an A-pose on a plain gray studio
// background. Buttons show the line-up or one racer full-body; drag to turn the view; "Save PNG" downloads it.
// ?view=<id> opens one racer directly.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RACERS, buildRacer, type BuiltRacer } from '../src/racers/index.ts';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const caption = document.getElementById('caption') as HTMLDivElement;
const status = document.getElementById('status') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#a7a9ad');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;

// Soft studio lights from the front (the racers face -Z), no shadows.
const key = new THREE.DirectionalLight('#fff6ea', 2.1);
key.position.set(2.5, 4, -5);
const fill = new THREE.DirectionalLight('#e8f0ff', 0.8);
fill.position.set(-4, 1.5, -3);
const rim = new THREE.DirectionalLight('#ffffff', 1.4);
rim.position.set(0, 3.5, 5);
scene.add(key, fill, rim);

const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;

const SPACING = 1.15;
const built: BuiltRacer[] = [];
const labels = new Map<string, HTMLDivElement>();
const query = new URLSearchParams(location.search);
let view = query.get('view') ?? 'all';
let turntable = false;

function racerX(i: number): number {
  // Screen right is world -X when looking from -Z, so the first racer stands furthest left.
  return -(i - (RACERS.length - 1) / 2) * SPACING;
}

function frame(): void {
  const box = new THREE.Box3();
  for (const r of built) if (view === 'all' || view === r.def.id) box.expandByObject(r.group);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1.3, 0.5));
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  // Room for the toolbar above and the caption below.
  const pad = view === 'all' ? 1.3 : 1.38;
  const fitH = (size.y * pad) / 2 / Math.tan(half);
  const fitW = (size.x * 1.15) / 2 / (Math.tan(half) * camera.aspect);
  const dist = Math.max(fitH, fitW) + size.z / 2;
  centre.y -= size.y * 0.02;
  controls.target.copy(centre);
  camera.position.set(centre.x, centre.y + size.y * 0.04, centre.z - dist);
  controls.update();
  for (const r of built) r.group.visible = view === 'all' || view === r.def.id;
  const one = built.find((r) => r.def.id === view);
  caption.innerHTML = one
    ? `<b>${one.def.name}</b>${one.def.roll.archetype} · ${one.def.roll.theme} · ${one.def.roll.palette}`
    : '';
  for (const b of panel.querySelectorAll<HTMLButtonElement>('button[data-view]'))
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
}

function button(text: string, onClick: () => void, viewId?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  if (viewId) b.dataset.view = viewId;
  b.addEventListener('click', onClick);
  panel.append(b);
  return b;
}

button('All racers', () => ((view = 'all'), frame()), 'all');
for (const def of RACERS) button(def.name.split(' ')[0], () => ((view = def.id), frame()), def.id);
const spin = button('Turntable', () => {
  turntable = !turntable;
  spin.setAttribute('aria-pressed', String(turntable));
});
button('Front view', () => {
  for (const r of built) r.group.rotation.y = 0;
  frame();
});
button('Save PNG', () => {
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.download = `racer-${view}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
});

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => (resize(), frame()));
resize();

const v = new THREE.Vector3();
renderer.setAnimationLoop((t) => {
  if (turntable) for (const r of built) r.group.rotation.y += 0.01;
  controls.update();
  renderer.render(scene, camera);
  for (const r of built) {
    const label = labels.get(r.def.id);
    if (!label) continue;
    label.style.display = view === 'all' ? '' : 'none';
    if (view !== 'all') continue;
    v.set(r.group.position.x, -0.06, 0).project(camera);
    label.style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
    label.style.top = `${((1 - v.y) / 2) * window.innerHeight}px`;
  }
  void t;
});

// Sculpt the racers one at a time so the page stays responsive and each appears as soon as it is ready.
const step = Number(query.get('step')) || 0.0055;
(async () => {
  const order = RACERS.map((_, i) => i).sort((a, b) => Number(RACERS[b].id === view) - Number(RACERS[a].id === view));
  for (const i of order) {
    status.textContent = `Sculpting ${RACERS[i].name}…`;
    await new Promise((r) => setTimeout(r, 30));
    const r = buildRacer(RACERS[i], step);
    r.group.position.x = racerX(i);
    scene.add(r.group);
    built.push(r);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = r.def.name;
    document.body.append(label);
    labels.set(r.def.id, label);
    console.info(`${r.def.name}: ${r.triangles} triangles in ${r.ms.toFixed(0)} ms`);
    frame();
  }
  status.textContent = `${built.length} racers · ${built.reduce((s, r) => s + r.triangles, 0).toLocaleString()} triangles`;
  document.documentElement.dataset.ready = 'true';
})();
