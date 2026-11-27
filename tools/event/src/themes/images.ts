// Steps 3 to 5 for one slot: generate, post-process, check with the vision model, retry with its notes, and
// give up with `null` after three tries. Nothing here stops the run (#59).
import { z } from 'zod';
import type { ChromaName } from '../images/chroma.ts';
import { processImage } from '../images/process.ts';
import type { ProcessedImage } from '../images/process.ts';
import type { Rgb } from '../images/raw.ts';
import { isBudgetError, isFatal } from './ai.ts';
import type { ThemeAi } from './ai.ts';
import { fill } from './prompts.ts';
import type { Prompts } from './prompts.ts';
import type { Slot } from './slots.ts';

export const MAX_ATTEMPTS = 3;

export const QaSchema = z.object({
  pass: z.boolean(),
  matchesBrief: z.boolean(),
  hasTextOrLogo: z.boolean(),
  unsafe: z.boolean(),
  styleFit: z.enum(['good', 'ok', 'poor']),
  notes: z.string(),
});
export type Qa = z.infer<typeof QaSchema>;

export const qaPasses = (qa: Qa): boolean =>
  qa.pass && qa.matchesBrief && !qa.hasTextOrLogo && !qa.unsafe && qa.styleFit !== 'poor';

export interface SlotColors {
  palette: Rgb[];
  /** Hex list written into the prompt. */
  names: string[];
  /** Main colour of a texture. */
  main: string;
  chroma: ChromaName;
}

export interface SlotContext {
  ai: ThemeAi;
  prompts: Prompts;
  title: string;
  colors: SlotColors;
  /** Output size multiplier (tests). */
  scale?: number;
  /** Ignore cached images and verdicts for this slot (--slot). */
  fresh?: boolean;
  /** Treat every QA verdict for this slot as a failure (--fail-slot). */
  forceFail?: boolean;
  /** Set once the account is out of credit; later slots are skipped. */
  halt: { reason: string | null };
}

export interface SlotResult {
  slot: Slot;
  image: ProcessedImage | null;
  attempts: number;
  /** Why the slot is null. */
  reason?: string;
}

export function imagePrompt(slot: Slot, ctx: Pick<SlotContext, 'prompts' | 'colors'>): string {
  const chroma = ctx.colors.chroma === 'magenta' ? 'magenta (#FF00FF)' : 'green (#00FF00)';
  const format = fill(ctx.prompts[slot.kind], {
    colors: ctx.colors.names.join(', '),
    color: ctx.colors.main,
    chroma,
  });
  return [slot.subject.trim(), format, ctx.prompts.styleGuide].join('\n\n');
}

export async function makeImage(slot: Slot, ctx: SlotContext): Promise<SlotResult> {
  const base = imagePrompt(slot, ctx);
  let notes = '';
  let attempts = 0;
  const give = (reason: string): SlotResult => ({ slot, image: null, attempts, reason });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (ctx.halt.reason) return give(ctx.halt.reason);
    attempts++;
    try {
      const generated = await ctx.ai.image({
        name: slot.id,
        prompt: notes ? `${base}\n\nThe last attempt was rejected. Fix this: ${notes}` : base,
        aspectRatio: slot.aspectRatio,
        attempt,
        fresh: ctx.fresh,
      });
      const processed = await processImage(generated.data, {
        base: slot.base,
        kind: slot.kind,
        palette: ctx.colors.palette,
        chroma: ctx.colors.chroma,
        scale: ctx.scale,
      });
      if (!processed.ok) {
        notes = processed.reason;
        continue;
      }
      const verdict = await ctx.ai.vision({
        name: 'qa',
        system: ctx.prompts.qa,
        input: { theme: ctx.title, slot: slot.id, kind: slot.kind, brief: slot.subject },
        images: [{ bytes: processed.image.preview, mediaType: 'image/jpeg' }],
        schema: QaSchema,
        maxTokens: 600,
        fresh: ctx.fresh,
      });
      if (!ctx.forceFail && qaPasses(verdict.data)) return { slot, image: processed.image, attempts };
      notes = ctx.forceFail ? 'forced QA failure' : verdict.data.notes || 'failed the quality check';
    } catch (err) {
      if (isBudgetError(err)) return give(`budget: ${(err as Error).message}`);
      if (isFatal(err)) {
        ctx.halt.reason = (err as Error).message;
        return give(ctx.halt.reason);
      }
      notes = (err as Error).message;
    }
  }
  return give(`failed ${MAX_ATTEMPTS} times: ${notes}`);
}
