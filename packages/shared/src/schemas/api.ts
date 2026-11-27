// HTTP API request/response schemas (Vercel functions). Contract owned by #2. See docs/CONTRACTS.md 2.6.
import { z } from 'zod';
import { LIMITS } from '../constants.ts';
import { PackIdSchema } from './common.ts';
import { PackKindSchema, PackSchema } from './packs.ts';

/** Live generation is skins only (#54, #22). `themeId` adapts the character to that theme's costume kit. */
export const GenerateRequestSchema = z.object({
  kind: z.literal('skin'),
  prompt: z.string().trim().min(3).max(LIMITS.promptMax),
  clientId: z.string().min(8).max(64),
  themeId: PackIdSchema.optional(),
});

export const GenerateResponseSchema = z.object({ id: PackIdSchema, kind: PackKindSchema, pack: PackSchema });

export const ApiErrorSchema = z.object({ error: z.string() });

export const PackListItemSchema = z.object({
  id: PackIdSchema,
  kind: PackKindSchema,
  name: z.string(),
  swatch: z.array(z.string()).max(6),
});

export const PackListResponseSchema = z.object({
  items: z.array(PackListItemSchema),
  nextCursor: z.string().nullable(),
});

export const PackBatchResponseSchema = z.object({ packs: z.array(PackSchema), missing: z.array(z.string()) });

export const BATCH_MAX_IDS = 50;
