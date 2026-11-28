// Demo page for the racer moves: pick a racer and an action (idle, run, jump, dive, fall, get up, push, pushed from behind or the side, help up). The pair moves
// bring in the next racer as the partner. Drag to turn the view, scrub the timeline, or slow it down.
// ?racer=<id>&action=<id>&t=<seconds> opens a racer, an action and (paused) a moment directly.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ACTIONS, PAIR_LAYOUT, applyPose, type Action } from '../src/racers/anim.ts';
import { boneIndex } from '../src/racers/bones.ts';
import { RACERS, buildRacer, type BuiltRacer } from '../src/racers/index.ts';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const racerBar = document.getElementById('racers') as HTMLDivElement;
const actionBar = document.getElementById('actions') as HTMLDivElement;
const caption = document.getElementById('caption') as HTMLDivElement;
const status = document.getElementById('status') as HTMLDivElement;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const slowBtn = document.getElementById('slow') as HTMLButtonElement;
const scrub = document.getElementById('scrub') as HTMLInputElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#a7a9ad');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;
const key = new THREE.DirectionalLight('#fff6ea', 2.1);
key.position.set(2.5, 4, -5);
const fill = new THREE.DirectionalLight('#e8f0ff', 0.8);
fill.position.set(-4, 1.5, -3);
const rim = new THREE.DirectionalLight('#ffffff', 1.4);
rim.position.set(0, 3.5, 5);
scene.add(key, fill, rim);

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;

// Soft contact shadow under each racer, so hops and dives read against the plain background.
const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
})();
function makeShadow(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  scene.add(m);
  return m;
}
const shadows = [makeShadow(), makeShadow()];

const query = new URLSearchParams(location.search);
const cache = new Map<string, BuiltRacer>();
let racerId = query.get('racer') ?? RACERS[0].id;
let action: Action = ACTIONS.find((a) => a.id === query.get('action')) ?? ACTIONS[1];
let actor: BuiltRacer | null = null;
let partner: BuiltRacer | null = null;
let time = Number(query.get('t')) || 0;
let playing = !query.has('t');
let speed = 1;

async function racer(id: string): Promise<BuiltRacer> {
  let r = cache.get(id);
  if (!r) {
    const def = RACERS.find((d) => d.id === id) ?? RACERS[0];
    status.textContent = `Sculpting ${def.name}…`;
    await new Promise((res) => setTimeout(res, 30));
    r = buildRacer(def);
    cache.set(id, r);
    status.textContent = '';
  }
  return r;
}

function partnerId(id: string): string {
  const i = RACERS.findIndex((d) => d.id === id);
  return RACERS[(i + 1) % RACERS.length].id;
}

let busy = 0;
async function show(): Promise<void> {
  const ticket = ++busy;
  const a = await racer(racerId);
  const p = action.pair ? await racer(partnerId(racerId)) : null;
  if (ticket !== busy) return;
  for (const r of cache.values()) r.group.removeFromParent();
  actor = a;
  partner = p;
  scene.add(a.group);
  a.group.position.set(0, 0, 0);
  a.group.rotation.set(0, 0, 0);
  if (p) {
    const layout = PAIR_LAYOUT[action.id];
    scene.add(p.group);
    a.group.position.x = layout.actor.x;
    a.group.rotation.y = layout.actor.yaw;
    p.group.position.set(layout.partner.x, 0, 0);
    p.group.rotation.set(0, layout.partner.yaw, 0);
  }
  frame();
  caption.innerHTML = `<b>${a.def.name}</b> · ${action.label}${p ? ` · with ${p.def.name}` : ''}`;
  for (const b of racerBar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.id === racerId));
  for (const b of actionBar.querySelectorAll('button'))
    b.setAttribute('aria-pressed', String(b.dataset.id === action.id));
}

