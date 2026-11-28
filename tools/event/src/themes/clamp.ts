// Turns a model draft into contract-shaped theme data: trims text and lists to the #54 limits and clamps
// every number. sanitizePack (#16) does not handle v2 themes yet, so nothing else does this (#59).
import { HexSchema, MATERIAL_SLOTS } from '@wobble/shared';
import type { MaterialDef, MaterialSlot, Prim, ThemeDefV2, Vec3 } from '@wobble/shared';
import { clip } from '../lib/text.ts';
import type { Draft, LookDraft, PropsDraft } from './draft.ts';
import { obstacleBriefs } from './obstacles.ts';

type Generated = 'version' | 'credit' | 'sky' | 'materials' | 'decor' | 'signage' | 'art';

/** A ThemeDef v2 before any image exists. `decor` holds the primitive decor only. */
export type ThemeLook = Omit<ThemeDefV2, Generated> & {
  sky: { top: string; horizon: string; bottom: string };
  materials: Record<MaterialSlot, MaterialDef>;
  decor: { name: string; prims: Prim[]; density: number; minScale: number; maxScale: number }[];
};

/** Parts per obstacle kind (default parameters, from the registry); dressing for other part numbers is dropped. */
export const MIN_PARTS = Object.fromEntries(obstacleBriefs().map((b) => [b.kind, b.parts.length])) as Record<
  ThemeDefV2['dressing'][number]['kind'],
  number
>;

/** Largest half extent per part. Dressing may reach a little past it, never far: it must still read as the obstacle. */
const PART_REACH = new Map(
  obstacleBriefs().flatMap((b) => b.parts.map((p) => [`${b.kind}|${p.part}`, Math.max(...p.halfExtents)] as const)),
);

export const DEFAULT_COLORS: Record<MaterialSlot, string> = {
  platformA: '#7ad7ff',
  platformB: '#b49cff',
  hazard: '#ff3b30',
  bouncy: '#ffd23f',
  accent: '#ff8a3d',
  rail: '#f4f1ff',
  finish: '#3ee08a',
};

export function clampNumber(value: number, min: number, max: number, fallback = min): number {
  const v = Number.isFinite(value) ? value : fallback;
  return Math.round(Math.min(max, Math.max(min, v)) * 1000) / 1000;
}

export function hex(value: string, fallback: string): string {
  const trimmed = value.trim().toLowerCase();
  return HexSchema.safeParse(trimmed).success ? trimmed : fallback;
}

/** Cut to `max` characters, at a word boundary when one is near. Never returns an empty string. */
export function text(value: string, max: number, fallback = 'Wobble'): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  const cut = clip(clean, max);
  if (cut.length === clean.length || clean[cut.length] === ' ') return cut;
  const space = cut.lastIndexOf(' ');
  return space > max * 0.6 ? cut.slice(0, space) : cut;
}

const vec = (v: { x: number; y: number; z: number }, min: number, max: number, fallback = 0): Vec3 => [
  clampNumber(v.x, min, max, fallback),
  clampNumber(v.y, min, max, fallback),
  clampNumber(v.z, min, max, fallback),
];

interface PrimLimits {
  count: number;
  /** largest distance from the anchor on any axis */
  reach: number;
  size: number;
}

function prims(list: PropsDraft['decor'][number]['prims'], limits: PrimLimits): Prim[] {
  return list.slice(0, limits.count).map((p) => {
    const prim: Prim = {
      shape: p.shape,
      pos: vec(p.pos, -limits.reach, limits.reach),
      rot: vec(p.rot, -2 * Math.PI, 2 * Math.PI),
      scale: vec(p.scale, 0.02, limits.size, 1),
      color: hex(p.color, '#cccccc'),
    };
    if (HexSchema.safeParse(p.emissive).success) prim.emissive = p.emissive.toLowerCase();
    return prim;
  });
}

