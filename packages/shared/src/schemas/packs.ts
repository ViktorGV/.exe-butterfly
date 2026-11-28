// Asset pack schemas. Contract owned by #2. See docs/CONTRACTS.md section 2.4.
// None of these schemas may be recursive: LLM structured outputs reject recursive schemas.
// Numeric ranges are NOT enforced here; sanitizePack (packages/shared/src/assets) clamps them.
import { z } from 'zod';
import {
  ACCESSORY_ANCHORS,
  GROUND_KINDS,
  HUD_FONTS,
  LANDMARK_ANCHORS,
  MATERIAL_SLOTS,
  MUSIC_INSTRUMENTS,
  OBSTACLE_KINDS,
  PARTICLE_KINDS,
  SIGNAGE_SLOTS,
  SKIN_EYES,
  SKIN_MOUTHS,
} from '../constants.ts';
import { CourseRecipeSchema } from './course.ts';
import { HexSchema, PackIdSchema, Vec3Schema } from './common.ts';

export const TileShapeSchema = z.object({
  kind: z.enum(['circle', 'rect', 'poly']),
  fill: HexSchema,
  x: z.number(),
  y: z.number(),
  r: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  rot: z.number().optional(),
  points: z
    .array(z.tuple([z.number(), z.number()]))
    .max(16)
    .optional(),
});

export const PatternSchema = z.object({
  type: z.enum(['none', 'stripes', 'dots', 'checker', 'zigzag', 'waves', 'custom']),
  colors: z.array(HexSchema).min(1).max(4),
  scale: z.number(),
  tile: z.array(TileShapeSchema).max(24).optional(),
});

export const PrimSchema = z.object({
  shape: z.enum(['sphere', 'box', 'cylinder', 'cone', 'torus', 'capsule']),
  pos: Vec3Schema,
  rot: Vec3Schema,
  scale: Vec3Schema,
  color: HexSchema,
  emissive: HexSchema.optional(),
});

export const AccessorySchema = z.object({
  anchor: z.enum(['headTop', 'face', 'back', 'waist']),
  prims: z.array(PrimSchema).min(1).max(24),
});

export const SkinDefSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(24),
  body: z.object({
    color: HexSchema,
    belly: HexSchema,
    pattern: PatternSchema,
    height: z.number(), // 0.85..1.15, cosmetic only
    girth: z.number(), // 0.85..1.15, cosmetic only
  }),
  face: z.object({
    eyes: z.enum(['dot', 'oval', 'sleepy', 'star', 'wide']),
    eyeColor: HexSchema,
    mouth: z.enum(['smile', 'o', 'flat', 'grin', 'none']),
    cheeks: HexSchema.nullable(),
  }),
  limbs: z.object({ color: HexSchema }),
  accessories: z
    .array(AccessorySchema)
    .max(5)
    .refine((list) => list.reduce((n, a) => n + a.prims.length, 0) <= 40, 'at most 40 prims in total'),
});

export const MaterialDefSchema = z.object({
  color: HexSchema,
  roughness: z.number(),
  metalness: z.number(),
  emissive: HexSchema.optional(),
  pattern: PatternSchema.optional(),
});

const materialShape = Object.fromEntries(MATERIAL_SLOTS.map((slot) => [slot, MaterialDefSchema]));

export const DecorSchema = z.object({
  name: z.string().min(1).max(24),
  prims: z.array(PrimSchema).min(1).max(12),
  density: z.number(),
  minScale: z.number(),
  maxScale: z.number(),
});

export const ThemeDefV1Schema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(24),
  sky: z.object({ top: HexSchema, horizon: HexSchema, bottom: HexSchema }),
  fog: z.object({ color: HexSchema, near: z.number(), far: z.number() }),
  light: z.object({
    ambient: HexSchema,
    ambientIntensity: z.number(),
    sun: HexSchema,
    sunIntensity: z.number(),
    sunDir: Vec3Schema,
  }),
  materials: z.object(materialShape),
  decor: z.array(DecorSchema).max(6),
  music: z.object({
    tempo: z.number(),
    scale: z.enum(['major', 'minor', 'pentatonic', 'lydian']),
    energy: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
});

// ---- ThemeDef v2 (event themes, #54) -----------------------------------------------------
// A superset of v1 in spirit: sanitizePack (#16) upgrades v1 to v2 by filling defaults.
// Optional parts are `.nullable()` (not `.optional()`) so OpenRouter strict JSON-schema mode
// can require every key. Numeric ranges and the fairness rules are enforced by sanitizePack.

/** A pregenerated image next to the theme JSON. `src` is a bare file name in the theme folder, never a URL. */
export const ImageRefSchema = z.object({
  src: z.string().regex(/^[a-z0-9-]+(@0\.5x)?\.webp$/, 'expected <name>.webp'),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  alpha: z.boolean(),
  /** half-resolution variant for low quality presets */
  lowSrc: z
    .string()
    .regex(/^[a-z0-9-]+@0\.5x\.webp$/)
    .nullable(),
});

export const ThemeMaterialSchema = MaterialDefSchema.extend({ texture: ImageRefSchema.nullable() });
const themeMaterialShape = Object.fromEntries(MATERIAL_SLOTS.map((slot) => [slot, ThemeMaterialSchema]));

export const ParticlesSchema = z.object({
  kind: z.enum(PARTICLE_KINDS),
  color: HexSchema,
  density: z.number(), // 0..1
  speed: z.number(), // 0..1
});

