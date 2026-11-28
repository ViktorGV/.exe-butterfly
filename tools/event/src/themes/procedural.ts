// A complete draft built locally from the selection pick. It answers the art-direction calls in mock mode,
// is the fallback when a real call fails, and fills any slot the model left empty (#59).
import { MUSIC_INSTRUMENTS } from '@wobble/shared';
import { mixHex } from '../images/color.ts';
import type { Draft, LookDraft, PropsDraft } from './draft.ts';
import { createRng, seedFrom } from '../lib/hash.ts';
import { dressableBriefs, obstacleBriefs } from './obstacles.ts';
import type { Pick } from './selection.ts';

const BRIEFS = obstacleBriefs();

type Prim = PropsDraft['decor'][number]['prims'][number];
type Shape = Prim['shape'];
type Triple = [number, number, number];

const xyz = ([x, y, z]: Triple) => ({ x, y, z });

const prim = (shape: Shape, pos: Triple, scale: Triple, color: string, rot: Triple = [0, 0, 0]): Prim => ({
  shape,
  pos: xyz(pos),
  rot: xyz(rot),
  scale: xyz(scale),
  color,
  emissive: '',
});

const FALLBACK_PALETTE = ['#4aa8ff', '#b49cff', '#ff8a3d', '#ff6bd5', '#5cf2a4'];

const GROUNDS: [RegExp, LookDraft['ground']['kind'], LookDraft['particles'][number]['kind']][] = [
  [/lava|volcan|fire|magma|forge/, 'lava', 'embers'],
  [/ice|snow|frozen|glacier|winter|arctic/, 'ice', 'snow'],
  [/water|ocean|sea|reef|lake|river|pirate/, 'water', 'bubbles'],
  [/goo|slime|swamp|jelly|toxic/, 'goo', 'bubbles'],
  [/desert|sand|beach|dune|canyon/, 'sand', 'dust'],
  [/cloud|sky|air|heaven|balloon/, 'clouds', 'sparkles'],
  [/forest|jungle|garden|tree|autumn/, 'void', 'leaves'],
  [/flower|blossom|candy|cake|dessert/, 'clouds', 'petals'],
];

const HERO_TITLES = ['Captain', 'Pilot', 'Keeper', 'Ranger', 'Scout', 'Warden'];
const HERO_NAMES = ['Pipwick', 'Lumo', 'Tansy', 'Brill', 'Juniper', 'Zibby', 'Marlo', 'Fennick'];
const VILLAIN_TITLES = ['Baron', 'Madame', 'Count', 'Old', 'Sir', 'Doctor'];
const VILLAIN_NAMES = ['Grumblewick', 'Snarlop', 'Vexby', 'Mudgrim', 'Sourpatter', 'Klonk', 'Frownelle', 'Skreet'];

