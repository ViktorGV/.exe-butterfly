// Reads tools/event/out/selection.json, written by #56. Mirrors its SelectionSchema, keeping only what
// theme generation uses (extra fields are ignored).
import { HexSchema } from '@wobble/shared';
import { z } from 'zod';

export const PickSchema = z.object({
  rank: z.number().int().min(1),
  submissionId: z.string(),
  /** File-safe theme slug. Pack ids are e:theme-<slug>. */
  slug: z
    .string()
    .max(48)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  themePrompt: z.string().min(1),
  summary: z.string(),
  settingTags: z.array(z.string()),
  moodTags: z.array(z.string()),
  paletteHint: z.array(HexSchema),
  credit: z.string().nullable(),
});
export type Pick = z.infer<typeof PickSchema>;

export const SelectionSchema = z.object({
  version: z.literal(1),
  picks: z
    .array(PickSchema)
    .length(5)
    .refine((picks) => new Set(picks.map((p) => p.slug)).size === picks.length, 'slugs must be unique')
    .refine((picks) => picks.every((p) => p.slug !== 'fixture'), '"fixture" is a reserved slug'),
});

export async function readSelection(file: string): Promise<Pick[]> {
  const source = Bun.file(file);
  if (!(await source.exists())) {
    throw new Error(`no selection file at ${file}. Run event:select first, or pass --selection <path>.`);
  }
  const picks = SelectionSchema.parse(await source.json()).picks;
  return picks.sort((a, b) => a.rank - b.rank);
}
