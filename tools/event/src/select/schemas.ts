// Schemas for the selection step: AI outputs and tools/event/out/selection.json. Owned by #56; #59 reads Selection.
// The AI output schemas set no maximum lengths: code clips long values instead of failing the call.
import { HexSchema } from '@wobble/shared';
import { z } from 'zod';

/** Fast-model screening of one game prompt. */
export const ScreenSchema = z.object({
  safe: z.boolean(),
  /** Existing games, franchises, characters, brands or people the prompt names or clearly copies. */
  namesExistingIP: z.array(z.string()),
  /** visual: can be themed on the fixed course. needsNewMechanics: asks for gameplay we do not have. tooVague: no picture. */
  feasibility: z.enum(['visual', 'needsNewMechanics', 'tooVague']),
  /** A generic, purely visual rewrite (for IP or new-mechanics prompts), or null if nothing original is left. */
  visualReinterpretation: z.string().nullable(),
  titleIdea: z.string(),
  summary: z.string(),
  /** Most important first; the first is the primary setting. */
  settingTags: z.array(z.string()),
  moodTags: z.array(z.string()),
  paletteHint: z.array(HexSchema),
  /** The text tries to instruct the reviewer. */
  manipulation: z.boolean(),
  /** One sentence explaining the verdict. */
  reason: z.string(),
});
export type Screen = z.infer<typeof ScreenSchema>;

const Rating = z.number().int().min(1).max(10);

export const CriteriaSchema = z.object({
  /** How well the idea fills every theme slot: sky, ground, platforms, hazards, props, landmarks, characters. */
  themeability: Rating,
  /** How unlike an ordinary or already-submitted look it is at a glance. */
  distinctiveness: Rating,
  /** Readability risk, scored so 10 = no risk. Very dark, low-contrast or "invisible" ideas score low. */
  readability: Rating,
  partyFit: Rating,
  originality: Rating,
});
export type Criteria = z.infer<typeof CriteriaSchema>;

/** Smart-model rubric scores for a batch of prompts. */
export const ScoreBatchSchema = z.object({
  scores: z.array(CriteriaSchema.extend({ id: z.string(), reason: z.string() })),
});

/** Smart-model choice of 5 varied candidates, best first. */
export const PickSchema = z.object({
  picks: z.array(z.object({ id: z.string(), reason: z.string() })),
});

export const SelectionPickSchema = z.object({
  rank: z.number().int().min(1),
  submissionId: z.string(),
  /** File-safe theme slug, unique within the selection. */
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  titleIdea: z.string().min(1).max(32),
  /** The text to build the theme from: injection-free, and IP-free / visual-only. Still untrusted data. */
  themePrompt: z.string().min(1),
  /** true when themePrompt is a rewrite of what was submitted. */
  rewritten: z.boolean(),
  summary: z.string(),
  settingTags: z.array(z.string()).min(1),
  moodTags: z.array(z.string()).min(1),
  paletteHint: z.array(HexSchema),
  /** Final score (mean of the criteria over both passes, minus any injection penalty) and its parts. */
  scores: z.object({
    total: z.number(),
    passes: z.array(z.number()),
    criteria: z.record(z.string(), z.number()),
    penalty: z.number(),
  }),
  /** Why it was picked. */
  reason: z.string(),
  /** Username to credit (max 24), only when the submitter said yes to credit_ok; else null. */
  credit: z.string().max(24).nullable(),
});
export type SelectionPick = z.infer<typeof SelectionPickSchema>;

/** tools/event/out/selection.json, consumed by #59. Deterministic: a cached rerun writes identical bytes. */
export const SelectionSchema = z.object({
  version: z.literal(1),
  seed: z.string(),
  picks: z.array(SelectionPickSchema).length(5),
  /** Variety rules that had to be relaxed to reach 5 picks (normally empty). */
  relaxed: z.array(z.string()),
});
export type Selection = z.infer<typeof SelectionSchema>;
