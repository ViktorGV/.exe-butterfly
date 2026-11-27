// Stage 4: one smart call chooses 5 varied themes from the top 20; code enforces the variety rules. Owned by #56.
import { AiInvalidError, AiRefusedError } from '@wobble/ai';
import type { EventAi } from '../lib/ai.ts';
import { createRng, seedFrom, shuffled } from '../lib/hash.ts';
import { PickSchema } from './schemas.ts';
import type { Scored } from './score.ts';
import { chooseVaried, normalizeSetting, PICK_COUNT } from './variety.ts';

export const SHORTLIST = 20;
/** How many candidates beyond the shortlist the fallback search looks at (plus the best of every setting). */
const FALLBACK_POOL = 40;

export const PICK_SYSTEM = [
  `Choose exactly ${PICK_COUNT} themes for a party game vote from the items in the data block, best first.`,
  'Players vote between them, so they must feel clearly different: no two with the same primary setting (the first',
  'settingTags entry), clearly different colour palettes, and a mix of moods. Prefer higher scores.',
  'Return the id and a one-sentence reason for each choice.',
].join('\n');

export interface Picked {
  scored: Scored;
  reason: string;
}

export interface PickResult {
  picks: Picked[];
  /** Submission ids of the top candidates offered to the model. */
  shortlist: string[];
  relaxed: string[];
}

async function askModel(ai: EventAi, shortlist: Scored[], seed: string): Promise<Map<string, string> | null> {
  const order = shuffled(shortlist, createRng(seedFrom(`${seed}:pick`)));
  try {
    const { data } = await ai.object({
      role: 'smart',
      name: 'pick',
      system: PICK_SYSTEM,
      input: {
        items: order.map(({ candidate: c, total }) => ({
          id: c.submissionId,
          title: c.titleIdea,
          summary: c.summary,
          settingTags: c.settingTags,
          moodTags: c.moodTags,
          paletteHint: c.paletteHint,
          score: total,
        })),
      },
      schema: PickSchema,
      maxTokens: 2048,
    });
    return new Map(data.picks.map((p) => [p.id, p.reason.slice(0, 300)]));
  } catch (err) {
    if (err instanceof AiInvalidError || err instanceof AiRefusedError) return null;
    throw err;
  }
}

/** `ranked` is every scored candidate, best first. Throws if there are fewer than PICK_COUNT. */
export async function pickThemes(ai: EventAi, ranked: Scored[], seed: string): Promise<PickResult> {
  if (ranked.length < PICK_COUNT) throw new Error(`only ${ranked.length} usable game prompts; need ${PICK_COUNT}`);
  const shortlist = ranked.slice(0, SHORTLIST);
  const chosen = await askModel(ai, shortlist, seed);
  const byId = new Map(shortlist.map((s) => [s.candidate.submissionId, s]));
  // Preference: the model's choices in its order, then the rest of the shortlist by score ("next best").
  const modelPicks = [...(chosen?.keys() ?? [])].flatMap((id) => byId.get(id) ?? []);
  const preferred = [...modelPicks, ...shortlist.filter((s) => !modelPicks.includes(s))];

  const bestPerSetting = new Map<string, Scored>();
  for (const s of ranked) {
    const setting = normalizeSetting(s.candidate.settingTags[0]);
    if (!bestPerSetting.has(setting)) bestPerSetting.set(setting, s);
  }
  const best = new Set(bestPerSetting.values());
  const extra = ranked.slice(SHORTLIST).filter((s, i) => i < FALLBACK_POOL - SHORTLIST || best.has(s));

  const { picks, relaxed } = chooseVaried(preferred, [...preferred, ...extra], (s) => s.candidate);
  if (!chosen) relaxed.push('the pick call failed: picked by score under the variety rules');
  return {
    shortlist: shortlist.map((s) => s.candidate.submissionId),
    relaxed,
    picks: picks.map((scored) => ({
      scored,
      reason:
        chosen?.get(scored.candidate.submissionId) ||
        `swapped in by the variety rules as the next-best candidate (score ${scored.total})`,
    })),
  };
}
