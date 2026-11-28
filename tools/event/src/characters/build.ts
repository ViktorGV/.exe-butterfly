// Deterministic SkinDef builder (#63). Used by mock mode, and as the fallback when a model's
// skin fails the sanitizer, so every `ok` submitter always ends up with 5 skins.
import type { CostumeKit, SkinDef } from '@wobble/shared';
import type { Traits } from './types.ts';

type Prim = SkinDef['accessories'][number]['prims'][number];
type Accessory = SkinDef['accessories'][number];
type Anchor = Accessory['anchor'];

export type Rng = () => number;

/** FNV-1a 32-bit. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** mulberry32 */
export function rngFrom(seed: string): Rng {
  let a = hash32(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;
const round = (n: number) => Math.round(n * 1000) / 1000;

function prim(
  shape: Prim['shape'],
  pos: Prim['pos'],
  scale: Prim['scale'],
  color: string,
  rot: Prim['rot'] = [0, 0, 0],
) {
  return { shape, pos, rot, scale, color } satisfies Prim;
}

/** Shift a hex colour's brightness by `amount` (-1..1). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)))),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Small prim sets for the motifs the screener knows. Anything else becomes a little badge. */
function motifAccessory(motif: string, color: string): Accessory {
  const c2 = shade(color, 0.35);
  switch (motif) {
    case 'crown':
      return {
        anchor: 'headTop',
        prims: [
          prim('torus', [0, 0.05, 0], [0.18, 0.18, 0.08], color, [Math.PI / 2, 0, 0]),
          prim('cone', [0.1, 0.14, 0], [0.05, 0.1, 0.05], c2),
          prim('cone', [-0.1, 0.14, 0], [0.05, 0.1, 0.05], c2),
          prim('cone', [0, 0.16, 0.1], [0.05, 0.12, 0.05], c2),
        ],
      };
    case 'bow':
      return {
        anchor: 'headTop',
        prims: [
          prim('sphere', [0.1, 0.05, 0], [0.1, 0.07, 0.05], color),
          prim('sphere', [-0.1, 0.05, 0], [0.1, 0.07, 0.05], color),
          prim('sphere', [0, 0.05, 0], [0.04, 0.04, 0.04], c2),
        ],
      };
    case 'horns':
    case 'ears':
    case 'antenna':
      return {
        anchor: 'headTop',
        prims: [
          prim(motif === 'antenna' ? 'cylinder' : 'cone', [0.12, 0.1, 0], [0.05, 0.18, 0.05], color, [0, 0, -0.3]),
          prim(motif === 'antenna' ? 'cylinder' : 'cone', [-0.12, 0.1, 0], [0.05, 0.18, 0.05], color, [0, 0, 0.3]),
        ],
      };
    case 'wings':
      return {
        anchor: 'back',
        prims: [
          prim('sphere', [0.2, 0.1, 0], [0.25, 0.15, 0.04], color, [0, 0, 0.4]),
          prim('sphere', [-0.2, 0.1, 0], [0.25, 0.15, 0.04], color, [0, 0, -0.4]),
        ],
      };
    case 'cape':
      return { anchor: 'back', prims: [prim('box', [0, -0.1, 0.05], [0.45, 0.6, 0.03], color)] };
    case 'tail':
      return { anchor: 'waist', prims: [prim('capsule', [0, 0, 0.25], [0.06, 0.3, 0.06], color, [1.1, 0, 0])] };
    case 'scarf':
      return { anchor: 'waist', prims: [prim('torus', [0, 0.35, 0], [0.3, 0.3, 0.12], color, [Math.PI / 2, 0, 0])] };
    case 'glasses':
    case 'mask':
      return {
        anchor: 'face',
        prims: [
          prim('torus', [0.08, 0, 0], [0.06, 0.06, 0.03], color),
          prim('torus', [-0.08, 0, 0], [0.06, 0.06, 0.03], color),
        ],
      };
    case 'moustache':
      return {
        anchor: 'face',
        prims: [prim('capsule', [0, -0.08, 0], [0.15, 0.03, 0.03], color, [0, 0, Math.PI / 2])],
      };
    case 'hat':
    case 'helmet':
      return {
        anchor: 'headTop',
        prims: [
          prim(motif === 'hat' ? 'cone' : 'sphere', [0, 0.12, 0], [0.22, motif === 'hat' ? 0.35 : 0.18, 0.22], color),
        ],
      };
    case 'spikes':
      return {
        anchor: 'back',
        prims: [0.15, 0, -0.15].map((y) => prim('cone', [0, y, 0.12], [0.06, 0.12, 0.06], color, [1.4, 0, 0])),
      };
    case 'bubbles':
      return {
        anchor: 'headTop',
        prims: [
          prim('sphere', [0.08, 0.08, 0], [0.08, 0.08, 0.08], color),
          prim('sphere', [-0.06, 0.14, 0.04], [0.06, 0.06, 0.06], c2),
          prim('sphere', [0, 0.22, -0.04], [0.04, 0.04, 0.04], color),
        ],
      };
    default:
      return { anchor: 'headTop', prims: [prim('sphere', [0, 0.08, 0], [0.08, 0.08, 0.08], color)] };
  }
}

const PATTERN_MOTIFS: Record<string, SkinDef['body']['pattern']['type']> = {
  stripes: 'stripes',
  dots: 'dots',
  zigzag: 'zigzag',
};

function shortName(text: string): string {
  return (
    text
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join(' ')
      .slice(0, 24)
      .trim() || 'Wobbler'
  );
}

/** SkinDef limits (contract: 5 accessories, 40 prims in total). */
const MAX_ACCESSORIES = 5;
const MAX_PRIMS = 40;

const ROLE_WORDS = ['Racer', 'Dasher', 'Bouncer', 'Scout', 'Pal', 'Hopper', 'Roller', 'Sprinter'] as const;

/**
 * Builds a skin that keeps the person's traits (body colour, motif accessory, pattern) and dresses
 * it with the theme's costume kit (palette accent, one kit accessory, kit eyes and mouth).
 */
export function buildSkin(opts: {
  seed: string;
  traits: Traits;
  costume: CostumeKit;
  /** a short theme word for the name, e.g. "Sherbet" */
  themeWord: string;
  name?: string;
}): SkinDef {
  const { traits, costume } = opts;
  const rng = rngFrom(opts.seed);
  const palette = costume.palette;
  const body = traits.colors[0] ?? pick(rng, palette);
  const accent = pick(rng, palette);
  const belly = traits.colors[1] ?? shade(body, 0.45);
  const limbs = traits.colors[2] ?? shade(accent, -0.15);

  const patternMotif = traits.motifs.find((m) => PATTERN_MOTIFS[m]);
  const pattern: SkinDef['body']['pattern'] = patternMotif
    ? { type: PATTERN_MOTIFS[patternMotif]!, colors: [body, accent], scale: round(0.8 + rng() * 0.6) }
    : rng() < 0.4
      ? {
          type: pick(rng, ['stripes', 'dots', 'waves'] as const),
          colors: [body, accent],
          scale: round(0.8 + rng() * 0.6),
        }
      : { type: 'none', colors: [body], scale: 1 };

  const accessories: Accessory[] = [];
  const used = new Set<Anchor>();
  let prims = 0;
  const add = (a: Accessory) => {
    if (accessories.length >= MAX_ACCESSORIES || used.has(a.anchor) || prims + a.prims.length > MAX_PRIMS) return;
    accessories.push(a);
    used.add(a.anchor);
    prims += a.prims.length;
  };
  // Personal motifs first (that is what makes the character theirs), then the theme's kit.
  const traitColor = traits.colors[1] ?? traits.colors[0] ?? accent;
  for (const m of traits.motifs) {
    if (accessories.length < 2 && !PATTERN_MOTIFS[m]) add(motifAccessory(m, traitColor));
  }
  // Two kit pieces where anchors are free: the theme must read clearly on every character.
  for (let n = 0; n < 2; n++) {
    const freeKit = costume.accessories.filter((k) => !used.has(k.anchor) && prims + k.prims.length <= MAX_PRIMS);
    if (freeKit.length === 0) break;
    const k = pick(rng, freeKit);
    add({ anchor: k.anchor, prims: k.prims.map((p) => ({ ...p, color: rng() < 0.5 ? p.color : accent })) });
  }

  const motifWord = traits.motifs[0] ?? traits.vibe ?? '';
  const name = opts.name ?? shortName(`${motifWord} ${opts.themeWord} ${pick(rng, ROLE_WORDS)}`);
  return {
    version: 1,
    name: name.slice(0, 24),
    body: { color: body, belly, pattern, height: round(0.9 + rng() * 0.2), girth: round(0.9 + rng() * 0.2) },
    face: {
      eyes: pick(rng, costume.eyes),
      eyeColor: pick(rng, ['#1a1a24', '#2a1a40', '#1a2a40'] as const),
      mouth: pick(rng, costume.mouths),
      cheeks: rng() < 0.5 ? shade(body, 0.3) : null,
    },
    limbs: { color: limbs },
    accessories,
  };
}

/** Random traits for a generic pool character, drawn from the theme's palette. */
export function poolTraits(seed: string, costume: CostumeKit): Traits {
  const rng = rngFrom(seed);
  const motifs = ['crown', 'bow', 'horns', 'wings', 'cape', 'tail', 'scarf', 'glasses', 'hat', 'spikes', 'ears'];
  const motif = pick(rng, motifs);
  return {
    colors: [pick(rng, costume.palette), shade(pick(rng, costume.palette), rng() - 0.5)],
    motifs: rng() < 0.3 ? [motif, pick(rng, ['stripes', 'dots', 'zigzag'])] : [motif],
    vibe: pick(rng, ['cheerful', 'brave', 'sleepy', 'silly', 'cool']),
    silhouette: pick(rng, ['round', 'tall and thin', 'small']),
  };
}

/** Nudges a skin's colours so it no longer matches another one. Last resort after model retries. */
export function jitterSkin(skin: SkinDef, seed: string): SkinDef {
  const rng = rngFrom(seed);
  const next = structuredClone(skin);
  next.body.color = shade(next.body.color, (rng() - 0.5) * 0.3);
  next.limbs.color = shade(next.limbs.color, (rng() - 0.5) * 0.3);
  next.body.height = round(Math.max(0.85, Math.min(1.15, next.body.height + (rng() - 0.5) * 0.1)));
  return next;
}
