// Course data schemas. Contract owned by #2. See docs/CONTRACTS.md section 2.3.
import { z } from 'zod';
import { MATERIAL_SLOTS, SEGMENT_TYPES } from '../constants.ts';
import { QuatSchema, Vec3Schema } from './common.ts';

export const ShapeSchema = z.enum(['box', 'cylinder', 'sphere']);
export const SurfaceSchema = z.enum(['solid', 'bouncy', 'slippery']);
export const MaterialSlotSchema = z.enum(MATERIAL_SLOTS);

/**
 * One primitive part of an obstacle.
 * size: box = half extents · cylinder = [radius, halfHeight, 0], axis = local Y · sphere = [radius, 0, 0]
 */
export const PartDefSchema = z.object({
  shape: ShapeSchema,
  size: Vec3Schema,
  surface: SurfaceSchema,
  bounce: z.number().optional(),
  slot: MaterialSlotSchema,
  collide: z.boolean(),
  visible: z.boolean(),
});

export const PoseSchema = z.object({ pos: Vec3Schema, quat: QuatSchema });

export const EntityDefSchema = z.object({
  id: z.number().int().nonnegative(),
  kind: z.string().min(1).max(32),
  pos: Vec3Schema,
  yaw: z.number(),
  params: z.record(z.string(), z.unknown()),
});

/** Slot -> cell, row-major, centred on pos across the row; rows extend backwards (+Z in local space). */
export const SpawnGridSchema = z.object({
  pos: Vec3Schema,
  yaw: z.number(),
  cols: z.number().int().positive(),
  spacing: z.number().positive(),
});

/** Oriented trigger box. */
export const VolumeSchema = z.object({ pos: Vec3Schema, yaw: z.number(), half: Vec3Schema });

export const CheckpointDefSchema = z.object({ volume: VolumeSchema, respawn: SpawnGridSchema });

export const CourseDefSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(48),
  spawn: SpawnGridSchema,
  checkpoints: z.array(CheckpointDefSchema),
  finish: VolumeSchema,
  killY: z.number(),
  bounds: z.object({ min: Vec3Schema, max: Vec3Schema }),
  entities: z.array(EntityDefSchema),
  parTimeMs: z.number().int().positive(),
  timeLimitMs: z.number().int().positive(),
});

export const SegmentTypeSchema = z.enum(SEGMENT_TYPES);

export const CourseSegmentSchema = z.object({
  type: SegmentTypeSchema,
  length: z.enum(['short', 'medium', 'long']),
  intensity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
});

/** What an LLM or designer writes. assembleCourse(recipe) -> CourseDef. */
export const CourseRecipeSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(48),
  seed: z.number().int().nonnegative(),
  segments: z.array(CourseSegmentSchema).min(4).max(12),
});
