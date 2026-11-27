// Skin normalisation (#8): turn any SkinDef-shaped value into safe, complete parameters. Never throws.
//
// sanitizePack (#16) clamps packs before they reach the client, but the character still guards every field
// so a broken or partial skin renders with defaults instead of crashing the frame.
import type { Pattern, Prim, SkinDef, TileShape, Vec3 } from '@wobble/shared/types';

export type EyeStyle = SkinDef['face']['eyes'];
export type MouthStyle = SkinDef['face']['mouth'];
export type AnchorName = SkinDef['accessories'][number]['anchor'];
export type PrimShape = Prim['shape'];

export const EYE_STYLES: readonly EyeStyle[] = ['dot', 'oval', 'sleepy', 'star', 'wide'];
export const MOUTH_STYLES: readonly MouthStyle[] = ['smile', 'o', 'flat', 'grin', 'none'];
export const ANCHORS: readonly AnchorName[] = ['headTop', 'face', 'back', 'waist'];
export const PRIM_SHAPES: readonly PrimShape[] = ['sphere', 'box', 'cylinder', 'cone', 'torus', 'capsule'];
const PATTERN_TYPES: readonly Pattern['type'][] = ['none', 'stripes', 'dots', 'checker', 'zigzag', 'waves', 'custom'];

export const SKIN_LIMITS = Object.freeze({
  minScale: 0.85,
  maxScale: 1.15,
  maxAccessories: 3,
  maxPrims: 24,
  /** Accessory prim offsets from their anchor, metres. */
  maxPrimOffset: 1,
  /** Accessory prim size per axis, metres (prims are unit-sized at scale 1). */
  minPrimScale: 0.01,
  maxPrimScale: 1.2,
  maxPatternColors: 4,
  maxTiles: 24,
});

export interface NormalizedPrim {
  shape: PrimShape;
  pos: Vec3;
  rot: Vec3;
  scale: Vec3;
  color: string;
  emissive: string | null;
}

export interface NormalizedAccessory {
  anchor: AnchorName;
  prims: NormalizedPrim[];
}

/** Every field present and in range. Colours are lower-case `#rrggbb`. */
export interface WobblerParams {
  name: string;
  body: { color: string; belly: string; pattern: Pattern; height: number; girth: number };
  face: { eyes: EyeStyle; eyeColor: string; mouth: MouthStyle; cheeks: string | null };
  limbs: { color: string };
  accessories: NormalizedAccessory[];
}

export const DEFAULT_PARAMS: Readonly<WobblerParams> = Object.freeze<WobblerParams>({
  name: 'Wobbler',
  body: {
    color: '#ff8a3d',
    belly: '#ffe4b8',
    pattern: { type: 'none', colors: ['#ff8a3d'], scale: 1 },
    height: 1,
    girth: 1,
  },
  face: { eyes: 'oval', eyeColor: '#1d1b2f', mouth: 'smile', cheeks: null },
  limbs: { color: '#e8702b' },
  accessories: [],
});

type Loose = Record<string, unknown> | undefined;
const HEX = /^#[0-9a-f]{6}$/i;

const obj = (v: unknown): Loose => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);
export const hexOr = (v: unknown, fallback: string): string =>
  typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback;
const numOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;

function vec3(v: unknown, fallback: number, lo: number, hi: number): Vec3 {
  const a = Array.isArray(v) ? v : [];
  return [
    clamp(numOr(a[0], fallback), lo, hi),
    clamp(numOr(a[1], fallback), lo, hi),
    clamp(numOr(a[2], fallback), lo, hi),
  ];
}

