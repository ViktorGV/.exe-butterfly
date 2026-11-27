// Built-in skins (#16). Original designs, tuned for small phone screens: bright bodies, dark or white
// eyes with strong contrast, small readable accessories. Together they cover every eye and mouth
// option, every pattern type and every accessory anchor.
import type { Pack, Prim, SkinDef } from '../../types.ts';

const CREATED = '2026-11-27T00:00:00.000Z';
const INK = '#1d1b2f';

const skinPack = (slug: string, data: SkinDef): Pack => ({
  id: `b:${slug}`,
  kind: 'skin',
  name: data.name,
  createdAt: CREATED,
  data,
});

const p = (
  shape: Prim['shape'],
  pos: Prim['pos'],
  scale: Prim['scale'],
  color: string,
  rot: Prim['rot'] = [0, 0, 0],
): Prim => ({
  shape,
  pos,
  rot,
  scale,
  color,
});

export const SUNNY_BEAN = skinPack('sunny-bean', {
  version: 1,
  name: 'Sunny Bean',
  body: {
    color: '#ffc21a',
    belly: '#fff1b8',
    pattern: { type: 'dots', colors: ['#ffc21a', '#ff8a1f'], scale: 1 },
    height: 1,
    girth: 1,
  },
  face: { eyes: 'dot', eyeColor: INK, mouth: 'smile', cheeks: '#ff7a9c' },
  limbs: { color: '#ffa41a' },
  accessories: [
    {
      anchor: 'headTop',
      prims: [
        p('cylinder', [0, 0.06, 0], [0.5, 0.06, 0.5], '#ff3d6e'),
        p('sphere', [0, 0.16, 0], [0.32, 0.22, 0.32], '#ff3d6e'),
        p('sphere', [0, 0.3, 0], [0.08, 0.08, 0.08], '#ffffff'),
      ],
    },
  ],
});

export const MINT_ZAP = skinPack('mint-zap', {
  version: 1,
  name: 'Mint Zap',
  body: {
    color: '#2fe6a7',
    belly: '#d6fff0',
    pattern: { type: 'stripes', colors: ['#2fe6a7', '#0fb47e'], scale: 1.5 },
    height: 1.05,
    girth: 0.95,
  },
  face: { eyes: 'wide', eyeColor: INK, mouth: 'grin', cheeks: null },
  limbs: { color: '#17c98b' },
  accessories: [
    {
      anchor: 'back',
      prims: [
        p('box', [0.08, 0.2, -0.12], [0.12, 0.34, 0.06], '#ffe600', [0, 0, 0.5]),
        p('box', [-0.06, -0.06, -0.12], [0.12, 0.34, 0.06], '#ffe600', [0, 0, 0.5]),
      ],
    },
  ],
});

export const GRAPE_FIZZ = skinPack('grape-fizz', {
  version: 1,
  name: 'Grape Fizz',
  body: {
    color: '#9b5cff',
    belly: '#e6d6ff',
    pattern: { type: 'checker', colors: ['#9b5cff', '#7a3df0'], scale: 1 },
    height: 0.95,
    girth: 1.05,
  },
  face: { eyes: 'oval', eyeColor: '#ffffff', mouth: 'o', cheeks: '#ff9de2' },
  limbs: { color: '#7a3df0' },
  accessories: [
    {
      anchor: 'face',
      prims: [
        p('torus', [0.13, 0, 0.04], [0.2, 0.2, 0.06], '#ffe600', [1.571, 0, 0]),
        p('torus', [-0.13, 0, 0.04], [0.2, 0.2, 0.06], '#ffe600', [1.571, 0, 0]),
        p('box', [0, 0, 0.04], [0.08, 0.03, 0.03], '#ffe600'),
      ],
    },
  ],
});

export const CORAL_DASH = skinPack('coral-dash', {
  version: 1,
  name: 'Coral Dash',
  body: {
    color: '#ff6b5a',
    belly: '#ffe0d6',
    pattern: { type: 'zigzag', colors: ['#ff6b5a', '#ffd23f'], scale: 1 },
    height: 1,
    girth: 1,
  },
  face: { eyes: 'star', eyeColor: INK, mouth: 'flat', cheeks: null },
  limbs: { color: '#e8503f' },
  accessories: [
    {
      anchor: 'waist',
      prims: [
        p('torus', [0, 0, 0], [0.9, 0.9, 0.16], '#2b7bff', [1.571, 0, 0]),
        p('box', [0, 0, 0.42], [0.14, 0.12, 0.06], '#ffd23f'),
      ],
    },
  ],
});

