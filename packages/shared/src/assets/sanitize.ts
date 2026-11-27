// The trust boundary for asset packs (#16). Every rule and range is documented in docs/ASSET_PACKS.md.
// sanitizePack never throws: it rebuilds the data field by field from known keys only, so unknown keys,
// prototype tricks and deep nesting never survive. ok=false only when the input is unrecoverable.
import { LIMITS, MATERIAL_SLOTS, SEGMENT_TYPES } from '../constants.ts';
import { PACK_DATA_SCHEMAS } from '../schemas/packs.ts';
import type {
  CourseRecipe,
  Hex,
  MaterialDef,
  MaterialSlot,
  PackData,
  PackKind,
  Pattern,
  Prim,
  SanitizeResult,
  SkinDef,
  ThemeDef,
  TileShape,
  Vec3,
} from '../types.ts';
import { colorDistance, normalizeHex } from './color.ts';

/** Documented ranges and caps. docs/ASSET_PACKS.md mirrors this table. */
export const PACK_RULES = Object.freeze({
  nameMax: 24,
  courseNameMax: 48,
  maxAccessories: 3,
  maxAccessoryPrims: 24,
  maxDecor: 6,
  maxDecorPrims: 12,
  maxTileShapes: 24,
  maxPolyPoints: 16,
  minSegments: 4,
  maxSegments: 12,
  /** Accessories must fit inside a sphere of this radius (m) around their anchor. */
  accessoryRadius: 1.2,
  /** Minimum OKLab distance between a hazard/bouncy colour and every surface slot (and each other). */
  minSlotDistance: 0.15,
  /** Minimum OKLab distance between the eyes and the body. */
  minEyeDistance: 0.15,
  bodyScale: [0.85, 1.15],
  patternScale: [0.25, 4],
  fogNear: [10, 300],
  fogFar: [80, 1200],
  /** fog.far is at least fog.near plus this (m). */
  fogMinSpan: 60,
  ambientIntensity: [0.2, 2],
  sunIntensity: [0.5, 4],
  /** sunDir[1] stays in this range so the sun always shines from above. */
  sunDirY: [-1, -0.2],
  tempo: [70, 180],
  decorDensity: [0, 1],
  decorScale: [0.25, 4],
  decorPrimExtent: 10,
  seedMax: 2147483647,
} as const);

/** Slots that players stand on; hazard and bouncy must stand out from all of them. */
export const SURFACE_SLOTS: readonly MaterialSlot[] = ['platformA', 'platformB', 'accent', 'finish'];
/** Bright replacements tried, in order, when a hazard or bouncy colour is too close to a surface slot. */
const HAZARD_CANDIDATES: Hex[] = ['#ff2e4d', '#ff7a00', '#e8003d', '#ff2d95', '#d40000', '#9b00ff'];
const BOUNCY_CANDIDATES: Hex[] = ['#ffd23f', '#2bff88', '#00e0ff', '#b6ff00', '#ff9df0', '#ffffff'];
const DARK_EYE: Hex = '#1d1b2f';
const LIGHT_EYE: Hex = '#ffffff';

const PATTERN_TYPES = ['none', 'stripes', 'dots', 'checker', 'zigzag', 'waves', 'custom'] as const;
const PRIM_SHAPES = ['sphere', 'box', 'cylinder', 'cone', 'torus', 'capsule'] as const;
const ANCHORS = ['headTop', 'face', 'back', 'waist'] as const;
const EYES = ['dot', 'oval', 'sleepy', 'star', 'wide'] as const;
const MOUTHS = ['smile', 'o', 'flat', 'grin', 'none'] as const;
const MUSIC_SCALES = ['major', 'minor', 'pentatonic', 'lydian'] as const;
const LENGTHS = ['short', 'medium', 'long'] as const;
const ROT_LIMIT = 3.142;

type Rec = Record<string, unknown>;
type Range = readonly [number, number];

class Ctx {
  issues: string[] = [];
  note(path: string, msg: string): void {
    if (this.issues.length < 200) this.issues.push(`${path}: ${msg}`);
  }
}

const round3 = (v: number): number => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};

function rec(c: Ctx, v: unknown, path: string): Rec {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Rec;
  if (v !== undefined) c.note(path, 'expected an object');
  return {};
}

