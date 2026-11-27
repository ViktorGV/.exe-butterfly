// Built-in themes (#16). Original designs, tuned for phone screens: calm, light floors, hot hazards,
// bright bounce pads, long fog so the course ahead is always visible.
import type { MaterialDef, Pack, Prim, ThemeDef } from '../../types.ts';

const CREATED = '2026-11-27T00:00:00.000Z';

const themePack = (slug: string, data: ThemeDef): Pack => ({
  id: `b:${slug}`,
  kind: 'theme',
  name: data.name,
  createdAt: CREATED,
  data,
});

const mat = (color: string, roughness: number, extra: Partial<MaterialDef> = {}): MaterialDef => ({
  color,
  roughness,
  metalness: 0,
  ...extra,
});

const p = (shape: Prim['shape'], pos: Prim['pos'], scale: Prim['scale'], color: string): Prim => ({
  shape,
  pos,
  rot: [0, 0, 0],
  scale,
  color,
});

export const CANDY_WORKSHOP = themePack('candy-workshop', {
  version: 1,
  name: 'Candy Workshop',
  sky: { top: '#ff9ed8', horizon: '#ffe0f0', bottom: '#fff6e8' },
  fog: { color: '#ffe0f0', near: 70, far: 260 },
  light: { ambient: '#fff0f8', ambientIntensity: 0.9, sun: '#fff4e0', sunIntensity: 2.2, sunDir: [-0.4, -1, -0.3] },
  materials: {
    platformA: mat('#ffd6ec', 0.5),
    platformB: mat('#c9f7ff', 0.5),
    hazard: mat('#ff1f4b', 0.35, { pattern: { type: 'stripes', colors: ['#ff1f4b', '#ffffff'], scale: 1 } }),
    bouncy: mat('#3dff8c', 0.3, { emissive: '#0a3d1f' }),
    accent: mat('#b46bff', 0.45),
    rail: mat('#ffffff', 0.6),
    finish: mat('#ffffff', 0.5, { pattern: { type: 'checker', colors: ['#ffffff', '#ff4fa3'], scale: 1 } }),
  },
  decor: [
    {
      name: 'Lollipop',
      prims: [p('cylinder', [0, 2, 0], [0.3, 4, 0.3], '#ffffff'), p('cylinder', [0, 4.6, 0], [3, 3, 0.5], '#ff4fa3')],
      density: 0.4,
      minScale: 0.8,
      maxScale: 1.6,
    },
    {
      name: 'Gumdrop',
      prims: [p('sphere', [0, 0.6, 0], [2, 1.6, 2], '#3dd6ff')],
      density: 0.5,
      minScale: 0.6,
      maxScale: 1.4,
    },
  ],
  music: { tempo: 128, scale: 'major', energy: 2 },
});

export const BATHTUB_BAY = themePack('bathtub-bay', {
  version: 1,
  name: 'Bathtub Bay',
  sky: { top: '#4fc3ff', horizon: '#d6f4ff', bottom: '#eaffff' },
  fog: { color: '#d6f4ff', near: 80, far: 300 },
  light: { ambient: '#f0fbff', ambientIntensity: 1, sun: '#ffffff', sunIntensity: 2, sunDir: [0.3, -1, -0.4] },
  materials: {
    platformA: mat('#ffffff', 0.3),
    platformB: mat('#a8ecff', 0.3),
    hazard: mat('#ff5a1f', 0.4, { pattern: { type: 'zigzag', colors: ['#ff5a1f', '#ffd23f'], scale: 1 } }),
    bouncy: mat('#ff4fd8', 0.25, { pattern: { type: 'dots', colors: ['#ff4fd8', '#ffffff'], scale: 1 } }),
    accent: mat('#ffe14a', 0.4),
    rail: mat('#2b8fff', 0.5),
    finish: mat('#ffffff', 0.4, { pattern: { type: 'checker', colors: ['#ffffff', '#2b8fff'], scale: 1 } }),
  },
  decor: [
    {
      name: 'Bubble cluster',
      prims: [
        p('sphere', [0, 1, 0], [1.6, 1.6, 1.6], '#e6fbff'),
        p('sphere', [1.2, 1.8, 0.4], [0.9, 0.9, 0.9], '#e6fbff'),
        p('sphere', [-0.8, 2.2, -0.3], [0.6, 0.6, 0.6], '#e6fbff'),
      ],
      density: 0.5,
      minScale: 0.6,
      maxScale: 2,
    },
    {
      name: 'Soap bar',
      prims: [p('box', [0, 0.4, 0], [3, 0.8, 1.8], '#ffb3e6')],
      density: 0.25,
      minScale: 0.8,
      maxScale: 1.5,
    },
  ],
  music: { tempo: 112, scale: 'pentatonic', energy: 1 },
});