export const TIDE_POP = skinPack('tide-pop', {
  version: 1,
  name: 'Tide Pop',
  body: {
    color: '#29b6ff',
    belly: '#d9f3ff',
    pattern: { type: 'waves', colors: ['#29b6ff', '#ffffff'], scale: 1 },
    height: 1.1,
    girth: 0.9,
  },
  face: { eyes: 'sleepy', eyeColor: INK, mouth: 'none', cheeks: '#ff8fb1' },
  limbs: { color: '#1293e0' },
  accessories: [
    {
      anchor: 'headTop',
      prims: [p('cone', [0, 0.16, -0.04], [0.12, 0.32, 0.26], '#0f6fd6', [-0.3, 0, 0])],
    },
  ],
});

export const COMET_KID = skinPack('comet-kid', {
  version: 1,
  name: 'Comet Kid',
  body: {
    color: '#3247ff',
    belly: '#d8ddff',
    pattern: {
      type: 'custom',
      colors: ['#3247ff'],
      scale: 1,
      tile: [
        {
          kind: 'poly',
          fill: '#ffe600',
          x: 0.3,
          y: 0.3,
          points: [
            [0, -0.12],
            [0.035, -0.035],
            [0.12, 0],
            [0.035, 0.035],
            [0, 0.12],
            [-0.035, 0.035],
            [-0.12, 0],
            [-0.035, -0.035],
          ],
        },
        { kind: 'circle', fill: '#ffffff', x: 0.75, y: 0.7, r: 0.05 },
        { kind: 'circle', fill: '#ffffff', x: 0.95, y: 0.1, r: 0.04 },
      ],
    },
    height: 1,
    girth: 1,
  },
  face: { eyes: 'star', eyeColor: '#ffffff', mouth: 'smile', cheeks: null },
  limbs: { color: '#2232d9' },
  accessories: [
    {
      anchor: 'back',
      prims: [
        p('capsule', [0.12, 0, -0.16], [0.14, 0.36, 0.14], '#d9dde8'),
        p('capsule', [-0.12, 0, -0.16], [0.14, 0.36, 0.14], '#d9dde8'),
        p('cone', [0.12, -0.26, -0.16], [0.12, 0.18, 0.12], '#ff7a00', [3.142, 0, 0]),
        p('cone', [-0.12, -0.26, -0.16], [0.12, 0.18, 0.12], '#ff7a00', [3.142, 0, 0]),
      ],
    },
  ],
});

export const PLAIN_JELLY = skinPack('plain-jelly', {
  version: 1,
  name: 'Plain Jelly',
  body: {
    color: '#ff4fa3',
    belly: '#ffd6ea',
    pattern: { type: 'none', colors: ['#ff4fa3'], scale: 1 },
    height: 0.9,
    girth: 1.1,
  },
  face: { eyes: 'dot', eyeColor: INK, mouth: 'o', cheeks: null },
  limbs: { color: '#e83a8c' },
  accessories: [],
});

export const BERRY_KNIGHT = skinPack('berry-knight', {
  version: 1,
  name: 'Berry Knight',
  body: {
    color: '#e8174a',
    belly: '#ffd0da',
    pattern: { type: 'stripes', colors: ['#e8174a', '#ffffff', '#ff8fa8'], scale: 2 },
    height: 1.05,
    girth: 1.05,
  },
  face: { eyes: 'wide', eyeColor: '#ffffff', mouth: 'flat', cheeks: null },
  limbs: { color: '#b80f37' },
  accessories: [
    {
      anchor: 'headTop',
      prims: [
        p('sphere', [0, 0.04, 0], [0.52, 0.26, 0.52], '#c9ced9'),
        p('box', [0, 0.24, 0], [0.06, 0.24, 0.22], '#3dd6ff'),
      ],
    },
  ],
});

