// Hand-written fixtures so every module can be built and tested before the others exist.
// Owned by #2. Course layout (toward -Z): start pad -> platform -> platform -> checkpoint pad -> platform -> finish pad.
import type {
  CourseDef,
  CourseRecipe,
  EntityDef,
  EventManifest,
  EventRoster,
  ImageRef,
  MaterialSlot,
  Pack,
  SkinDef,
  ThemeDefV1,
  ThemeDefV2,
  Vec3,
} from '../types.ts';

export const fixtureSkin: SkinDef = {
  version: 1,
  name: 'Pip',
  body: {
    color: '#ff8a3d',
    belly: '#ffe4b8',
    pattern: { type: 'dots', colors: ['#ff8a3d', '#ffd166'], scale: 1 },
    height: 1,
    girth: 1,
  },
  face: { eyes: 'oval', eyeColor: '#1d1b2f', mouth: 'smile', cheeks: '#ff6b8b' },
  limbs: { color: '#e8702b' },
  accessories: [
    {
      anchor: 'headTop',
      prims: [
        { shape: 'cone', pos: [0, 0.18, 0], rot: [0, 0, 0], scale: [0.28, 0.36, 0.28], color: '#4cc9f0' },
        { shape: 'sphere', pos: [0, 0.4, 0], rot: [0, 0, 0], scale: [0.08, 0.08, 0.08], color: '#ffffff' },
      ],
    },
  ],
};

export const fixtureTheme: ThemeDefV1 = {
  version: 1,
  name: 'Sherbet Sky',
  sky: { top: '#5ec8ff', horizon: '#ffd9f2', bottom: '#fff4d6' },
  fog: { color: '#ffd9f2', near: 60, far: 220 },
  light: {
    ambient: '#fff1fa',
    ambientIntensity: 0.9,
    sun: '#fff6e0',
    sunIntensity: 2.2,
    sunDir: [-0.4, -1, -0.3],
  },
  materials: {
    platformA: { color: '#7ad7ff', roughness: 0.55, metalness: 0 },
    platformB: { color: '#b49cff', roughness: 0.55, metalness: 0 },
    hazard: {
      color: '#ff4f6d',
      roughness: 0.4,
      metalness: 0,
      pattern: { type: 'stripes', colors: ['#ff4f6d', '#ffffff'], scale: 1 },
    },
    bouncy: { color: '#ffd23f', roughness: 0.3, metalness: 0, emissive: '#3d2a00' },
    accent: { color: '#5cf2a4', roughness: 0.5, metalness: 0 },
    rail: { color: '#ffffff', roughness: 0.6, metalness: 0 },
    finish: {
      color: '#ffffff',
      roughness: 0.5,
      metalness: 0,
      pattern: { type: 'checker', colors: ['#ffffff', '#ff6bd5'], scale: 1 },
    },
  },
  decor: [
    {
      name: 'Cloud puff',
      prims: [
        { shape: 'sphere', pos: [0, 0, 0], rot: [0, 0, 0], scale: [2, 1.4, 2], color: '#ffffff' },
        { shape: 'sphere', pos: [1.6, -0.2, 0], rot: [0, 0, 0], scale: [1.4, 1, 1.4], color: '#ffffff' },
      ],
      density: 0.4,
      minScale: 0.8,
      maxScale: 2,
    },
  ],
  music: { tempo: 120, scale: 'major', energy: 2 },
};

export const fixtureRecipe: CourseRecipe = {
  version: 1,
  name: 'Fixture Dash',
  seed: 1234,
  segments: [
    { type: 'sweeperRun', length: 'short', intensity: 2 },
    { type: 'movingPlatforms', length: 'short', intensity: 2 },
    { type: 'bumperField', length: 'short', intensity: 2 },
    { type: 'narrowBridges', length: 'short', intensity: 2 },
  ],
};

const platform = (id: number, pos: Vec3, size: Vec3, slot: MaterialSlot): EntityDef => ({
  id,
  kind: 'platform',
  pos,
  yaw: 0,
  params: { size, slot },
});

export const fixtureCourse: CourseDef = {
  version: 1,
  id: 'fixture-course',
  name: 'Fixture Course',
  // 20 columns x 15 rows at 1 m = 300 slots on the start pad (pad spans z -10..10).
  spawn: { pos: [0, 0, -9], yaw: 0, cols: 20, spacing: 1 },
  checkpoints: [
    {
      volume: { pos: [0, 1.5, -36], yaw: 0, half: [12, 1.5, 8] },
      respawn: { pos: [0, 0, -43], yaw: 0, cols: 20, spacing: 1 },
    },
  ],
  finish: { pos: [0, 1.5, -62], yaw: 0, half: [12, 1.5, 4] },
  killY: -10,
  bounds: { min: [-30, -12, -80], max: [30, 20, 20] },
  entities: [
    platform(0, [0, 0, 0], [24, 1, 20], 'platformA'), // start pad, z -10..10
    platform(1, [0, 0, -15], [12, 1, 6], 'platformB'), // z -12..-18
    platform(2, [0, 0, -23], [12, 1, 6], 'platformA'), // z -20..-26
    platform(3, [0, 0, -36], [24, 1, 16], 'accent'), // checkpoint pad, z -28..-44
    platform(4, [0, 0, -49], [12, 1, 6], 'platformB'), // z -46..-52
    platform(5, [0, 0, -60], [24, 1, 12], 'finish'), // finish pad, z -54..-66
  ],
  parTimeMs: 15000,
  timeLimitMs: 120000,
};

const CREATED = '2026-01-01T00:00:00.000Z';

