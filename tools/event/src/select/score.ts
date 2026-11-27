// Stage 3: score the surviving prompts with the smart model, twice each in shuffled order. Owned by #56.
import { AiInvalidError, AiRefusedError } from '@wobble/ai';
import type { EventAi } from '../lib/ai.ts';
import { mapLimit } from '../lib/concurrency.ts';
import { createRng, seedFrom, shuffled } from '../lib/hash.ts';
import { ScoreBatchSchema } from './schemas.ts';
import type { Criteria } from './schemas.ts';
import type { Candidate } from './screen.ts';

export const SCORE_PASSES = 2;
export const SCORE_BATCH = 10;
export const SCORE_CONCURRENCY = 4;
/** Subtracted from the final score of a flagged submission, so it ranks below the same idea without the injection. */
export const INJECTION_PENALTY = 2;
export const CRITERIA = ['themeability', 'distinctiveness', 'readability', 'partyFit', 'originality'] as const;

export const SCORE_SYSTEM = [
  'You score visual theme ideas for a 3D obstacle-course party race. Only the look changes; gameplay is fixed.',
  'Score every item in the data block from 1 to 10 on each criterion, using the whole range:',
  '- themeability: can it fill the sky, ground, platforms, hazards, props, landmarks and characters?',
  '- distinctiveness: is it recognisable at a glance and visually different from common looks?',
  '- readability: 10 means obstacles stay easy to see. Very dark, low-contrast or "invisible" ideas score low.',
  '- partyFit: cheerful, funny, all-ages party energy.',
  '- originality: a fresh idea, not a copy of existing games or films.',
  'Judge each item on its own merit, not on its position in the list. Return one entry per id with a one-sentence reason.',
].join('\n');

export interface Scored {
  candidate: Candidate;
  total: number;
  passes: number[];
  criteria: Record<keyof Criteria, number>;
  penalty: number;
  reason: string;
}

type Rating = Criteria & { reason: string };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (x: number) => Math.round(x * 1000) / 1000;

async function scoreBatch(ai: EventAi, batch: Candidate[], pass: number): Promise<Map<string, Rating>> {
  const out = new Map<string, Rating>();
  try {
    const { data } = await ai.object({
      role: 'smart',
      name: 'score',
      system: SCORE_SYSTEM,
      input: {
        pass,
        items: batch.map((c) => ({ id: c.submissionId, title: c.titleIdea, idea: c.themePrompt })),
      },
      schema: ScoreBatchSchema,
      maxTokens: 4096,
    });
    const asked = new Set(batch.map((c) => c.submissionId));
    for (const s of data.scores) if (asked.has(s.id) && !out.has(s.id)) out.set(s.id, s);
  } catch (err) {
    if (!(err instanceof AiInvalidError || err instanceof AiRefusedError)) throw err;
  }
  return out;
}

/** One pass over all candidates in a seeded order. Items the model skipped are asked again once, one by one. */
async function scorePass(ai: EventAi, candidates: Candidate[], pass: number, seed: string) {
  const order = shuffled(candidates, createRng(seedFrom(`${seed}:score:${pass}`)));
  const batches: Candidate[][] = [];
  for (let i = 0; i < order.length; i += SCORE_BATCH) batches.push(order.slice(i, i + SCORE_BATCH));
  const ratings = new Map<string, Rating>();
  const add = (m: Map<string, Rating>) => m.forEach((v, k) => ratings.set(k, v));
  (await mapLimit(batches, SCORE_CONCURRENCY, (b) => scoreBatch(ai, b, pass))).forEach(add);
  const missed = order.filter((c) => !ratings.has(c.submissionId));
  (await mapLimit(missed, SCORE_CONCURRENCY, (c) => scoreBatch(ai, [c], pass))).forEach(add);
  return ratings;
}

/**
 * Score every candidate. The result is sorted best first; equal scores are ordered by the seeded RNG.
 * Candidates the model never scored are returned in `unscored`.
 */
export async function scoreCandidates(
  ai: EventAi,
  candidates: Candidate[],
  flagged: ReadonlySet<string>,
  seed: string,
): Promise<{ scored: Scored[]; unscored: Candidate[] }> {
  const passes = [];
  for (let pass = 1; pass <= SCORE_PASSES; pass++) passes.push(await scorePass(ai, candidates, pass, seed));

  const scored: Scored[] = [];
  const unscored: Candidate[] = [];
  for (const candidate of candidates) {
    const got = passes.flatMap((p) => p.get(candidate.submissionId) ?? []);
    if (!got.length) {
      unscored.push(candidate);
      continue;
    }
    const criteria = Object.fromEntries(
      CRITERIA.map((k) => [k, round(mean(got.map((r) => r[k])))]),
    ) as Scored['criteria'];
    const perPass = got.map((r) => round(mean(CRITERIA.map((k) => r[k]))));
    const penalty = flagged.has(candidate.submissionId) ? INJECTION_PENALTY : 0;
    scored.push({
      candidate,
      criteria,
      passes: perPass,
      penalty,
      total: round(Math.max(0, mean(perPass) - penalty)),
      reason: got[0].reason.slice(0, 300),
    });
  }
  return { scored: rankScored(scored, seed), unscored };
}

/** Best first. Ties go to the submission with no penalty, then to a seeded coin that ignores input order. */
export function rankScored(scored: readonly Scored[], seed: string): Scored[] {
  const coin = (s: Scored) => seedFrom(`${seed}:tie:${s.candidate.submissionId}`);
  return scored.slice().sort((a, b) => b.total - a.total || a.penalty - b.penalty || coin(a) - coin(b));
}