export const LEMON_DROP = skinPack('lemon-drop', {
  version: 1,
  name: 'Lemon Drop',
  body: {
    color: '#e6ff3d',
    belly: '#fbffd6',
    pattern: {
      type: 'custom',
      colors: ['#e6ff3d', '#ffffff'],
      scale: 0.5,
      tile: [
        { kind: 'circle', fill: '#9ad600', x: 0.25, y: 0.25, r: 0.14 },
        { kind: 'circle', fill: '#ffffff', x: 0.25, y: 0.25, r: 0.06 },
        { kind: 'rect', fill: '#9ad600', x: 0.75, y: 0.75, w: 0.24, h: 0.08, rot: 0.785 },
      ],
    },
    height: 1,
    girth: 1,
  },
  face: { eyes: 'sleepy', eyeColor: INK, mouth: 'grin', cheeks: '#ffa64d' },
  limbs: { color: '#c4e000' },
  accessories: [
    {
      anchor: 'face',
      prims: [
        p('box', [0.12, 0.02, 0.05], [0.18, 0.1, 0.03], INK),
        p('box', [-0.12, 0.02, 0.05], [0.18, 0.1, 0.03], INK),
        p('box', [0, 0.04, 0.05], [0.08, 0.02, 0.02], INK),
      ],
    },
  ],
});

export const FROST_PUFF = skinPack('frost-puff', {
  version: 1,
  name: 'Frost Puff',
  body: {
    color: '#9fe8ff',
    belly: '#ffffff',
    pattern: { type: 'waves', colors: ['#9fe8ff', '#4fa8ff'], scale: 0.75 },
    height: 0.95,
    girth: 1.1,
  },
  face: { eyes: 'oval', eyeColor: INK, mouth: 'smile', cheeks: '#ff9ecb' },
  limbs: { color: '#6fd0f5' },
  accessories: [
    {
      anchor: 'headTop',
      prims: [
        p('sphere', [0, 0.06, 0], [0.5, 0.3, 0.5], '#ff3d6e'),
        p('sphere', [0, 0.26, 0], [0.14, 0.14, 0.14], '#ffffff'),
      ],
    },
    {
      anchor: 'waist',
      prims: [
        p('torus', [0, 0.3, 0], [0.72, 0.72, 0.18], '#ff3d6e', [1.571, 0, 0]),
        p('box', [0.16, 0.16, 0.34], [0.12, 0.3, 0.05], '#ff3d6e'),
      ],
    },
  ],
});

export const LAVA_JOGGER = skinPack('lava-jogger', {
  version: 1,
  name: 'Lava Jogger',
  body: {
    color: '#ff4a1c',
    belly: '#ffd23f',
    pattern: { type: 'zigzag', colors: ['#ff4a1c', '#ffb300', '#ffe14a'], scale: 1.5 },
    height: 1.1,
    girth: 1,
  },
  face: { eyes: 'dot', eyeColor: INK, mouth: 'grin', cheeks: null },
  limbs: { color: '#d93a10' },
  accessories: [
    {
      anchor: 'back',
      prims: [
        p('cone', [0, 0.18, -0.2], [0.08, 0.28, 0.2], '#ffd23f', [-0.4, 0, 0]),
        p('cone', [0, -0.04, -0.22], [0.07, 0.22, 0.16], '#ffd23f', [-0.4, 0, 0]),
      ],
    },
  ],
});

export const COCOA_CUB = skinPack('cocoa-cub', {
  version: 1,
  name: 'Cocoa Cub',
  body: {
    color: '#b8743d',
    belly: '#ffe3c2',
    pattern: { type: 'dots', colors: ['#b8743d', '#ffe3c2', '#ff9de2'], scale: 0.75 },
    height: 0.9,
    girth: 1.15,
  },
  face: { eyes: 'oval', eyeColor: INK, mouth: 'none', cheeks: '#ff8fb1' },
  limbs: { color: '#8f5428' },
  accessories: [
    {
      anchor: 'headTop',
      prims: [
        p('sphere', [0.2, 0.02, 0], [0.18, 0.18, 0.1], '#8f5428'),
        p('sphere', [-0.2, 0.02, 0], [0.18, 0.18, 0.1], '#8f5428'),
      ],
    },
  ],
});

export const BUILTIN_SKINS: Pack[] = [
  SUNNY_BEAN,
  MINT_ZAP,
  GRAPE_FIZZ,
  CORAL_DASH,
  TIDE_POP,
  COMET_KID,
  PLAIN_JELLY,
  BERRY_KNIGHT,
  LEMON_DROP,
  FROST_PUFF,
  LAVA_JOGGER,
  COCOA_CUB,
];
