// Demo page for the Chain Reaction Desk course look: pick a built-in course, ride a fly-through camera along
// it, orbit freely, or jump to a section. "Racers" drops two of the new racers on the start pad for scale.
// ?course=<id>&seg=<n>&mode=fly|orbit opens a course at a section; window.deskView(seg, t) freezes a moment.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { assembleCourse } from '@wobble/shared';
import { BUILTIN_COURSE_PACKS } from '@wobble/shared/course/recipes/index';
import type { CourseDef, CourseRecipe } from '@wobble/shared/types';
import { createDeskCourse, type DeskCourse } from '../src/desk/index.ts';
import { createStormVillain } from '../src/desk/villain.ts';
import { ACTIONS, applyPose } from '../src/racers/anim.ts';
import { RACERS, buildRacer, type BuiltRacer } from '../src/racers/index.ts';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const top = document.getElementById('top') as HTMLDivElement;
const segBar = document.getElementById('segments') as HTMLDivElement;
const title = document.getElementById('title') as HTMLDivElement;
const status = document.getElementById('status') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f1d4ae');
scene.fog = new THREE.Fog('#f1d4ae', 140, 560);
// A soft room to reflect, so chrome and brass read as metal instead of black.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;

/** Desk-object names for the recipe's segment types. */
const SECTION_NAMES: Record<string, string> = {
  plainRun: 'Domino hops',
  sweeperRun: 'Clock hands',
  movingPlatforms: 'Typing keys',
  bumperField: 'Thread spools',
  narrowBridges: 'Pencil bridges',
  rampClimb: 'Notebook ramp',
  spinnerDiscs: 'Vinyl records',
  pendulumAlley: 'Cradle balls',
  gateDash: 'Index-card gates',
  bouncePads: 'Eraser bounce',
  slidingWalls: 'Toast toasters',
  snowBlowerField: 'Desk fans',
  carousels: 'Polaroid carousel',
  arrowFloor: 'Sticky-note arrows',
};

const query = new URLSearchParams(location.search);
const packs = BUILTIN_COURSE_PACKS.filter((p) => p.id.startsWith('b:'));
let packIndex = Math.max(
  0,
  packs.findIndex((p) => p.id === (query.get('course') ?? 'b:gumdrop-gauntlet')),
);
let course: CourseDef;
let desk: DeskCourse | null = null;
let sections: { name: string; z0: number; z1: number }[] = [];
let mode: 'fly' | 'orbit' = query.get('mode') === 'orbit' ? 'orbit' : 'fly';
let flyZ = 0;
let time = 0;
let playing = true;
let racers: BuiltRacer[] = [];

// Crumple, the paper storm, floats over the desk-fan section (or the last section) and throws paper balls.
const villain = createStormVillain();
villain.group.visible = false;
scene.add(villain.group);
let villainOn = false;
let lastThrow = 0;
let stormSection = { z0: 0, z1: 0 };

/** Top of the solid floor under (x, z), from the course's platforms; 0 if none. */
function floorAt(x: number, z: number): number {
  for (const e of course.entities) {
    if (e.kind !== 'platform') continue;
    const s = (e.params.size as [number, number, number] | undefined) ?? [0, 0, 0];
    if (Math.abs(x - e.pos[0]) < s[0] / 2 && Math.abs(z - e.pos[2]) < s[2] / 2) return e.pos[1];
  }
  return 0;
}

function placeVillain(recipe: CourseRecipe): void {
  let i = recipe.segments.findIndex((s) => s.type === 'snowBlowerField');
  if (i < 0) i = sections.length - 1;
  const s = sections[i];
  stormSection = { z0: s.z0, z1: s.z1 };
  villain.group.position.set(0, floorAt(0, (s.z0 + s.z1) / 2) + 19, s.z1 + (s.z0 - s.z1) * 0.2);
}

function showVillain(on: boolean): void {
  villainOn = on;
  villain.group.visible = on;
  if (on) {
    mode = 'orbit';
    current = -2;
    const v = villain.group.position;
    controls.target.set(0, v.y - 9, v.z + 14);
    camera.position.set(16, v.y - 6, v.z + 58);
    controls.update();
  }
  syncButtons();
}

function load(index: number): void {
  packIndex = index;
  const pack = packs[index];
  const recipe = pack.data as CourseRecipe;
  course = assembleCourse(recipe);
  desk?.dispose();
  status.textContent = 'Building the desk…';
  desk = createDeskCourse({ courseDef: course });
  scene.add(desk.root);
  status.textContent = `${course.entities.length} obstacles`;
  // Sections run between checkpoints: start pad → cp0 → cp1 … → finish.
  const marks = [course.spawn.pos[2], ...course.checkpoints.map((c) => c.volume.pos[2]), course.finish.pos[2]];
  sections = recipe.segments.map((s, i) => ({ name: SECTION_NAMES[s.type] ?? s.type, z0: marks[i], z1: marks[i + 1] }));
  title.innerHTML = `<b>${recipe.name}</b>Chain Reaction Desk`;
  flyZ = course.spawn.pos[2] + 8;
  for (const r of racers) {
    r.group.removeFromParent();
    r.group.position.set(0, 0, 0);
  }
  placeRacers();
  placeVillain(recipe);
  buildSectionButtons();
  syncButtons();
}