function material(draft: LookDraft['materials'][number] | undefined, slot: MaterialSlot): MaterialDef {
  if (!draft) return { color: DEFAULT_COLORS[slot], roughness: 0.7, metalness: 0 };
  const out: MaterialDef = {
    color: hex(draft.color, DEFAULT_COLORS[slot]),
    roughness: clampNumber(draft.roughness, 0, 1, 0.7),
    metalness: clampNumber(draft.metalness, 0, 1, 0),
  };
  if (HexSchema.safeParse(draft.emissive).success) out.emissive = draft.emissive.toLowerCase();
  if (draft.pattern !== 'none') {
    const colors = draft.patternColors.slice(0, 4).map((c) => hex(c, out.color));
    out.pattern = {
      type: draft.pattern,
      colors: colors.length ? colors : [out.color],
      scale: clampNumber(draft.patternScale, 0.25, 8, 1),
    };
  }
  return out;
}

/**
 * The look prompt asks for the direction TOWARD the sun (y up, easier for the model); the contract's
 * light.sunDir is the direction the light TRAVELS (y between -1 and -0.2). Flip and clamp here.
 */
function direction(v: { x: number; y: number; z: number }): Vec3 {
  const [x, y, z] = vec(v, -1, 1);
  const length = Math.hypot(x, y, z);
  const [tx, ty, tz] = length < 0.1 ? [0.4, 0.8, 0.45] : [x / length, y / length, z / length];
  const out: Vec3 = [-tx, Math.min(-0.2, -Math.abs(ty)), -tz];
  return out.map((n) => Math.round(n * 1000) / 1000) as Vec3;
}

export function clampLook(d: LookDraft): Omit<ThemeLook, 'dressing' | 'landmarks' | 'decor' | 'costume'> {
  const near = clampNumber(d.fog.near, 0, 200, 40);
  const confetti = d.fx.confetti.slice(0, 5).map((c) => hex(c, '#ffd23f'));
  const castMember = (m: { name: string; description: string }, fallback: string) => ({
    name: text(m.name, 24, fallback),
    description: text(m.description, 160, `The ${fallback.toLowerCase()} of this course.`),
  });
  const materials = Object.fromEntries(
    MATERIAL_SLOTS.map((slot) => [
      slot,
      material(
        d.materials.find((m) => m.slot === slot),
        slot,
      ),
    ]),
  ) as ThemeLook['materials'];
  return {
    name: text(d.name, 24),
    title: text(d.title, 32, text(d.name, 32)),
    tagline: d.tagline.trim() ? text(d.tagline, 80) : '',
    sky: {
      top: hex(d.sky.top, '#4aa8ff'),
      horizon: hex(d.sky.horizon, '#cdeaff'),
      bottom: hex(d.sky.bottom, '#ffe9f3'),
    },
    fog: { color: hex(d.fog.color, '#cdeaff'), near, far: clampNumber(d.fog.far, near + 20, 600, near + 160) },
    light: {
      ambient: hex(d.light.ambient, '#ffffff'),
      ambientIntensity: clampNumber(d.light.ambientIntensity, 0, 2, 0.8),
      sun: hex(d.light.sun, '#fff4d6'),
      sunIntensity: clampNumber(d.light.sunIntensity, 0, 3.5, 1.4),
      sunDir: direction(d.light.sunDir),
    },
    materials,
    ground: {
      kind: d.ground.kind,
      color: hex(d.ground.color, '#2b3a67'),
      emissive: HexSchema.safeParse(d.ground.emissive).success ? d.ground.emissive.toLowerCase() : null,
      motion: clampNumber(d.ground.motion, 0, 1, 0.3),
    },
    particles: d.particles.slice(0, 2).map((p) => ({
      kind: p.kind,
      color: hex(p.color, '#ffffff'),
      density: clampNumber(p.density, 0, 1, 0.4),
      speed: clampNumber(p.speed, 0, 1, 0.3),
    })),
    fx: {
      confetti: confetti.length ? confetti : ['#ffd23f', '#ff6bd5', '#7ad7ff'],
      checkpoint: hex(d.fx.checkpoint, '#5cf2a4'),
      hit: hex(d.fx.hit, '#ff4f6d'),
    },
    hud: { accent: hex(d.hud.accent, '#ff6bd5'), font: d.hud.font },
    music: {
      tempo: Math.round(clampNumber(d.music.tempo, 70, 180, 120)),
      scale: d.music.scale,
      energy: Math.round(clampNumber(d.music.energy, 1, 3, 2)) as 1 | 2 | 3,
      instrument: d.music.instrument,
      swing: clampNumber(d.music.swing, 0, 1, 0.1),
    },
    cast: { hero: castMember(d.cast.hero, 'Hero'), villain: castMember(d.cast.villain, 'Villain') },
  };
}

