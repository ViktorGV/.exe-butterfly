// A picked username is shown to everyone as the theme's credit, so it is screened too. Owned by #56.
import { AiInvalidError, AiRefusedError } from '@wobble/ai';
import { z } from 'zod';
import type { EventAi } from '../lib/ai.ts';
import { looksLikeInjection } from './injection.ts';

export const CreditSchema = z.object({ names: z.array(z.object({ id: z.string(), ok: z.boolean() })) });

export const CREDIT_SYSTEM = [
  'These usernames may be shown on screen at an all-ages event. For each id answer ok: false if the name is rude,',
  'sexual, hateful, violent, about drugs, a slur (also disguised spelling), or names a brand or a real public person.',
].join('\n');

/** Ids whose name may be shown. Fails closed: no clear "ok" means no credit. */
export async function screenCredits(ai: EventAi, names: Array<{ id: string; name: string }>): Promise<Set<string>> {
  const asked = names.filter((n) => !looksLikeInjection(n.name));
  if (!asked.length) return new Set();
  try {
    const { data } = await ai.object({
      role: 'fast',
      name: 'credit',
      system: CREDIT_SYSTEM,
      input: { names: asked },
      schema: CreditSchema,
      maxTokens: 512,
    });
    const rejected = new Set(data.names.filter((n) => !n.ok).map((n) => n.id));
    const ok = new Set(data.names.filter((n) => n.ok && !rejected.has(n.id)).map((n) => n.id));
    return new Set(asked.map((n) => n.id).filter((id) => ok.has(id)));
  } catch (err) {
    if (err instanceof AiInvalidError || err instanceof AiRefusedError) return new Set();
    throw err;
  }
}