function list(c: Ctx, v: unknown, path: string, cap: number): unknown[] {
  if (!Array.isArray(v)) {
    if (v !== undefined && v !== null) c.note(path, 'expected an array');
    return [];
  }
  if (v.length > cap) c.note(path, `capped at ${cap} items`);
  return v.slice(0, cap);
}

function num(c: Ctx, v: unknown, [min, max]: Range, def: number, path: string, int = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    if (v !== undefined) c.note(path, `not a finite number, using ${def}`);
    return def;
  }
  let n = Math.min(max, Math.max(min, v));
  if (n !== v) c.note(path, `clamped to ${min}..${max}`);
  n = int ? Math.round(n) : round3(n);
  return Math.min(max, Math.max(min, n));
}

function rot(c: Ctx, v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    if (v !== undefined) c.note(path, 'not a finite number, using 0');
    return 0;
  }
  if (Math.abs(v) <= ROT_LIMIT) return round3(v);
  const turn = Math.PI * 2;
  return round3(((((v + Math.PI) % turn) + turn) % turn) - Math.PI);
}

function rot3(c: Ctx, v: unknown, path: string): Vec3 {
  const a = Array.isArray(v) ? v : [];
  if (!Array.isArray(v) || v.length !== 3) c.note(path, 'expected [x, y, z]');
  return [rot(c, a[0], `${path}.0`), rot(c, a[1], `${path}.1`), rot(c, a[2], `${path}.2`)];
}

function vec3(c: Ctx, v: unknown, range: Range, def: Vec3, path: string): Vec3 {
  const a = Array.isArray(v) ? v : [];
  if (!Array.isArray(v) || v.length !== 3) c.note(path, 'expected [x, y, z]');
  return [
    num(c, a[0], range, def[0], `${path}.0`),
    num(c, a[1], range, def[1], `${path}.1`),
    num(c, a[2], range, def[2], `${path}.2`),
  ];
}

function hex(c: Ctx, v: unknown, def: Hex, path: string): Hex {
  const h = normalizeHex(v);
  if (h === null) {
    c.note(path, `invalid colour, using ${def}`);
    return def;
  }
  return h;
}

function optHex(c: Ctx, v: unknown, path: string): Hex | undefined {
  if (v === undefined || v === null) return undefined;
  const h = normalizeHex(v);
  if (h === null) c.note(path, 'invalid colour, dropped');
  return h ?? undefined;
}

function pick<T extends string>(c: Ctx, v: unknown, options: readonly T[], def: T, path: string): T {
  if (typeof v === 'string' && (options as readonly string[]).includes(v)) return v as T;
  c.note(path, `unknown value, using ${def}`);
  return def;
}

// Control characters, bidi overrides, zero-width characters and markup characters.
const BAD_RANGES = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
]
  .map(([a, b]) => `\\u${a.toString(16).padStart(4, '0')}-\\u${b.toString(16).padStart(4, '0')}`)
  .join('');
const BAD_CHARS = new RegExp(`[${BAD_RANGES}<>\x60]`, 'g');
const TAGS = /<[^<>]{0,200}>/g;