function placeRacers(): void {
  racers.forEach((r, i) => {
    scene.add(r.group);
    r.group.position.set(course.spawn.pos[0] + (i - 0.5) * 2.2, course.spawn.pos[1], course.spawn.pos[2] - 3);
  });
}

function button(bar: HTMLElement, text: string, onClick: () => void, key?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  if (key) b.dataset.key = key;
  b.addEventListener('click', onClick);
  bar.append(b);
  return b;
}

function buildSectionButtons(): void {
  segBar.replaceChildren();
  button(segBar, 'Start', () => jump(-1), 'seg:-1');
  sections.forEach((s, i) => button(segBar, `${i + 1}. ${s.name}`, () => jump(i), `seg:${i}`));
}

let current = -1;
function jump(i: number): void {
  current = i;
  mode = 'orbit';
  const s = sections[i];
  const z = s ? (s.z0 + s.z1) / 2 : course.spawn.pos[2] - 6;
  const span = s ? Math.abs(s.z0 - s.z1) : 24;
  controls.target.set(0, 1, z);
  camera.position.set(span * 0.55 + 14, span * 0.42 + 9, z + span * 0.62 + 12);
  controls.update();
  syncButtons();
}

function syncButtons(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-key]')) {
    const k = b.dataset.key ?? '';
    const on =
      k === `course:${packIndex}` ||
      k === `mode:${mode}` ||
      (k === 'play' && !playing) ||
      (k === `seg:${current}` && mode === 'orbit') ||
      (k === 'racers' && racers.length > 0) ||
      (k === 'villain' && villainOn);
    b.setAttribute('aria-pressed', String(on));
  }
  const p = top.querySelector<HTMLButtonElement>('button[data-key="play"]');
  if (p) p.textContent = playing ? 'Pause' : 'Play';
}

packs.forEach((p, i) => button(top, (p.data as CourseRecipe).name, () => load(i), `course:${i}`));
button(
  top,
  'Fly-through',
  () => {
    mode = 'fly';
    current = -1;
    syncButtons();
  },
  'mode:fly',
);
button(
  top,
  'Orbit',
  () => {
    mode = 'orbit';
    syncButtons();
  },
  'mode:orbit',
);
button(
  top,
  'Pause',
  () => {
    playing = !playing;
    syncButtons();
  },
  'play',
);
button(
  top,
  'Racers',
  () => {
    if (racers.length) {
      for (const r of racers) r.group.removeFromParent();
      racers = [];
      syncButtons();
      return;
    }
    status.textContent = 'Sculpting racers…';
    setTimeout(() => {
      racers = [RACERS[0], RACERS[3]].map((d) => buildRacer(d));
      placeRacers();
      status.textContent = `${course.entities.length} obstacles`;
      syncButtons();
    }, 30);
  },
  'racers',
);
button(top, 'Villain', () => showVillain(!villainOn), 'villain');

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const run = ACTIONS.find((a) => a.id === 'run');
const look = new THREE.Vector3();
function frameAt(dt: number, realDt = dt): void {
  if (!desk) return;
  if (villainOn) {
    if (playing && time - lastThrow > 1.1) {
      lastThrow = time;
      const x = (Math.random() - 0.5) * 36;
      const z = stormSection.z1 + Math.random() * (stormSection.z0 - stormSection.z1);
      villain.throwAt(new THREE.Vector3(x, floorAt(x, z), z));
    }
    villain.update(time, playing ? realDt : 0);
  }
  if (mode === 'fly') {
    // Glide down the course at running pace, a little above and behind, gently swaying.
    flyZ -= dt * 11;
    if (flyZ < course.finish.pos[2] - 20) flyZ = course.spawn.pos[2] + 8;
    const sway = Math.sin(flyZ * 0.02) * 9;
    camera.position.set(sway, 9.5, flyZ);
    look.set(sway * 0.3, 1, flyZ - 26);
    camera.lookAt(look);
    controls.target.copy(look);
  } else {
    controls.update();
  }
  const focus = mode === 'fly' ? look : controls.target;
  desk.sun.target.position.set(focus.x, 0, focus.z);
  desk.sun.position.set(focus.x + 60, 90, focus.z + 50);
  desk.update(time);
  if (run) for (const r of racers) applyPose(r, run.pose(r, time % run.length, 'actor'));
  renderer.render(scene, camera);
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (playing) time += dt;
  frameAt(playing && mode === 'fly' ? dt : 0, dt);
});

/** For checking the villain: shows it and runs the page live. */
(window as unknown as Record<string, unknown>).villainView = () => {
  playing = true;
  showVillain(true);
};

/** For checking a moment by hand or from tests: orbit view of section `seg` (-1 = start) frozen at time t. */
(window as unknown as Record<string, unknown>).deskView = (seg: number, t: number) => {
  jump(seg);
  playing = false;
  time = t;
  syncButtons();
  frameAt(0);
  frameAt(0);
};

load(packIndex);
const seg = query.get('seg');
if (seg !== null) jump(Number(seg));
document.documentElement.dataset.ready = 'true';