function frame(): void {
  const aspect = camera.aspect;
  const far = Math.max(1, 1.45 / aspect);
  if (action.pair) {
    const cx = PAIR_LAYOUT[action.id].focusX;
    controls.target.set(cx, 0.5, 0);
    camera.position.set(cx + 0.35, 1.05, -3.3 * far);
  } else if (action.id === 'dive' || action.id === 'fall' || action.id === 'getup') {
    // These travel a body length forward or back: watch them from the side (and a little in front).
    const tz = action.id === 'dive' ? -0.95 : 0.55;
    controls.target.set(0, 0.42, tz);
    camera.position.set(3.1 * far, 1.0, tz - 1.1 * far);
  } else {
    controls.target.set(0, action.id === 'jump' ? 0.7 : 0.5, -0.1);
    camera.position.set(1.6 * far, 1.15, -0.1 - 2.5 * far);
  }
  controls.update();
}

for (const def of RACERS) {
  const b = document.createElement('button');
  b.textContent = def.name.split(' ')[0];
  b.dataset.id = def.id;
  b.addEventListener('click', () => {
    racerId = def.id;
    void show();
  });
  racerBar.append(b);
}
for (const a of ACTIONS) {
  const b = document.createElement('button');
  b.textContent = a.label;
  b.dataset.id = a.id;
  b.addEventListener('click', () => {
    action = a;
    time = 0;
    void show();
  });
  actionBar.append(b);
}
playBtn.addEventListener('click', () => {
  playing = !playing;
  playBtn.textContent = playing ? 'Pause' : 'Play';
  playBtn.setAttribute('aria-pressed', String(playing));
});
slowBtn.addEventListener('click', () => {
  speed = speed === 1 ? 0.25 : 1;
  slowBtn.setAttribute('aria-pressed', String(speed !== 1));
});
scrub.addEventListener('input', () => {
  playing = false;
  playBtn.textContent = 'Play';
  playBtn.setAttribute('aria-pressed', 'false');
  time = (Number(scrub.value) / 1000) * action.length;
});
if (!playing) {
  playBtn.textContent = 'Play';
  playBtn.setAttribute('aria-pressed', 'false');
}

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  frame();
}
window.addEventListener('resize', resize);
resize();

const spine = new THREE.Vector3();
function placeShadow(r: BuiltRacer | null, s: THREE.Mesh): void {
  s.visible = r !== null;
  if (!r) return;
  r.bones[boneIndex('spine')].getWorldPosition(spine);
  const lift = Math.max(0, r.body.position.y - (Math.abs(r.body.rotation.x) > 1 ? r.back : 0));
  const size = 0.75 / (1 + lift * 1.6);
  s.position.set(spine.x, 0.002, spine.z);
  s.scale.set(size, size, 1);
  (s.material as THREE.MeshBasicMaterial).opacity = 1 / (1 + lift * 2.5);
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (playing) time = (time + dt * speed) % action.length;
  if (actor) applyPose(actor, action.pose(actor, time, 'actor'));
  if (partner) applyPose(partner, action.pose(partner, time, 'partner'));
  placeShadow(actor, shadows[0]);
  placeShadow(partner, shadows[1]);
  if (playing) scrub.value = String(Math.round((time / action.length) * 1000));
  controls.update();
  renderer.render(scene, camera);
});

/** For checking a moment by hand or from tests: show `actionId` for `racer` frozen at `t` seconds. */
(window as unknown as Record<string, unknown>).racerMoves = async (id: string, actionId: string, t: number) => {
  racerId = id;
  action = ACTIONS.find((a) => a.id === actionId) ?? action;
  await show();
  time = t;
  playing = false;
  playBtn.textContent = 'Play';
  scrub.value = String(Math.round((t / action.length) * 1000));
  if (actor) applyPose(actor, action.pose(actor, time, 'actor'));
  if (partner) applyPose(partner, action.pose(partner, time, 'partner'));
  placeShadow(actor, shadows[0]);
  placeShadow(partner, shadows[1]);
  renderer.render(scene, camera);
};

void show().then(() => {
  scrub.value = String(Math.round((time / action.length) * 1000));
  document.documentElement.dataset.ready = 'true';
});
