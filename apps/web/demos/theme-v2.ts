// Demo page for the theme renderer v2 (#64): a block-out course with every obstacle kind, a theme
// switcher (fixtureThemeV2 + procedurally painted test themes), per-feature toggles, quality presets,
// ground and particle overrides, a 50-swap leak test and a draw-call / memory readout.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GROUND_KINDS, PARTICLE_KINDS } from '@wobble/shared/constants';
import { assembleCourse, getObstacleKind } from '@wobble/shared';
import { fixtureThemeV2 } from '@wobble/shared/fixtures/index';
import type { Collider, CourseRecipe, ImageRef, ThemeDefV2 } from '@wobble/shared/types';
import { createEngine, type QualityPreset } from '../src/engine/index.ts';
import { createCourseRuntime, type CourseRuntime } from '../src/course/index.ts';
import {
  THEME_FEATURES,
  applyThemeV2,
  courseForTheme,
  createDressingLayer,
  urlImageSource,
  type ImageSource,
  type ThemeFeature,
  type ThemeRuntime,
} from '../src/theme/v2/index.ts';

const recipe: CourseRecipe = {
  version: 1,
  name: 'Theme Test Run',
  seed: 64,
  segments: [
    { type: 'sweeperRun', length: 'short', intensity: 3 },
    { type: 'pendulumAlley', length: 'short', intensity: 3 },
    { type: 'movingPlatforms', length: 'short', intensity: 3 },
    { type: 'spinnerDiscs', length: 'short', intensity: 2 },
    { type: 'bumperField', length: 'short', intensity: 2 },
  ],
};
const courseDef = assembleCourse(recipe);
const themeCourse = courseForTheme(courseDef);

// ---- procedural test images (canvas) --------------------------------------------------------

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, pal: string[]) => void;

function canvasOf(w: number, h: number, pal: string[], paint: Painter): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!, w, h, pal);
  return c;
}

const paintSky: Painter = (ctx, w, h, [top, mid, low, accent]) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(0.5, mid);
  g.addColorStop(1, low);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(w * 0.3, h * 0.25, h * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // distant mountain silhouettes just above the horizon
  for (let layer = 0; layer < 2; layer++) {
    ctx.globalAlpha = 0.35 + layer * 0.3;
    ctx.fillStyle = layer ? low : mid;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    for (let x = 0; x <= w; x += w / 48)
      ctx.lineTo(x, h / 2 - (Math.sin(x * 0.013 + layer * 2) * 0.5 + 0.6) * h * (0.08 - layer * 0.03));
    ctx.lineTo(w, h / 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 40; i++) ctx.fillRect((i * 97) % w, ((i * 53) % (h * 0.35)) + 4, 2, 2);
  ctx.globalAlpha = 1;
};

const paintTiles: Painter = (ctx, w, h, [a, b, line]) => {
  const n = 4;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? a : b;
      ctx.fillRect((x * w) / n, (y * h) / n, w / n, h / n);
    }
  ctx.strokeStyle = line;
  ctx.lineWidth = 6;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo((i * w) / n, 0);
    ctx.lineTo((i * w) / n, h);
    ctx.moveTo(0, (i * h) / n);
    ctx.lineTo(w, (i * h) / n);
    ctx.stroke();
  }
};

const paintSprite: Painter = (ctx, w, h, [trunk, crown, accent]) => {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = trunk;
  ctx.fillRect(w * 0.45, h * 0.5, w * 0.1, h * 0.5);
  ctx.fillStyle = crown;
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.38, w * 0.32, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(w * (0.3 + (i % 3) * 0.2), h * (0.28 + Math.floor(i / 3) * 0.18), w * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }
};