/** Strip control characters and markup, collapse whitespace, cut to max code points. */
export function cleanName(v: unknown, max: number, def: string): string {
  if (typeof v !== 'string') return def;
  const s = v
    .slice(0, 1024)
    .replace(TAGS, ' ')
    .replace(/[\t\n\r\f\v]/g, ' ')
    .replace(BAD_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = Array.from(s).slice(0, max).join('').trim();
  return cut.length > 0 ? cut : def;
}

function name(c: Ctx, v: unknown, max: number, def: string, path: string): string {
  const out = cleanName(v, max, def);
  if (out !== v) c.note(path, 'name cleaned');
  return out;
}

// ---- patterns ---------------------------------------------------------------

function tileShape(c: Ctx, v: unknown, path: string): TileShape | null {
  const t = rec(c, v, path);
  const kind = pick(c, t.kind, ['circle', 'rect', 'poly'] as const, 'circle', `${path}.kind`);
  const base = {
    kind,
    fill: hex(c, t.fill, '#ffffff', `${path}.fill`),
    x: num(c, t.x, [0, 1], 0.5, `${path}.x`),
    y: num(c, t.y, [0, 1], 0.5, `${path}.y`),
  };
  if (kind === 'circle') return { ...base, r: num(c, t.r, [0.01, 0.5], 0.1, `${path}.r`) };
  const withRot = t.rot === undefined || t.rot === null ? {} : { rot: rot(c, t.rot, `${path}.rot`) };
  if (kind === 'rect') {
    return {
      ...base,
      w: num(c, t.w, [0.01, 1], 0.2, `${path}.w`),
      h: num(c, t.h, [0.01, 1], 0.2, `${path}.h`),
      ...withRot,
    };
  }
  const points: [number, number][] = [];
  list(c, t.points, `${path}.points`, PACK_RULES.maxPolyPoints).forEach((p, i) => {
    const a = Array.isArray(p) ? p : [];
    points.push([
      num(c, a[0], [-0.5, 0.5], 0, `${path}.points.${i}.0`),
      num(c, a[1], [-0.5, 0.5], 0, `${path}.points.${i}.1`),
    ]);
  });
  if (points.length < 3) {
    c.note(path, 'poly needs at least 3 points, dropped');
    return null;
  }
  return { ...base, points, ...withRot };
}

function pattern(c: Ctx, v: unknown, fallback: Hex, path: string): Pattern {
  const p = rec(c, v, path);
  const type = pick(c, p.type, PATTERN_TYPES, 'none', `${path}.type`);
  const colors = list(c, p.colors, `${path}.colors`, 4)
    .map((h) => normalizeHex(h))
    .filter((h): h is Hex => h !== null);
  if (Array.isArray(p.colors) && colors.length < Math.min(4, p.colors.length))
    c.note(`${path}.colors`, 'invalid colours dropped');
  if (colors.length === 0) {
    c.note(`${path}.colors`, 'no valid colours');
    colors.push(fallback);
  }
  const out: Pattern = { type, colors, scale: num(c, p.scale, PACK_RULES.patternScale, 1, `${path}.scale`) };
  if (type === 'custom') {
    out.tile = list(c, p.tile, `${path}.tile`, PACK_RULES.maxTileShapes)
      .map((t, i) => tileShape(c, t, `${path}.tile.${i}`))
      .filter((t): t is TileShape => t !== null);
  } else if (p.tile !== undefined && p.tile !== null) {
    c.note(`${path}.tile`, 'only used by custom patterns, dropped');
  }
  return out;
}

/** Sanitise a lone pattern (used by drawPattern). Never throws. */
export function sanitizePattern(v: unknown, fallback: Hex = '#ffffff'): Pattern {
  try {
    return pattern(new Ctx(), v, fallback, 'pattern');
  } catch {
    return { type: 'none', colors: [fallback], scale: 1 };
  }
}

// ---- primitives -------------------------------------------------------------

function prim(c: Ctx, v: unknown, extent: number, path: string): Prim {
  const p = rec(c, v, path);
  const out: Prim = {
    shape: pick(c, p.shape, PRIM_SHAPES, 'sphere', `${path}.shape`),
    pos: vec3(c, p.pos, [-extent, extent], [0, 0, 0], `${path}.pos`),
    rot: rot3(c, p.rot, `${path}.rot`),
    scale: vec3(c, p.scale, [0.01, extent * 2], [0.2, 0.2, 0.2], `${path}.scale`),
    color: hex(c, p.color, '#ffffff', `${path}.color`),
  };
  const emissive = optHex(c, p.emissive, `${path}.emissive`);
  if (emissive) out.emissive = emissive;
  return out;
}

/** Fairness: shrink, then pull in, any prim that pokes out of the anchor sphere. */
function fitInSphere(c: Ctx, p: Prim, radius: number, path: string): void {
  const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
  const reach = (): number => len(p.pos) + len(p.scale) / 2;
  if (reach() <= radius) return;
  c.note(path, `outside the ${radius} m accessory sphere, pulled in`);
  const target = radius - 0.01;
  const half = len(p.scale) / 2;
  if (half > target) {
    const k = target / half;
    p.scale = p.scale.map((s) => Math.max(0.01, round3(s * k))) as Vec3;
    p.pos = [0, 0, 0];
  }
  const room = target - len(p.scale) / 2;
  const dist = len(p.pos);
  if (dist > room) {
    const k = Math.max(0, room) / dist;
    p.pos = p.pos.map((x) => round3(x * k)) as Vec3;
  }
}

// ---- skin -------------------------------------------------------------------

function skin(c: Ctx, d: Rec): SkinDef {
  const body = rec(c, d.body, 'body');
  const face = rec(c, d.face, 'face');
  const limbs = rec(c, d.limbs, 'limbs');
  const color = hex(c, body.color, '#ff8a3d', 'body.color');
  const out: SkinDef = {
    version: 1,
    name: name(c, d.name, PACK_RULES.nameMax, 'Wobbler', 'name'),
    body: {
      color,
      belly: hex(c, body.belly, '#ffe4b8', 'body.belly'),
      pattern: pattern(c, body.pattern, color, 'body.pattern'),
      height: num(c, body.height, PACK_RULES.bodyScale, 1, 'body.height'),
      girth: num(c, body.girth, PACK_RULES.bodyScale, 1, 'body.girth'),
    },
    face: {
      eyes: pick(c, face.eyes, EYES, 'dot', 'face.eyes'),
      eyeColor: hex(c, face.eyeColor, DARK_EYE, 'face.eyeColor'),
      mouth: pick(c, face.mouth, MOUTHS, 'smile', 'face.mouth'),
      cheeks: optHex(c, face.cheeks, 'face.cheeks') ?? null,
    },
    limbs: { color: hex(c, limbs.color, color, 'limbs.color') },
    accessories: [],
  };
  if (colorDistance(out.face.eyeColor, color) < PACK_RULES.minEyeDistance) {
    out.face.eyeColor = colorDistance(DARK_EYE, color) >= colorDistance(LIGHT_EYE, color) ? DARK_EYE : LIGHT_EYE;
    c.note('face.eyeColor', 'too close to the body colour, replaced');
  }
  let budget: number = PACK_RULES.maxAccessoryPrims;
  list(c, d.accessories, 'accessories', PACK_RULES.maxAccessories).forEach((a, i) => {
    const acc = rec(c, a, `accessories.${i}`);
    const prims = list(c, acc.prims, `accessories.${i}.prims`, budget).map((p, j) => {
      const pr = prim(c, p, PACK_RULES.accessoryRadius, `accessories.${i}.prims.${j}`);
      fitInSphere(c, pr, PACK_RULES.accessoryRadius, `accessories.${i}.prims.${j}`);
      return pr;
    });
    if (prims.length === 0) {
      c.note(`accessories.${i}`, budget === 0 ? 'prim budget used up, dropped' : 'no prims, dropped');
      return;
    }
    budget -= prims.length;
    out.accessories.push({ anchor: pick(c, acc.anchor, ANCHORS, 'headTop', `accessories.${i}.anchor`), prims });
  });
  return out;
}

// ---- theme ------------------------------------------------------------------

const DEFAULT_MATERIALS: Record<MaterialSlot, Hex> = {
  platformA: '#7ad7ff',
  platformB: '#b49cff',
  hazard: '#ff2e4d',
  bouncy: '#ffd23f',
  accent: '#5cf2a4',
  rail: '#ffffff',
  finish: '#ffffff',
};

function material(c: Ctx, v: unknown, slot: MaterialSlot, path: string): MaterialDef {
  const m = rec(c, v, path);
  const color = hex(c, m.color, DEFAULT_MATERIALS[slot], `${path}.color`);
  const out: MaterialDef = {
    color,
    roughness: num(c, m.roughness, [0, 1], 0.5, `${path}.roughness`),
    metalness: num(c, m.metalness, [0, 1], 0, `${path}.metalness`),
  };
  const emissive = optHex(c, m.emissive, `${path}.emissive`);
  if (emissive) out.emissive = emissive;
  if (m.pattern !== undefined && m.pattern !== null) out.pattern = pattern(c, m.pattern, color, `${path}.pattern`);
  return out;
}

/** Legibility: make `slot` stand out from `against`, picking the best candidate if it does not. */
function standOut(
  c: Ctx,
  mats: Record<MaterialSlot, MaterialDef>,
  slot: MaterialSlot,
  against: MaterialSlot[],
  candidates: Hex[],
): void {
  const minDist = (h: Hex): number => Math.min(...against.map((s) => colorDistance(h, mats[s].color)));
  const m = mats[slot];
  if (minDist(m.color) < PACK_RULES.minSlotDistance) {
    const best =
      candidates.find((h) => minDist(h) >= PACK_RULES.minSlotDistance) ??
      candidates.reduce((a, b) => (minDist(b) > minDist(a) ? b : a));
    c.note(`materials.${slot}.color`, `too close to ${against.join('/')}, replaced with ${best}`);
    m.color = best;
  }
  if (m.pattern && m.pattern.colors[0] !== m.color) {
    c.note(`materials.${slot}.pattern.colors.0`, 'must match the slot colour');
    m.pattern.colors[0] = m.color;
  }
}

function theme(c: Ctx, d: Rec): ThemeDef {
  const sky = rec(c, d.sky, 'sky');
  const fog = rec(c, d.fog, 'fog');
  const light = rec(c, d.light, 'light');
  const music = rec(c, d.music, 'music');
  const mats = rec(c, d.materials, 'materials');
  const materials = Object.fromEntries(
    MATERIAL_SLOTS.map((slot) => [slot, material(c, mats[slot], slot, `materials.${slot}`)]),
  ) as Record<MaterialSlot, MaterialDef>;
  standOut(c, materials, 'hazard', [...SURFACE_SLOTS], HAZARD_CANDIDATES);
  standOut(c, materials, 'bouncy', [...SURFACE_SLOTS, 'hazard'], BOUNCY_CANDIDATES);

  const near = num(c, fog.near, PACK_RULES.fogNear, 60, 'fog.near');
  let far = num(c, fog.far, PACK_RULES.fogFar, 220, 'fog.far');
  if (far < near + PACK_RULES.fogMinSpan) {
    c.note('fog.far', `must be at least fog.near + ${PACK_RULES.fogMinSpan}`);
    far = near + PACK_RULES.fogMinSpan;
  }
  const sunDir = vec3(c, light.sunDir, [-1, 1], [-0.4, -1, -0.3], 'light.sunDir');
  sunDir[1] = num(c, sunDir[1], PACK_RULES.sunDirY, -1, 'light.sunDir.1');

  const decor = list(c, d.decor, 'decor', PACK_RULES.maxDecor).flatMap((v, i) => {
    const dc = rec(c, v, `decor.${i}`);
    const prims = list(c, dc.prims, `decor.${i}.prims`, PACK_RULES.maxDecorPrims).map((p, j) =>
      prim(c, p, PACK_RULES.decorPrimExtent, `decor.${i}.prims.${j}`),
    );
    if (prims.length === 0) {
      c.note(`decor.${i}`, 'no prims, dropped');
      return [];
    }
    const minScale = num(c, dc.minScale, PACK_RULES.decorScale, 1, `decor.${i}.minScale`);
    const maxScale = num(c, dc.maxScale, [minScale, PACK_RULES.decorScale[1]], minScale, `decor.${i}.maxScale`);
    return [
      {
        name: name(c, dc.name, PACK_RULES.nameMax, 'Prop', `decor.${i}.name`),
        prims,
        density: num(c, dc.density, PACK_RULES.decorDensity, 0.3, `decor.${i}.density`),
        minScale,
        maxScale,
      },
    ];
  });

  return {
    version: 1,
    name: name(c, d.name, PACK_RULES.nameMax, 'Theme', 'name'),
    sky: {
      top: hex(c, sky.top, '#5ec8ff', 'sky.top'),
      horizon: hex(c, sky.horizon, '#ffd9f2', 'sky.horizon'),
      bottom: hex(c, sky.bottom, '#fff4d6', 'sky.bottom'),
    },
    fog: { color: hex(c, fog.color, '#ffd9f2', 'fog.color'), near, far },
    light: {
      ambient: hex(c, light.ambient, '#ffffff', 'light.ambient'),
      ambientIntensity: num(c, light.ambientIntensity, PACK_RULES.ambientIntensity, 0.9, 'light.ambientIntensity'),
      sun: hex(c, light.sun, '#ffffff', 'light.sun'),
      sunIntensity: num(c, light.sunIntensity, PACK_RULES.sunIntensity, 2, 'light.sunIntensity'),
      sunDir,
    },
    materials,
    decor,
    music: {
      tempo: num(c, music.tempo, PACK_RULES.tempo, 120, 'music.tempo', true),
      scale: pick(c, music.scale, MUSIC_SCALES, 'major', 'music.scale'),
      energy: num(c, music.energy, [1, 3], 2, 'music.energy', true) as 1 | 2 | 3,
    },
  };
}

// ---- course -----------------------------------------------------------------

function course(c: Ctx, d: Rec): CourseRecipe {
  const segments = list(c, d.segments, 'segments', PACK_RULES.maxSegments).flatMap((v, i) => {
    const s = rec(c, v, `segments.${i}`);
    if (typeof s.type !== 'string' || !(SEGMENT_TYPES as readonly string[]).includes(s.type)) {
      c.note(`segments.${i}.type`, 'unknown segment type, dropped');
      return [];
    }
    return [
      {
        type: s.type as CourseRecipe['segments'][number]['type'],
        length: pick(c, s.length, LENGTHS, 'medium', `segments.${i}.length`),
        intensity: num(c, s.intensity, [1, 5], 2, `segments.${i}.intensity`, true) as 1 | 2 | 3 | 4 | 5,
      },
    ];
  });
  while (segments.length < PACK_RULES.minSegments) {
    c.note('segments', `padded to ${PACK_RULES.minSegments} with plainRun`);
    segments.push({ type: 'plainRun', length: 'medium', intensity: 1 });
  }
  return {
    version: 1,
    name: name(c, d.name, PACK_RULES.courseNameMax, 'Course', 'name'),
    seed: num(c, typeof d.seed === 'number' ? Math.abs(d.seed) : d.seed, [0, PACK_RULES.seedMax], 1, 'seed', true),
    segments,
  };
}

// ---- size -------------------------------------------------------------------

const encoder = new TextEncoder();
export const packBytes = (data: unknown): number => encoder.encode(JSON.stringify(data)).length;

function patternsOf(data: PackData): Pattern[] {
  if ('body' in data) return [data.body.pattern];
  if ('materials' in data)
    return MATERIAL_SLOTS.flatMap((s) => (data.materials[s].pattern ? [data.materials[s].pattern] : []));
  return [];
}

/** Drop the least important content until the pack fits: tile shapes, then decor, then accessory prims. */
function shrinkOnce(data: PackData): boolean {
  const tiled = patternsOf(data).filter((p) => p.tile && p.tile.length > 0);
  if (tiled.length > 0) {
    tiled.reduce((a, b) => ((b.tile?.length ?? 0) > (a.tile?.length ?? 0) ? b : a)).tile?.pop();
    return true;
  }
  if ('decor' in data && data.decor.length > 0) {
    data.decor.pop();
    return true;
  }
  if ('accessories' in data && data.accessories.length > 0) {
    const last = data.accessories[data.accessories.length - 1];
    last.prims.pop();
    if (last.prims.length === 0) data.accessories.pop();
    return true;
  }
  return false;
}

// ---- entry point -------------------------------------------------------------

/** Make untrusted pack data safe. Never throws; ok=false only when the input is unrecoverable. */
export function sanitizePack(kind: PackKind, data: unknown): SanitizeResult {
  try {
    const schema = (PACK_DATA_SCHEMAS as Record<string, (typeof PACK_DATA_SCHEMAS)[PackKind]>)[kind];
    if (!Object.hasOwn(PACK_DATA_SCHEMAS, kind) || !schema) {
      return { ok: false, data: null, issues: [`unknown pack kind: ${String(kind).slice(0, 32)}`] };
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, data: null, issues: ['data: expected an object'] };
    }
    const d = data as Rec;
    if (d.version !== 1) return { ok: false, data: null, issues: ['version: expected 1'] };
    const c = new Ctx();
    const out: PackData = kind === 'skin' ? skin(c, d) : kind === 'theme' ? theme(c, d) : course(c, d);
    let bytes = packBytes(out);
    if (bytes > LIMITS.packMaxBytes) c.note('pack', `${bytes} bytes is over ${LIMITS.packMaxBytes}, trimmed`);
    while (bytes > LIMITS.packMaxBytes && shrinkOnce(out)) bytes = packBytes(out);
    if (bytes > LIMITS.packMaxBytes) return { ok: false, data: null, issues: [...c.issues, 'pack: still too large'] };
    const check = schema.safeParse(out);
    if (!check.success) {
      return {
        ok: false,
        data: null,
        issues: [...c.issues, ...check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)],
      };
    }
    return { ok: true, data: out, issues: c.issues };
  } catch {
    return { ok: false, data: null, issues: ['data: unreadable input'] };
  }
}