function normalizePattern(raw: unknown, bodyColor: string): Pattern {
  const p = obj(raw);
  const colors = (Array.isArray(p?.colors) ? p.colors : [])
    .filter((c): c is string => typeof c === 'string' && HEX.test(c))
    .slice(0, SKIN_LIMITS.maxPatternColors)
    .map((c) => c.toLowerCase());
  const pattern: Pattern = {
    type: pick(p?.type, PATTERN_TYPES, 'none'),
    colors: colors.length > 0 ? colors : [bodyColor],
    scale: clamp(numOr(p?.scale, 1), 0.25, 4),
  };
  if (Array.isArray(p?.tile)) {
    pattern.tile = p.tile.filter((t): t is TileShape => obj(t) !== undefined).slice(0, SKIN_LIMITS.maxTiles);
  }
  return pattern;
}

function normalizePrim(raw: unknown): NormalizedPrim | null {
  const p = obj(raw);
  if (!p || !PRIM_SHAPES.includes(p.shape as PrimShape)) return null;
  const off = SKIN_LIMITS.maxPrimOffset;
  const emissive = hexOr(p.emissive, '#000000');
  return {
    shape: p.shape as PrimShape,
    pos: vec3(p.pos, 0, -off, off),
    rot: vec3(p.rot, 0, -Math.PI * 2, Math.PI * 2),
    scale: vec3(p.scale, 0.2, SKIN_LIMITS.minPrimScale, SKIN_LIMITS.maxPrimScale),
    color: hexOr(p.color, '#ffffff'),
    emissive: emissive === '#000000' ? null : emissive,
  };
}

function normalizeAccessories(raw: unknown): NormalizedAccessory[] {
  const out: NormalizedAccessory[] = [];
  let budget: number = SKIN_LIMITS.maxPrims;
  for (const item of Array.isArray(raw) ? raw : []) {
    if (out.length >= SKIN_LIMITS.maxAccessories || budget <= 0) break;
    const a = obj(item);
    if (!a || !ANCHORS.includes(a.anchor as AnchorName) || !Array.isArray(a.prims)) continue;
    const prims: NormalizedPrim[] = [];
    for (const rp of a.prims) {
      if (prims.length >= budget) break;
      const prim = normalizePrim(rp);
      if (prim) prims.push(prim);
    }
    if (prims.length === 0) continue;
    budget -= prims.length;
    out.push({ anchor: a.anchor as AnchorName, prims });
  }
  return out;
}

/** Map any skin-like value to complete, in-range parameters. Missing or invalid fields use defaults. */
export function normalizeSkin(skin: unknown): WobblerParams {
  const s = obj(skin);
  const b = obj(s?.body);
  const f = obj(s?.face);
  const d = DEFAULT_PARAMS;
  const color = hexOr(b?.color, d.body.color);
  const { minScale, maxScale } = SKIN_LIMITS;
  return {
    name: typeof s?.name === 'string' && s.name.length > 0 ? s.name.slice(0, 24) : d.name,
    body: {
      color,
      belly: hexOr(b?.belly, d.body.belly),
      pattern: normalizePattern(b?.pattern, color),
      height: clamp(numOr(b?.height, 1), minScale, maxScale),
      girth: clamp(numOr(b?.girth, 1), minScale, maxScale),
    },
    face: {
      eyes: pick(f?.eyes, EYE_STYLES, d.face.eyes),
      eyeColor: hexOr(f?.eyeColor, d.face.eyeColor),
      mouth: pick(f?.mouth, MOUTH_STYLES, d.face.mouth),
      cheeks: f?.cheeks === null || f?.cheeks === undefined ? null : hexOr(f.cheeks, '') || null,
    },
    limbs: { color: hexOr(obj(s?.limbs)?.color, d.limbs.color) },
    accessories: normalizeAccessories(s?.accessories),
  };
}

/** Cache key for the pattern texture and body material. */
export const bodyKey = (p: WobblerParams): string =>
  p.body.pattern.type === 'none' ? `plain|${p.body.color}` : `pat|${p.body.color}|${JSON.stringify(p.body.pattern)}`;

/** Cache key for the face, belly and accessory geometry. */
export const detailKey = (p: WobblerParams): string =>
  JSON.stringify([p.body.color, p.body.belly, p.face, p.accessories]);