export const MOONLIT_ARCADE = themePack('moonlit-arcade', {
  version: 1,
  name: 'Moonlit Arcade',
  sky: { top: '#1a0b4a', horizon: '#5b2bb8', bottom: '#2a1366' },
  fog: { color: '#3a1a80', near: 60, far: 240 },
  light: { ambient: '#b8a8ff', ambientIntensity: 1.2, sun: '#d8e4ff', sunIntensity: 2.4, sunDir: [-0.2, -1, 0.2] },
  materials: {
    platformA: mat('#4fd8ff', 0.4, { emissive: '#06303d' }),
    platformB: mat('#8f7bff', 0.4, { emissive: '#1a1240' }),
    hazard: mat('#ff2e63', 0.3, {
      emissive: '#4d0016',
      pattern: { type: 'stripes', colors: ['#ff2e63', '#ffe600'], scale: 1 },
    }),
    bouncy: mat('#b6ff00', 0.3, { emissive: '#2a3d00' }),
    accent: mat('#ffffff', 0.4, { emissive: '#303040' }),
    rail: mat('#ff4fd8', 0.4, { emissive: '#3d0a33' }),
    finish: mat('#ffffff', 0.4, { pattern: { type: 'checker', colors: ['#ffffff', '#1a0b4a'], scale: 1 } }),
  },
  decor: [
    {
      name: 'Neon pylon',
      prims: [p('box', [0, 3, 0], [0.6, 6, 0.6], '#ff4fd8'), p('sphere', [0, 6.4, 0], [1, 1, 1], '#4fd8ff')],
      density: 0.35,
      minScale: 0.8,
      maxScale: 1.5,
    },
    {
      name: 'Pixel cube',
      prims: [p('box', [0, 1, 0], [2, 2, 2], '#ffe600')],
      density: 0.3,
      minScale: 0.5,
      maxScale: 1.5,
    },
  ],
  music: { tempo: 140, scale: 'minor', energy: 3 },
});

export const GARDEN_PARTY = themePack('garden-party', {
  version: 1,
  name: 'Garden Party',
  sky: { top: '#6fd3ff', horizon: '#f2ffe0', bottom: '#fffbe0' },
  fog: { color: '#f2ffe0', near: 80, far: 320 },
  light: { ambient: '#f8fff0', ambientIntensity: 0.9, sun: '#fff2cc', sunIntensity: 2.6, sunDir: [-0.5, -1, -0.2] },
  materials: {
    platformA: mat('#8ee86b', 0.7, { pattern: { type: 'waves', colors: ['#8ee86b', '#7ad65a'], scale: 1.5 } }),
    platformB: mat('#ffe9a8', 0.7),
    hazard: mat('#e8003d', 0.4, { pattern: { type: 'dots', colors: ['#e8003d', '#ffffff'], scale: 1 } }),
    bouncy: mat('#00c8ff', 0.3),
    accent: mat('#ffb3e6', 0.5),
    rail: mat('#ffffff', 0.6),
    finish: mat('#ffffff', 0.5, { pattern: { type: 'checker', colors: ['#ffffff', '#ff7a00'], scale: 1 } }),
  },
  decor: [
    {
      name: 'Giant daisy',
      prims: [
        p('cylinder', [0, 1.5, 0], [0.3, 3, 0.3], '#3fae3a'),
        p('cylinder', [0, 3.1, 0], [2.4, 0.2, 2.4], '#ffffff'),
        p('sphere', [0, 3.3, 0], [0.9, 0.5, 0.9], '#ffc21a'),
      ],
      density: 0.45,
      minScale: 0.7,
      maxScale: 1.6,
    },
    {
      name: 'Hedge puff',
      prims: [p('sphere', [0, 1, 0], [3, 2, 3], '#4fc94a'), p('sphere', [1.6, 0.8, 0], [2, 1.6, 2], '#4fc94a')],
      density: 0.4,
      minScale: 0.7,
      maxScale: 1.4,
    },
    {
      name: 'Party lantern',
      prims: [p('sphere', [0, 4, 0], [0.9, 1.1, 0.9], '#ff4fa3'), p('cylinder', [0, 2, 0], [0.1, 4, 0.1], '#ffffff')],
      density: 0.25,
      minScale: 0.8,
      maxScale: 1.2,
    },
  ],
  music: { tempo: 118, scale: 'lydian', energy: 2 },
});

export const BUILTIN_THEMES: Pack[] = [CANDY_WORKSHOP, BATHTUB_BAY, MOONLIT_ARCADE, GARDEN_PARTY];
