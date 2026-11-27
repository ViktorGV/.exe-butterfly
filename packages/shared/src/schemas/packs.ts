// Asset pack schemas. Contract owned by #2. See docs/CONTRACTS.md section 2.4.
// None of these schemas may be recursive: LLM structured outputs reject recursive schemas.
// Numeric ranges are NOT enforced here; sanitizePack (packages/shared/src/assets) clamps them.
import { z } from 'zod';
import { MATERIAL_SLOTS } from '../constants.ts';
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
    .max(3)
    .refine((list) => list.reduce((n, a) => n + a.prims.length, 0) <= 24, 'at most 24 prims in total'),
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

export const ThemeDefSchema = z.object({
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
