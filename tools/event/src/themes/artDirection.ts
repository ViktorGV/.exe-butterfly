// Step 1 and 2: art direction (two structured calls), legibility checks, up to two repair rounds, then a
// deterministic fix for whatever is left. A failed call falls back to the procedural draft (#59).
import { AiHttpError } from '@wobble/ai';
import type { z } from 'zod';
import { isFatal } from './ai.ts';
import type { ThemeAi } from './ai.ts';
import { clampDraft } from './clamp.ts';
import type { ThemeLook } from './clamp.ts';
import { LookDraftSchema, PropsDraftSchema } from './draft.ts';
import type { Draft, ImagePlan } from './draft.ts';
import { autoFix, checkTheme } from './legibility.ts';
import type { Part } from './legibility.ts';
import { proceduralDraft } from './procedural.ts';
import { draftProps, PROPS_PIECES } from './props.ts';
import { fill } from './prompts.ts';
import type { Prompts } from './prompts.ts';
import type { Pick } from './selection.ts';
import type { ImageCounts } from './slots.ts';

export const MAX_REPAIR_ROUNDS = 2;

export interface Direction {
  theme: ThemeLook;
  images: ImagePlan;
  /** The procedural image plan, for entries the model left out. */
  fallbackImages: ImagePlan;
  /** The procedural theme for this pick, which fills anything missing. */
  fallback: ThemeLook;
  /** Parts that came from the procedural draft because the model call failed. */
  proceduralParts: Part[];
  notes: string[];
  /** When the look was first generated (stable across cached reruns); null if it is procedural. */
  createdAt: string | null;
}

const SCHEMAS = { look: LookDraftSchema, props: PropsDraftSchema };
const MAX_TOKENS: Record<Part, number> = { look: 6000, props: 9000 };

/** What the model is told about the pick. The raw submission and username are never sent. */
export const brief = (pick: Pick) => ({
  slug: pick.slug,
  titleIdea: pick.titleIdea,
  themePrompt: pick.themePrompt,
  summary: pick.summary,
  settingTags: pick.settingTags,
  moodTags: pick.moodTags,
  paletteHint: pick.paletteHint,
});

export interface DirectOptions {
  ai: ThemeAi;
  prompts: Prompts;
  counts: ImageCounts;
  fresh?: boolean;
}

export async function directTheme(pick: Pick, opts: DirectOptions): Promise<Direction> {
  const { ai, prompts } = opts;
  const procedural = proceduralDraft(pick);
  const fallback = autoFix(clampDraft(procedural), clampDraft(procedural));
  const notes: string[] = [];
  const proceduralParts: Part[] = [];
  const system: Record<Part, string> = { look: fill(prompts.look, { ...opts.counts }), props: prompts.props };

  async function ask<P extends Part>(part: P, name: string, input: unknown) {
    const call = {
      name,
      system: system[part],
      input,
      schema: SCHEMAS[part] as unknown as z.ZodType<Draft[P]>,
      maxTokens: MAX_TOKENS[part],
      fresh: opts.fresh,
    };
    try {
      return await ai.object(call);
    } catch (err) {
      // Some providers reject large schemas with a 400: try the cheaper model once before giving up.
      if (!(err instanceof AiHttpError) || err.details.status !== 400) throw err;
      notes.push(`${name}: the smart model rejected the request, retried with the fast model`);
      return await ai.object({ ...call, role: 'fast' as const });
    }
  }

  async function draftPart<P extends Part>(part: P, input: unknown) {
    try {
      return await ask(part, part, input);
    } catch (err) {
      if (isFatal(err)) throw err;
      proceduralParts.push(part);
      notes.push(`${part}: using the procedural fallback (${(err as Error).message})`);
      return { data: procedural[part], cached: false, createdAt: null };
    }
  }

  const look = await draftPart('look', { pick: brief(pick) });
  const propsContext = {
    pick: brief(pick),
    theme: {
      title: look.data.title,
      sky: look.data.sky,
      materials: look.data.materials.map((m) => ({ slot: m.slot, color: m.color })),
      fx: look.data.fx,
    },
  };
  const propsOpts = { ai, system: prompts.props, context: propsContext, procedural: procedural.props, fresh: opts.fresh };
  const props = await draftProps(propsOpts);
  notes.push(...props.notes);
  // Every piece failed: the props are the procedural ones, so repair rounds skip them.
  if (props.failed.length === PROPS_PIECES) proceduralParts.push('props');
  const draft: Draft = { look: look.data, props: props.data };

  for (let round = 1; round <= MAX_REPAIR_ROUNDS; round++) {
    const issues = checkTheme(clampDraft(draft));
    const parts = [...new Set(issues.map((i) => i.part))].filter((p) => !proceduralParts.includes(p));
    if (!parts.length) break;
    for (const part of parts) {
      const problems = issues.filter((i) => i.part === part).map((i) => i.message);
      notes.push(`repair ${round} (${part}): ${problems.join('; ')}`);
      try {
        if (part === 'props') {
          // Re-asks only the pieces that are still short; good pieces come back from the cache.
          const res = await draftProps({ ...propsOpts, previous: draft.props, problems });
          notes.push(...res.notes);
          draft.props = res.data;
          continue;
        }
        const input = { pick: brief(pick), previousAnswer: draft[part], fixTheseProblems: problems };
        const res = await ask(part, `repair-${part}`, input);
        Object.assign(draft, { [part]: res.data });
      } catch (err) {
        if (isFatal(err)) throw err;
        notes.push(`repair ${round} (${part}) failed: ${(err as Error).message}`);
      }
    }
  }

  const clamped = clampDraft(draft);
  const remaining = checkTheme(clamped);
  if (remaining.length) notes.push(`fixed automatically: ${remaining.map((i) => i.message).join('; ')}`);
  return {
    theme: autoFix(clamped, fallback),
    images: draft.look.images,
    fallbackImages: procedural.look.images,
    fallback,
    proceduralParts,
    notes,
    createdAt: look.createdAt,
  };
}