export const fixtureSkinPack: Pack = {
  id: 'b:fixture-skin',
  kind: 'skin',
  name: fixtureSkin.name,
  createdAt: CREATED,
  data: fixtureSkin,
};
export const fixtureThemePack: Pack = {
  id: 'b:fixture-theme',
  kind: 'theme',
  name: fixtureTheme.name,
  createdAt: CREATED,
  data: fixtureTheme,
};
export const fixtureCoursePack: Pack = {
  id: 'b:fixture-course',
  kind: 'course',
  name: fixtureRecipe.name,
  createdAt: CREATED,
  data: fixtureRecipe,
};

// ---- event mode (#54) -------------------------------------------------------
// Placeholder images live in apps/web/public/event/themes/fixture/ (1x1 WebP files).

const img = (src: string, alpha = false): ImageRef => ({ src, w: 1, h: 1, alpha, lowSrc: null });

/** A ThemeDef v2 that uses every field. Built from fixtureTheme's colours. */
export const fixtureThemeV2: ThemeDefV2 = {
  version: 2,
  name: 'Sherbet Sky',
  title: 'Sherbet Sky',
  tagline: 'Race through a sky made of ice cream clouds',
  credit: null,
  sky: { ...fixtureTheme.sky, image: { ...img('sky.webp'), lowSrc: 'sky@0.5x.webp' } },
  fog: fixtureTheme.fog,
  light: fixtureTheme.light,
  materials: Object.fromEntries(
    Object.entries(fixtureTheme.materials).map(([slot, m]) => [
      slot,
      { ...m, texture: slot === 'platformA' ? img('platform.webp') : null },
    ]),
  ) as ThemeDefV2['materials'],
  ground: { kind: 'clouds', color: '#ffffff', emissive: null, motion: 0.3 },
  particles: [{ kind: 'sparkles', color: '#fff6a8', density: 0.4, speed: 0.3 }],
  dressing: [
    {
      kind: 'pendulum',
      part: 0,
      prims: [{ shape: 'sphere', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1.2, 1.2, 1.2], color: '#ff6bd5' }],
      hideBase: false,
      slot: null,
    },
  ],
  landmarks: [
    {
      anchor: 'finish',
      name: 'Cone tower',
      prims: [{ shape: 'cone', pos: [0, 6, 0], rot: [Math.PI, 0, 0], scale: [3, 8, 3], color: '#ffd9a0' }],
      scale: 1,
    },
  ],
  decor: [
    {
      type: 'prims',
      name: 'Cloud puff',
      prims: fixtureTheme.decor[0]!.prims,
      image: null,
      density: 0.4,
      minScale: 0.8,
      maxScale: 2,
    },
    {
      type: 'sprite',
      name: 'Balloon',
      prims: [],
      image: img('balloon.webp', true),
      density: 0.2,
      minScale: 1,
      maxScale: 1.5,
    },
  ],
  signage: [{ slot: 'startArch', image: img('banner.webp') }],
  costume: {
    palette: ['#ff8a3d', '#7ad7ff', '#b49cff', '#ffd23f'],
    accessories: [
      {
        name: 'Wafer hat',
        anchor: 'headTop',
        prims: [{ shape: 'cone', pos: [0, 0.2, 0], rot: [0, 0, 0], scale: [0.3, 0.4, 0.3], color: '#e8b76b' }],
      },
    ],
    eyes: ['oval', 'star'],
    mouths: ['smile', 'grin'],
  },
  fx: { confetti: ['#ff6bd5', '#7ad7ff', '#ffd23f'], checkpoint: '#5cf2a4', hit: '#ff4f6d' },
  hud: { accent: '#ff6bd5', font: 'rounded' },
  music: { ...fixtureTheme.music, instrument: 'marimba', swing: 0.2 },
  art: { voteCard: img('vote-card.webp'), reveal: null, podium: null },
  cast: {
    hero: { name: 'Captain Sprinkle', description: 'A cheerful cone pilot who builds bridges out of wafers.' },
    villain: { name: 'Brain Freeze', description: 'A grumpy frost cloud that cracks the floor under bullies.' },
  },
};

export const fixtureThemeV2Pack: Pack = {
  id: 'e:theme-fixture',
  kind: 'theme',
  name: fixtureThemeV2.name,
  createdAt: CREATED,
  data: fixtureThemeV2,
};

/** Five themes that all point at the fixture theme. */
export const fixtureManifest: EventManifest = {
  version: 1,
  eventId: 'fixture-event',
  courseId: 'b:fixture-course',
  themes: [1, 2, 3, 4, 5].map((n) => ({
    id: `e:theme-fixture-${n}`,
    title: `${fixtureThemeV2.title} ${n}`,
    tagline: fixtureThemeV2.tagline,
    credit: n === 1 ? 'pip' : null,
    voteCard: '/event/themes/fixture/vote-card.webp',
    swatch: [fixtureThemeV2.sky.top, fixtureThemeV2.materials.platformA.color, fixtureThemeV2.hud.accent],
  })),
  pools: { 'e:theme-fixture-1': ['b:fixture-skin'] },
};

/** Two roster entries; the second was screened out as too vague. Keys are made-up hex, not real HMACs. */
export const fixtureRoster: EventRoster = {
  version: 1,
  eventId: 'fixture-event',
  entries: {
    '0123456789abcdef0123456789abcdef': {
      characterPrompt: 'A pink bubble-gum princess with a tiny crown',
      skins: { 'e:theme-fixture-1': 'b:fixture-skin' },
    },
    fedcba9876543210fedcba9876543210: { characterPrompt: null, skins: {} },
  },
};