export function proceduralDraft(pick: Pick): Draft {
  const rng = createRng(seedFrom(`procedural:${pick.slug}`));
  const choose = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
  const p = [...pick.paletteHint, ...FALLBACK_PALETTE].slice(0, 5);
  const title = pick.titleIdea;
  const setting = pick.settingTags[0] ?? title.toLowerCase();
  const tags = [pick.themePrompt, ...pick.settingTags, ...pick.moodTags].join(' ').toLowerCase();
  const [, ground, particle] = GROUNDS.find(([re]) => re.test(tags)) ?? [null, 'void', 'sparkles'];
  const horizon = mixHex(p[1], '#ffffff', 0.55);

  const material = (slot: LookDraft['materials'][number]['slot'], color: string, pattern: 'none' | 'stripes') => ({
    slot,
    color,
    roughness: 0.65,
    metalness: 0.05,
    emissive: '',
    pattern,
    patternColors: pattern === 'none' ? [] : [color, mixHex(color, '#ffffff', 0.35)],
    patternScale: 1,
  });

  const picture = (what: string) => `${what} for a party obstacle course themed "${title}": ${pick.themePrompt}`;

  const look: LookDraft = {
    name: title,
    title,
    tagline: pick.summary || `Wobble through ${title}`,
    sky: { top: p[0], horizon, bottom: mixHex(p[2], '#ffffff', 0.3) },
    fog: { color: horizon, near: 45, far: 200 },
    light: {
      ambient: '#ffffff',
      ambientIntensity: 0.8,
      sun: '#fff4d6',
      sunIntensity: 1.4,
      sunDir: { x: 0.4, y: 0.8, z: 0.45 },
    },
    materials: [
      material('platformA', mixHex(p[0], '#ffffff', 0.35), 'stripes'),
      material('platformB', mixHex(p[1], '#ffffff', 0.2), 'none'),
      material('hazard', '#e8272f', 'stripes'),
      material('bouncy', '#ffd400', 'none'),
      material('accent', p[2], 'none'),
      material('rail', '#f4f1ff', 'none'),
      material('finish', '#00a86b', 'stripes'),
    ],
    ground: { kind: ground, color: mixHex(p[3], '#101826', 0.6), emissive: '', motion: 0.3 },
    particles: [
      { kind: particle, color: mixHex(p[4], '#ffffff', 0.5), density: 0.35, speed: 0.3 },
      {
        kind: particle === 'sparkles' ? 'dust' : 'sparkles',
        color: mixHex(p[2], '#ffffff', 0.3),
        density: 0.6,
        speed: 0.8,
      },
    ],
    fx: { confetti: p.slice(0, 4), checkpoint: '#5cf2a4', hit: '#ff4f6d' },
    hud: { accent: p[3], font: choose(['rounded', 'blocky', 'handwritten'] as const) },
    music: {
      tempo: 108 + Math.floor(rng() * 28),
      scale: choose(['major', 'minor', 'pentatonic', 'lydian'] as const),
      energy: 2,
      instrument: choose(MUSIC_INSTRUMENTS),
      swing: Math.round(rng() * 30) / 100,
    },
    cast: {
      hero: {
        name: `${choose(HERO_TITLES)} ${choose(HERO_NAMES)}`,
        description: `A cheerful guide from the ${setting} who builds bridges for kind racers.`.slice(0, 160),
      },
      villain: {
        name: `${choose(VILLAIN_TITLES)} ${choose(VILLAIN_NAMES)}`,
        description: `A grumpy schemer of the ${setting} who throws things at pushy racers.`.slice(0, 160),
      },
    },
    images: {
      skybox: picture(`A wide panoramic sky and distant ${setting} scenery, horizon in the middle`),
      textures: [
        {
          slots: ['platformA', 'platformB'],
          prompt: picture(`A calm, low-contrast walkable ground surface from ${setting}`),
        },
        { slots: ['hazard'], prompt: picture('A bold warning surface in strong red') },
        { slots: ['bouncy'], prompt: picture('A soft springy rubbery surface in bright yellow') },
        { slots: ['accent', 'rail', 'finish'], prompt: picture(`A decorative trim surface from ${setting}`) },
      ],
      sprites: ['plant', 'floating object', 'creature', 'lamp', 'rock', 'flag', 'balloon', 'sign post'].map(
        (thing, i) => ({
          name: thing,
          prompt: picture(`A single ${thing} that belongs in ${setting}`),
          density: i < 3 ? 0.25 : 0.15,
          minScale: 1,
          maxScale: 2,
        }),
      ),
      signage: (['startArch', 'finishGate', 'checkpoint', 'sideBanner'] as const).map((slot) => ({
        slot,
        prompt: picture(`A decorative banner without any writing, for the ${slot}`),
      })),
      voteCard: picture('A postcard view that shows the whole mood at a glance'),
      reveal: picture('A dramatic wide establishing shot'),
      podium: picture('A festive stage backdrop with an empty centre'),
    },
  };

  const tower = (name: string, anchor: PropsDraft['landmarks'][number]['anchor'], x: number, color: string) => ({
    anchor,
    name,
    scale: 1,
    prims: [
      prim('cylinder', [x, 3, 0], [3, 6, 3], color),
      prim('sphere', [x, 7.5, 0], [4, 4, 4], mixHex(color, '#ffffff', 0.3)),
      prim('cone', [x, 11, 0], [2.5, 4, 2.5], p[3]),
    ],
  });

  // A shell matching the part (so the base can hide) plus a trim band, a cap and a glowing stud.
  type Kind = PropsDraft['dressing'][number]['kind'];
  type Slot = PropsDraft['dressing'][number]['slot'];
  const dress = (kind: Kind, part: number, shape: Shape, color: string, slot: Slot = 'none') => {
    const info = BRIEFS.find((b) => b.kind === kind)?.parts[part];
    const [hx, hy, hz] = info?.halfExtents ?? [0.5, 0.5, 0.5];
    const base = info?.shape === 'box' ? 'box' : info?.shape === 'sphere' ? 'sphere' : 'cylinder';
    const trim = mixHex(color, '#000000', 0.35);
    return {
      kind,
      part,
      hideBase: true,
      slot,
      prims: [
        prim(base, [0, 0, 0], [hx * 1.04, hy * 1.04, hz * 1.04], color),
        prim('box', [0, 0, 0], [hx * 1.08, Math.min(hy, 0.12) * 1.1, hz * 1.08], trim),
        prim(shape, [0, hy + 0.08, 0], [Math.min(hx, 0.35), 0.12, Math.min(hz, 0.35)], trim),
        { ...prim('sphere', [0, hy + 0.2, 0], [0.1, 0.1, 0.1], '#ffffff'), emissive: color },
      ],
    };
  };

  const wear = (name: string, anchor: PropsDraft['costume']['accessories'][number]['anchor'], prims: Prim[]) => ({
    name,
    anchor,
    prims,
  });

  const props: PropsDraft = {
    // Every part of every obstacle kind, textured with its own slot (24 is the contract maximum).
    dressing: dressableBriefs()
      .flatMap((b) =>
        b.parts.map((part, i) => {
          const hazard = part.slot === 'hazard';
          const color = hazard ? '#e8272f' : part.slot === 'bouncy' ? '#ffd400' : p[(i + b.kind.length) % p.length];
          return dress(b.kind as Kind, part.part, hazard ? 'cone' : 'sphere', color, part.slot as Slot);
        }),
      )
      .slice(0, 24),
    landmarks: [
      tower(`${title} Gate`.slice(0, 24), 'finish', 0, p[2]),
      tower('Left Spire', 'skylineLeft', -4, p[1]),
      tower('Right Spire', 'skylineRight', 4, p[4]),
    ],
    decor: [
      {
        name: 'Puff',
        density: 0.3,
        minScale: 0.8,
        maxScale: 2,
        prims: [prim('sphere', [0, 0, 0], [2, 1.4, 2], horizon), prim('sphere', [1.2, 0.2, 0], [1.4, 1, 1.4], horizon)],
      },
      {
        name: 'Post',
        density: 0.2,
        minScale: 0.8,
        maxScale: 1.6,
        prims: [prim('cylinder', [0, 1, 0], [0.4, 2, 0.4], p[3]), prim('sphere', [0, 2.3, 0], [0.9, 0.9, 0.9], p[2])],
      },
    ],
    costume: {
      palette: p,
      eyes: ['oval', 'dot', 'star'],
      mouths: ['smile', 'grin', 'o'],
      accessories: [
        wear('Party cone', 'headTop', [prim('cone', [0, 0.2, 0], [0.3, 0.4, 0.3], p[2])]),
        wear('Round cap', 'headTop', [prim('sphere', [0, 0.05, 0], [0.45, 0.2, 0.45], p[0])]),
        wear('Antenna', 'headTop', [
          prim('cylinder', [0, 0.2, 0], [0.04, 0.35, 0.04], '#f4f1ff'),
          prim('sphere', [0, 0.42, 0], [0.14, 0.14, 0.14], p[3]),
        ]),
        wear('Halo', 'headTop', [prim('torus', [0, 0.3, 0], [0.4, 0.4, 0.4], p[4], [1.571, 0, 0])]),
        wear('Goggles', 'face', [
          prim('torus', [-0.12, 0, 0], [0.16, 0.16, 0.16], p[1]),
          prim('torus', [0.12, 0, 0], [0.16, 0.16, 0.16], p[1]),
        ]),
        wear('Nose bobble', 'face', [prim('sphere', [0, -0.08, 0.02], [0.12, 0.12, 0.12], p[3])]),
        wear('Backpack', 'back', [prim('box', [0, 0, 0.1], [0.35, 0.4, 0.2], p[2])]),
        wear('Short cape', 'back', [prim('box', [0, -0.1, 0.05], [0.5, 0.6, 0.04], p[1])]),
        wear('Belt', 'waist', [prim('torus', [0, 0, 0], [0.65, 0.65, 0.65], p[4], [1.571, 0, 0])]),
      ],
    },
  };

  return { look, props };
}