function paintBanner(text: string): Painter {
  return (ctx, w, h, [bg, fg, accent]) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    for (let x = 0; x < w; x += 40) {
      ctx.fillRect(x, 0, 20, 14);
      ctx.fillRect(x + 20, h - 14, 20, 14);
    }
    ctx.fillStyle = fg;
    ctx.font = `900 ${Math.round(h * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  };
}

interface DemoTheme {
  def: ThemeDefV2;
  images: ImageSource;
}

const ref = (src: string, w: number, h: number, alpha = false): ImageRef => ({ src, w, h, alpha, lowSrc: null });

function painted(def: ThemeDefV2, pal: string[], label: string): DemoTheme {
  const painters: Record<string, [number, number, Painter]> = {
    'sky.webp': [2048, 1024, paintSky],
    'platform.webp': [512, 512, paintTiles],
    'tree.webp': [256, 256, paintSprite],
    'banner.webp': [1024, 512, paintBanner(label)],
    'go.webp': [1024, 512, paintBanner('GO!')],
  };
  const cache = new Map<string, HTMLCanvasElement>();
  return {
    def,
    images: async (src, _ref, scale) => {
      const p = painters[src];
      if (!p) return null;
      const key = `${src}@${scale}`;
      if (!cache.has(key)) cache.set(key, canvasOf(Math.round(p[0] * scale), Math.round(p[1] * scale), pal, p[2]));
      return cache.get(key)!;
    },
  };
}

function variant(
  name: string,
  pal: [string, string, string, string],
  ground: ThemeDefV2['ground'],
  particles: ThemeDefV2['particles'],
  font: ThemeDefV2['hud']['font'],
): DemoTheme {
  const [top, mid, low, accent] = pal;
  const base = fixtureThemeV2;
  const def: ThemeDefV2 = {
    ...base,
    name,
    title: name,
    tagline: `${ground.kind} ground, ${particles.map((p) => p.kind).join(' + ')} in the air`,
    sky: { top, horizon: mid, bottom: low, image: ref('sky.webp', 2048, 1024) },
    fog: { color: mid, near: 60, far: 260 },
    light: { ...base.light, ambient: low, sun: '#ffffff' },
    materials: {
      ...base.materials,
      platformA: { ...base.materials.platformA, color: '#ffffff', texture: ref('platform.webp', 512, 512) },
      platformB: { ...base.materials.platformB, texture: ref('platform.webp', 512, 512) },
    },
    ground,
    particles,
    dressing: [
      ...base.dressing,
      {
        kind: 'sweeper',
        part: 1,
        prims: [{ shape: 'torus', pos: [0, 0, 0], rot: [0, Math.PI / 2, 0], scale: [0.8, 0.8, 0.8], color: accent }],
        hideBase: false,
      },
      {
        kind: 'movingPlatform',
        part: 0,
        prims: [
          { shape: 'cone', pos: [1.6, 0.8, 1.6], rot: [0, 0, 0], scale: [0.3, 0.5, 0.3], color: accent },
          { shape: 'cone', pos: [-1.6, 0.8, -1.6], rot: [0, 0, 0], scale: [0.3, 0.5, 0.3], color: accent },
        ],
        hideBase: false,
      },
    ],
    landmarks: [
      {
        anchor: 'finish',
        name: 'Tower',
        prims: [
          { shape: 'cylinder', pos: [0, 10, 0], rot: [0, 0, 0], scale: [4, 10, 4], color: low },
          { shape: 'cone', pos: [0, 24, 0], rot: [0, 0, 0], scale: [6, 4, 6], color: accent },
        ],
        scale: 1,
      },
      {
        anchor: 'skylineLeft',
        name: 'Peaks',
        prims: [
          { shape: 'cone', pos: [0, 15, 0], rot: [0, 0, 0], scale: [14, 15, 14], color: low },
          { shape: 'cone', pos: [18, 10, 12], rot: [0, 0, 0], scale: [10, 10, 10], color: mid },
        ],
        scale: 1.2,
      },
      {
        anchor: 'skylineRight',
        name: 'Arch',
        prims: [{ shape: 'torus', pos: [0, 8, 0], rot: [0, 0, 0], scale: [14, 14, 6], color: accent }],
        scale: 1,
      },
      {
        anchor: 'midway',
        name: 'Orb',
        prims: [
          { shape: 'sphere', pos: [0, 12, 0], rot: [0, 0, 0], scale: [5, 5, 5], color: accent, emissive: accent },
        ],
        scale: 1,
      },
    ],
    decor: [
      base.decor[0],
      {
        ...base.decor[1],
        name: 'Tree',
        image: ref('tree.webp', 256, 256, true),
        density: 0.7,
        minScale: 2,
        maxScale: 4,
      },
    ],
    signage: [
      { slot: 'startArch', image: ref('go.webp', 1024, 512) },
      { slot: 'checkpoint', image: ref('banner.webp', 1024, 512) },
      { slot: 'finishGate', image: ref('banner.webp', 1024, 512) },
      { slot: 'sideBanner', image: ref('banner.webp', 1024, 512) },
    ],
    hud: { accent, font },
  };
  return painted(def, [top, mid, low, accent], name.toUpperCase());
}

const THEMES: DemoTheme[] = [
  { def: fixtureThemeV2, images: urlImageSource('/event/themes/fixture/') },
  variant(
    'Ember Forge',
    ['#2b0f1f', '#ff7a3d', '#40121a', '#ffcf3d'],
    { kind: 'lava', color: '#ff5a1f', emissive: '#ff3300', motion: 0.4 },
    [
      { kind: 'embers', color: '#ffb347', density: 0.6, speed: 0.5 },
      { kind: 'ash', color: '#6b5f5a', density: 0.4, speed: 0.3 },
    ],
    'blocky',
  ),
  variant(
    'Frost Hollow',
    ['#6fa8dc', '#dff3ff', '#9fc5e8', '#4fd1ff'],
    { kind: 'ice', color: '#bfe8ff', emissive: null, motion: 0.1 },
    [{ kind: 'snow', color: '#ffffff', density: 0.8, speed: 0.3 }],
    'serif',
  ),
  variant(
    'Tide Pools',
    ['#0b3d5c', '#59c3c3', '#0e5a6b', '#ffe066'],
    { kind: 'water', color: '#1f8fb0', emissive: null, motion: 0.6 },
    [{ kind: 'bubbles', color: '#cff8ff', density: 0.5, speed: 0.4 }],
    'rounded',
  ),
  variant(
    'Dune Bazaar',
    ['#f6b26b', '#ffe599', '#c27c3e', '#e8336b'],
    { kind: 'sand', color: '#e5b770', emissive: null, motion: 0.2 },
    [{ kind: 'dust', color: '#fff2cc', density: 0.5, speed: 0.6 }],
    'handwritten',
  ),
  variant(
    'Goo Lab',
    ['#1a0f33', '#7b2ff7', '#13072b', '#6bff8a'],
    { kind: 'goo', color: '#45d96a', emissive: '#0f6b2a', motion: 0.5 },
    [{ kind: 'sparkles', color: '#c6ff6b', density: 0.5, speed: 0.3 }],
    'pixel',
  ),
];

// ---- scene -------------------------------------------------------------------------------------

const canvas = document.getElementById('game') as HTMLCanvasElement;
let quality: QualityPreset = 'medium';
const engine = createEngine({ canvas, quality, debug: false });
const { scene, camera, renderer } = engine;
camera.position.set(14, 14, 26);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 2, -20);
controls.update();

let themeIndex = 0;
let groundOverride: ThemeDefV2['ground']['kind'] | null = null;
let particleOverride: ThemeDefV2['particles'][number]['kind'] | null = null;
let noImages = false;
const enabled = new Map<ThemeFeature, boolean>(THEME_FEATURES.map((f) => [f, true]));
let theme: ThemeRuntime;
let course: CourseRuntime;
let dressing: ReturnType<typeof createDressingLayer>;

function currentDef(): ThemeDefV2 {
  const def = THEMES[themeIndex].def;
  return {
    ...def,
    ground: groundOverride ? { ...def.ground, kind: groundOverride } : def.ground,
    particles: particleOverride
      ? [{ kind: particleOverride, color: def.hud.accent, density: 0.7, speed: 0.4 }]
      : def.particles,
  };
}

function applyCurrent() {
  dressing?.dispose();
  course?.dispose();
  theme?.dispose();
  const entry = THEMES[themeIndex];
  theme = applyThemeV2(currentDef(), {
    scene,
    renderer,
    course: themeCourse,
    baseUrl: '/event/themes/fixture/',
    quality,
    imageSource: noImages ? async () => null : entry.images,
  });
  for (const [f, on] of enabled) theme.setFeature(f, on);
  course = createCourseRuntime({ courseDef, theme, scene });
  dressing = createDressingLayer({ getDressing: theme.getDressing, courseDef });
  scene.add(dressing.group);
  wire.rebuild(course.getColliders());
  document.getElementById('title')!.textContent = `${entry.def.title} — ${entry.def.tagline}`;
  refreshButtons();
}

// Collider wireframes, posed from the same colliders physics uses: proves dressing has no lag.
const wire = (() => {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const mat = new THREE.LineBasicMaterial({ color: '#00ff88', depthTest: false, transparent: true });
  const geos = {
    box: new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
    cylinder: new THREE.EdgesGeometry(new THREE.CylinderGeometry(1, 1, 2, 12)),
    sphere: new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 8, 6)),
  };
  let list: { c: Collider; line: THREE.LineSegments }[] = [];
  return {
    group,
    rebuild(colliders: readonly Collider[]) {
      group.clear();
      list = colliders
        .filter((c) => getObstacleKind(courseDef.entities.find((e) => e.id === c.entityId)!.kind))
        .map((c) => {
          const line = new THREE.LineSegments(geos[c.part.shape], mat);
          line.matrixAutoUpdate = false;
          line.renderOrder = 10;
          group.add(line);
          return { c, line };
        });
    },
    update() {
      if (!group.visible) return;
      for (const { c, line } of list) {
        const [a, b] = c.part.size;
        const s = c.part.shape === 'box' ? c.part.size : c.part.shape === 'cylinder' ? [a, b, a] : [a, a, a];
        line.matrix.compose(
          new THREE.Vector3(...c.pose.pos),
          new THREE.Quaternion(...c.pose.quat),
          new THREE.Vector3(s[0], s[1], s[2]),
        );
      }
    },
  };
})();

engine.onFixedUpdate((_dt, t) => course.stepColliders(t));
engine.onRender((_alpha, dt) => {
  course.update(engine.simTime);
  dressing.update(engine.simTime);
  theme.update(dt, camera);
  wire.update();
  controls.update();
});

// ---- UI ----------------------------------------------------------------------------------------

function button(parent: string, label: string, onClick: () => void, key: string) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.dataset.key = key;
  b.addEventListener('click', onClick);
  document.getElementById(parent)!.append(b);
  return b;
}

THEMES.forEach((t, i) => button('themes', t.def.title, () => ((themeIndex = i), applyCurrent()), `theme:${i}`));
(['low', 'medium', 'high'] as const).forEach((q) =>
  button('quality', q, () => ((quality = q), engine.setQuality(q), applyCurrent()), `quality:${q}`),
);
THEME_FEATURES.forEach((f) =>
  button(
    'features',
    f,
    () => {
      enabled.set(f, !enabled.get(f));
      theme.setFeature(f, enabled.get(f)!);
      refreshButtons();
    },
    `feature:${f}`,
  ),
);
button(
  'features',
  'dressing',
  () => ((dressing.group.visible = !dressing.group.visible), refreshButtons()),
  'dressing',
);
button('grounds', 'theme', () => ((groundOverride = null), applyCurrent()), 'ground:theme');
GROUND_KINDS.forEach((k) => button('grounds', k, () => ((groundOverride = k), applyCurrent()), `ground:${k}`));
button('particles', 'theme', () => ((particleOverride = null), applyCurrent()), 'particles:theme');
PARTICLE_KINDS.forEach((k) => button('particles', k, () => ((particleOverride = k), applyCurrent()), `particles:${k}`));

const noImgBtn = document.getElementById('noimg')!;
noImgBtn.addEventListener('click', () => ((noImages = !noImages), applyCurrent()));
const wireBtn = document.getElementById('wire')!;
wireBtn.addEventListener('click', () => ((wire.group.visible = !wire.group.visible), refreshButtons()));

function refreshButtons() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-key]')) {
    const [kind, value] = b.dataset.key!.split(':');
    const on =
      kind === 'theme'
        ? Number(value) === themeIndex
        : kind === 'quality'
          ? value === quality
          : kind === 'feature'
            ? enabled.get(value as ThemeFeature)!
            : kind === 'dressing'
              ? dressing?.group.visible
              : kind === 'ground'
                ? value === (groundOverride ?? 'theme')
                : value === (particleOverride ?? 'theme');
    b.setAttribute('aria-pressed', String(!!on));
  }
  noImgBtn.setAttribute('aria-pressed', String(noImages));
  wireBtn.setAttribute('aria-pressed', String(wire.group.visible));
}

let leakReport = '';
document.getElementById('swap50')!.addEventListener('click', async () => {
  await theme.ready;
  renderer.render(scene, camera);
  const before = { ...renderer.info.memory };
  const start = themeIndex;
  for (let i = 1; i <= 50; i++) {
    themeIndex = (start + i) % THEMES.length;
    applyCurrent();
    await theme.ready;
    renderer.render(scene, camera); // upload everything to the GPU
  }
  themeIndex = start;
  applyCurrent();
  await theme.ready;
  renderer.render(scene, camera);
  const after = renderer.info.memory;
  const same = before.geometries === after.geometries && before.textures === after.textures;
  leakReport = `50 swaps: geometries ${before.geometries}→${after.geometries}, textures ${before.textures}→${after.textures} ${same ? '✓ no leak' : '✗ LEAK'}`;
  console.info(`[theme-v2] ${leakReport}`);
});

setInterval(() => {
  const info = engine.info();
  const mem = renderer.info.memory;
  document.getElementById('stats')!.textContent = [
    `fps ${info.fps.toFixed(0)}  frame p95 ${info.frameMsP95.toFixed(1)} ms`,
    `draw calls ${info.drawCalls}  triangles ${info.triangles}`,
    `geometries ${mem.geometries}  textures ${mem.textures}  programs ${renderer.info.programs?.length ?? 0}`,
    `quality ${quality}  dressing on ${dressing.group.children.length} templates`,
    leakReport,
  ].join('\n');
}, 300);

applyCurrent();
engine.start();