const unique = <T>(list: T[]): T[] => [...new Set(list)];

function dressingLimits(kind: string, part: number): PrimLimits {
  const half = PART_REACH.get(`${kind}|${part}`) ?? 2;
  // Contract fairness rule: dressing stays within the part's bounds + 0.3 m.
  return { count: 16, reach: half + 0.3, size: half + 0.3 };
}

export function clampProps(d: PropsDraft): Pick<ThemeLook, 'dressing' | 'landmarks' | 'decor' | 'costume'> {
  const palette = d.costume.palette.slice(0, 8).map((c) => hex(c, '#ffd23f'));
  const fill = ['#ff8a3d', '#7ad7ff', '#b49cff'];
  while (palette.length < 3) palette.push(fill[palette.length]);
  const eyes = unique(d.costume.eyes).slice(0, 5);
  const mouths = unique(d.costume.mouths).slice(0, 5);
  return {
    dressing: d.dressing
      .filter((x) => x.prims.length && Number.isInteger(x.part) && x.part >= 0 && x.part < MIN_PARTS[x.kind])
      .slice(0, 24)
      .map((x) => ({
        kind: x.kind,
        part: x.part,
        prims: prims(x.prims, dressingLimits(x.kind, x.part)),
        // The game hides the base only if these prims cover >= 80% of the part (#54 rule, theme/v2/coverage.ts).
        hideBase: x.hideBase === true,
        slot: x.slot === 'none' ? null : x.slot,
      })),
    landmarks: d.landmarks
      .filter((x) => x.prims.length)
      .slice(0, 4)
      .map((x) => ({
        anchor: x.anchor,
        name: text(x.name, 24, 'Landmark'),
        prims: prims(x.prims, { count: 48, reach: 45, size: 40 }),
        scale: clampNumber(x.scale, 0.25, 4, 1),
      })),
    decor: d.decor
      .filter((x) => x.prims.length)
      .slice(0, 5)
      .map((x) => {
        const minScale = clampNumber(x.minScale, 0.2, 4, 0.8);
        return {
          name: text(x.name, 24, 'Decor'),
          prims: prims(x.prims, { count: 8, reach: 6, size: 6 }),
          density: clampNumber(x.density, 0, 1, 0.3),
          minScale,
          maxScale: clampNumber(x.maxScale, minScale, 6, minScale),
        };
      }),
    costume: {
      palette,
      accessories: d.costume.accessories
        .filter((x) => x.prims.length)
        .slice(0, 12)
        .map((x) => ({
          name: text(x.name, 24, 'Accessory'),
          anchor: x.anchor,
          prims: prims(x.prims, { count: 8, reach: 0.8, size: 0.8 }),
        })),
      eyes: eyes.length ? eyes : ['oval'],
      mouths: mouths.length ? mouths : ['smile'],
    },
  };
}

export function clampDraft(draft: Draft): ThemeLook {
  return { ...clampLook(draft.look), ...clampProps(draft.props) };
}

/** Drop trailing primitives from the heaviest parts until the theme JSON fits in `maxBytes`. */
type HasPrims = { prims: Prim[] };
type Shrinkable = {
  landmarks: HasPrims[];
  dressing: HasPrims[];
  decor: HasPrims[];
  costume: { accessories: HasPrims[] };
};

export function shrinkToFit<T extends Shrinkable>(theme: T, maxBytes: number): T {
  const out = structuredClone(theme);
  const bytes = () => Buffer.byteLength(JSON.stringify(out));
  while (bytes() > maxBytes) {
    const lists = [...out.landmarks, ...out.decor, ...out.dressing, ...out.costume.accessories].map((x) => x.prims);
    const longest = lists.reduce<Prim[]>((a, b) => (b.length > a.length ? b : a), []);
    if (longest.length <= 1) break;
    longest.pop();
  }
  return out;
}