/** Cosmetic, never collides, follows the pose of part `part` of every obstacle of `kind`. */
export const DressingSchema = z.object({
  kind: z.enum(OBSTACLE_KINDS),
  part: z.number().int().nonnegative(),
  prims: z.array(PrimSchema).min(1).max(16),
  hideBase: z.boolean(),
  /** Draw the prims with this slot's texture, tinted by each prim's colour; null = flat colours. */
  slot: z.enum(MATERIAL_SLOTS).nullable(),
});

export const LandmarkSchema = z.object({
  anchor: z.enum(LANDMARK_ANCHORS),
  name: z.string().min(1).max(24),
  prims: z.array(PrimSchema).min(1).max(48),
  scale: z.number(),
});

/** One shape for both decor types so it stays LLM-friendly: `prims` is empty for sprites, `image` null for prims. */
export const DecorV2Schema = z.object({
  type: z.enum(['prims', 'sprite']),
  name: z.string().min(1).max(24),
  prims: z.array(PrimSchema).max(12),
  image: ImageRefSchema.nullable(),
  density: z.number(),
  minScale: z.number(),
  maxScale: z.number(),
});

export const SignageSchema = z.object({ slot: z.enum(SIGNAGE_SLOTS), image: ImageRefSchema });

export const CostumeAccessorySchema = z.object({
  name: z.string().min(1).max(24),
  anchor: z.enum(ACCESSORY_ANCHORS),
  prims: z.array(PrimSchema).min(1).max(16),
});

/** What characters in this theme are dressed with (#63 personal skins, #68 random skins). */
export const CostumeKitSchema = z.object({
  palette: z.array(HexSchema).min(3).max(8),
  accessories: z.array(CostumeAccessorySchema).min(1).max(12),
  eyes: z.array(z.enum(SKIN_EYES)).min(1).max(5),
  mouths: z.array(z.enum(SKIN_MOUTHS)).min(1).max(5),
});

/** An original character inspired by the theme (#84). Never a real or existing character. */
export const CastMemberSchema = z.object({
  name: z.string().min(1).max(24),
  description: z.string().min(1).max(160),
});

export const ThemeDefV2Schema = z.object({
  version: z.literal(2),
  name: z.string().min(1).max(24),
  /** shown on the vote card and the reveal */
  title: z.string().min(1).max(32),
  tagline: z.string().max(80),
  /** submitter display name, only with their consent */
  credit: z.string().max(24).nullable(),
  sky: z.object({ top: HexSchema, horizon: HexSchema, bottom: HexSchema, image: ImageRefSchema.nullable() }),
  fog: z.object({ color: HexSchema, near: z.number(), far: z.number() }),
  light: z.object({
    ambient: HexSchema,
    ambientIntensity: z.number(),
    sun: HexSchema,
    sunIntensity: z.number(),
    sunDir: Vec3Schema,
  }),
  materials: z.object(themeMaterialShape),
  /** what you see below the course; motion 0..1 */
  ground: z.object({
    kind: z.enum(GROUND_KINDS),
    color: HexSchema,
    emissive: HexSchema.nullable(),
    motion: z.number(),
  }),
  particles: z.array(ParticlesSchema).max(2),
  dressing: z.array(DressingSchema).max(24),
  landmarks: z.array(LandmarkSchema).max(4),
  decor: z.array(DecorV2Schema).max(8),
  signage: z.array(SignageSchema).max(6),
  costume: CostumeKitSchema,
  fx: z.object({ confetti: z.array(HexSchema).min(1).max(5), checkpoint: HexSchema, hit: HexSchema }),
  hud: z.object({ accent: HexSchema, font: z.enum(HUD_FONTS) }),
  music: z.object({
    tempo: z.number(),
    scale: z.enum(['major', 'minor', 'pentatonic', 'lydian']),
    energy: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    instrument: z.enum(MUSIC_INSTRUMENTS),
    swing: z.number(), // 0..1
  }),
  art: z.object({
    voteCard: ImageRefSchema.nullable(),
    reveal: ImageRefSchema.nullable(),
    podium: ImageRefSchema.nullable(),
  }),
  /** hero and villain for the butterfly effect (#84); null = generic fallback */
  cast: z.object({ hero: CastMemberSchema, villain: CastMemberSchema }).nullable(),
});

/** Any theme version. sanitizePack (#16) always returns v2. */
export const ThemeDefSchema = z.discriminatedUnion('version', [ThemeDefV1Schema, ThemeDefV2Schema]);

export const PackKindSchema = z.enum(['skin', 'theme', 'course']);

const packBase = {
  id: PackIdSchema,
  name: z.string().min(1).max(48),
  prompt: z.string().max(200).optional(),
  createdAt: z.string(),
};

export const SkinPackSchema = z.object({ ...packBase, kind: z.literal('skin'), data: SkinDefSchema });
export const ThemePackSchema = z.object({ ...packBase, kind: z.literal('theme'), data: ThemeDefSchema });
export const CoursePackSchema = z.object({ ...packBase, kind: z.literal('course'), data: CourseRecipeSchema });

export const PackSchema = z.discriminatedUnion('kind', [SkinPackSchema, ThemePackSchema, CoursePackSchema]);

/** Data schema for a pack kind. */
export const PACK_DATA_SCHEMAS = Object.freeze({
  skin: SkinDefSchema,
  theme: ThemeDefSchema,
  course: CourseRecipeSchema,
});
