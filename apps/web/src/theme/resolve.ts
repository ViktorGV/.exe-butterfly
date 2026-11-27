// Defensive theme resolution: every missing or invalid field falls back to the default theme value.
// Never throws; the result is always a complete, in-range ThemeDef.
import { MATERIAL_SLOTS } from '@wobble/shared/constants';
import { fixtureTheme } from '@wobble/shared/fixtures/index';
import type { MaterialDef, MaterialSlot, Pattern, Prim, ThemeDef, Vec3 } from '@wobble/shared/types';

/** The theme used for every field a theme leaves out or gets wrong. */
export const DEFAULT_THEME: ThemeDef = fixtureTheme;

type Decor = ThemeDef['decor'][number];
type Obj = Record<string, unknown>;

const HEX = /^#[0-9a-fA-F]{6}$/;
const PATTERN_TYPES = new Set<Pattern['type']>(['none', 'stripes', 'dots', 'checker', 'zigzag', 'waves', 'custom']);
const PRIM_SHAPES = new Set<Prim['shape']>(['sphere', 'box', 'cylinder', 'cone', 'torus', 'capsule']);
export const MAX_DECOR_KINDS = 6;
export const MAX_DECOR_PRIMS = 12;

const obj = (v: unknown): Obj | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const hex = (v: unknown, fb: string): string => (typeof v === 'string' && HEX.test(v) ? v : fb);
const num = (v: unknown, fb: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb;
const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

function resolvePattern(raw: unknown, fb: Pattern | undefined): Pattern | undefined {
  if (raw === undefined) return undefined;
  const p = obj(raw);
  if (!p || typeof p.type !== 'string' || !PATTERN_TYPES.has(p.type as Pattern['type'])) return fb;
  const colors = Array.isArray(p.colors)
    ? p.colors.filter((c): c is string => typeof c === 'string' && HEX.test(c))
    : [];
  if (colors.length === 0) return fb;
  const out: Pattern = { type: p.type as Pattern['type'], colors: colors.slice(0, 4), scale: num(p.scale, 1, 0.25, 4) };
  if (Array.isArray(p.tile)) out.tile = p.tile.slice(0, 24) as Pattern['tile'];
  return out;
}

function resolveMaterial(raw: unknown, fb: MaterialDef): MaterialDef {
  const m = obj(raw);
  if (!m) return fb;
  const out: MaterialDef = {
    color: hex(m.color, fb.color),
    roughness: num(m.roughness, fb.roughness, 0, 1),
    metalness: num(m.metalness, fb.metalness, 0, 1),
  };
  const emissive = m.emissive === undefined ? undefined : hex(m.emissive, fb.emissive ?? '#000000');
  if (emissive) out.emissive = emissive;
  const pattern = resolvePattern(m.pattern, fb.pattern);
  if (pattern) out.pattern = pattern;
  return out;
}

function resolvePrim(raw: unknown): Prim | null {
  const p = obj(raw);
  if (!p || typeof p.shape !== 'string' || !PRIM_SHAPES.has(p.shape as Prim['shape'])) return null;
  const scale: Vec3 = isVec3(p.scale) ? [p.scale[0], p.scale[1], p.scale[2]] : [1, 1, 1];
  for (let i = 0; i < 3; i++) scale[i] = Math.min(20, Math.max(0.01, Math.abs(scale[i])));
  const prim: Prim = {
    shape: p.shape as Prim['shape'],
    pos: isVec3(p.pos) ? (p.pos.map((n) => Math.min(20, Math.max(-20, n))) as Vec3) : [0, 0, 0],
    rot: isVec3(p.rot) ? p.rot : [0, 0, 0],
    scale,
    color: hex(p.color, '#ffffff'),
  };
  if (typeof p.emissive === 'string' && HEX.test(p.emissive)) prim.emissive = p.emissive;
  return prim;
}

function resolveDecorEntry(raw: unknown): Decor | null {
  const d = obj(raw);
  if (!d || !Array.isArray(d.prims)) return null;
  const prims = d.prims
    .slice(0, MAX_DECOR_PRIMS)
    .map(resolvePrim)
    .filter((p): p is Prim => p !== null);
  if (prims.length === 0) return null;
  let minScale = num(d.minScale, 1, 0.1, 10);
  let maxScale = num(d.maxScale, minScale, 0.1, 10);
  if (minScale > maxScale) [minScale, maxScale] = [maxScale, minScale];
  return {
    name: typeof d.name === 'string' && d.name.length > 0 ? d.name.slice(0, 24) : 'decor',
    prims,
    density: num(d.density, 0.4, 0, 1),
    minScale,
    maxScale,
  };
}

/** Turn any input (valid, partial or garbage) into a complete ThemeDef. */
export function resolveTheme(input: unknown): ThemeDef {
  const d = DEFAULT_THEME;
  const t = obj(input) ?? {};
  const sky = obj(t.sky) ?? {};
  const fog = obj(t.fog) ?? {};
  const light = obj(t.light) ?? {};
  const mats = obj(t.materials) ?? {};

  const near = num(fog.near, d.fog.near, 0, 2000);
  let far = num(fog.far, d.fog.far, 1, 4000);
  if (far <= near) far = near + Math.max(1, d.fog.far - d.fog.near);

  // The sun must shine downward and be a usable direction.
  const sd = light.sunDir;
  const sunDir: Vec3 =
    isVec3(sd) && sd[1] < 0 && Math.hypot(sd[0], sd[1], sd[2]) > 1e-3 ? [sd[0], sd[1], sd[2]] : [...d.light.sunDir];

  const materials = {} as Record<MaterialSlot, MaterialDef>;
  for (const slot of MATERIAL_SLOTS) materials[slot] = resolveMaterial(mats[slot], d.materials[slot]);

  const decor = Array.isArray(t.decor)
    ? t.decor
        .slice(0, MAX_DECOR_KINDS)
        .map(resolveDecorEntry)
        .filter((x): x is Decor => x !== null)
    : d.decor;

  return {
    version: 1,
    name: typeof t.name === 'string' && t.name.length > 0 ? t.name.slice(0, 24) : d.name,
    sky: {
      top: hex(sky.top, d.sky.top),
      horizon: hex(sky.horizon, d.sky.horizon),
      bottom: hex(sky.bottom, d.sky.bottom),
    },
    fog: { color: hex(fog.color, d.fog.color), near, far },
    light: {
      ambient: hex(light.ambient, d.light.ambient),
      ambientIntensity: num(light.ambientIntensity, d.light.ambientIntensity, 0, 4),
      sun: hex(light.sun, d.light.sun),
      sunIntensity: num(light.sunIntensity, d.light.sunIntensity, 0, 6),
      sunDir,
    },
    materials,
    decor,
    music: obj(t.music) ? (t.music as ThemeDef['music']) : d.music, // the audio module owns music validation
  };
}
