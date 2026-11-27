// Types and structured-output schemas for character pregeneration (#63).
import { z } from 'zod';
import { SkinDefSchema } from '@wobble/shared/schemas/packs';
import { HexSchema } from '@wobble/shared/schemas/common';
import type { ThemeDefV2 } from '@wobble/shared';

export const SCREEN_STATUSES = ['ok', 'tooVague', 'unsafe', 'empty'] as const;
export type ScreenStatus = (typeof SCREEN_STATUSES)[number];

export const TraitsSchema = z.object({
  /** the character's own colours, most important first */
  colors: z.array(HexSchema).max(4),
  /** concrete visual motifs: "crown", "bubbles", "horns" */
  motifs: z.array(z.string().min(1).max(24)).max(5),
  /** one or two words: "sweet", "grumpy", "regal" */
  vibe: z.string().max(40),
  /** body shape in a few words: "tall and thin", "round" */
  silhouette: z.string().max(40),
});
export type Traits = z.infer<typeof TraitsSchema>;

/** Output of the screening call. */
export const ScreenSchema = z.object({
  status: z.enum(SCREEN_STATUSES),
  traits: TraitsSchema,
  /** true when the prompt named an existing character or a real person and was made generic */
  reinterpretedFromIP: z.boolean(),
  /** the screened, generic description kept in the roster for #68's live fallback */
  description: z.string().max(300),
});
export type Screen = z.infer<typeof ScreenSchema>;

/** Output of one pool batch call. */
export const PoolBatchSchema = z.object({ characters: z.array(SkinDefSchema).min(1).max(10) });

/** A theme as the character step sees it. */
export interface ThemeInput {
  /** e:theme-... id from the manifest */
  id: string;
  /** short slug used in skin ids */
  slug: string;
  def: ThemeDefV2;
}

export type CastRole = 'hero' | 'villain';
