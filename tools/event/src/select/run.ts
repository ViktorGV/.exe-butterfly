// The selection pipeline: screen -> de-duplicate -> score -> pick. Owned by #56.
import type { Submission, SubmissionsFile } from '../intake/intake.ts';
import type { EventAi } from '../lib/ai.ts';
import { mapLimit } from '../lib/concurrency.ts';
import { clip } from '../lib/text.ts';
import { screenCredits } from './credit.ts';
import { stripInjection } from './injection.ts';
import { pickThemes } from './pick.ts';
import type { PickResult } from './pick.ts';
import { SelectionSchema } from './schemas.ts';
import type { Selection } from './schemas.ts';
import { scoreCandidates } from './score.ts';
import type { Scored } from './score.ts';
import { SCREEN_CONCURRENCY, screenSubmission } from './screen.ts';
import type { Candidate, RejectStatus, ScreenResult } from './screen.ts';
import { PICK_COUNT } from './variety.ts';

export type Status =
  | 'picked'
  | 'runnerUp'
  | 'notShortlisted'
  | 'unscored'
  | 'duplicatePrompt'
  | 'noPrompt'
  | 'duplicate'
  | 'invalid'
  | RejectStatus;

/** One input row in the report. */
export interface ReportEntry {
  row: number;
  submissionId: string | null;
  username: string;
  status: Status;
  reason: string;
  /** The prompt contained instructions to the judge. */
  injection: boolean;
  score: number | null;
}

export interface SelectionRun {
  /** null when fewer than 5 prompts survived; `error` says why. */
  selection: Selection | null;
  error: string | null;
  entries: ReportEntry[];
}

/** ThemeDef v2 limits `credit` to 24. */
const creditName = (sub: Submission) => clip(sub.username, 24);

export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
}

function buildSelection(
  result: PickResult,
  subs: Map<string, Submission>,
  credited: ReadonlySet<string>,
  seed: string,
): Selection {
  const slugs = new Set<string>();
  return SelectionSchema.parse({
    version: 1,
    seed,
    relaxed: result.relaxed,
    picks: result.picks.map(({ scored, reason }, i) => {
      const { candidate: c, total, passes, criteria, penalty } = scored;
      const base = slugify(c.titleIdea) || `theme-${i + 1}`;
      let slug = base;
      for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`;
      slugs.add(slug);
      const sub = subs.get(c.submissionId)!;
      return {
        rank: i + 1,
        submissionId: c.submissionId,
        slug,
        titleIdea: c.titleIdea || `Theme ${i + 1}`,
        themePrompt: c.themePrompt,
        rewritten: c.rewritten,
        summary: c.summary,
        settingTags: c.settingTags,
        moodTags: c.moodTags,
        paletteHint: c.paletteHint,
        scores: { total, passes, criteria, penalty },
        reason,
        credit: credited.has(sub.id) ? creditName(sub) : null,
      };
    }),
  });
}

/**
 * Identical prompts (after injection text is removed) compete once. The copy without an injection wins,
 * then the earliest row, so an injected copy can never take a clean submission's place.
 */
function representatives(survivors: Array<{ c: Candidate; flagged: boolean; text: string }>) {
  const sorted = survivors.slice().sort((a, b) => Number(a.flagged) - Number(b.flagged) || a.c.row - b.c.row);
  const first = new Map<string, Candidate>();
  const duplicates = new Map<string, Candidate>();
  for (const { c, text } of sorted) {
    const key = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    const original = first.get(key);
    if (original) duplicates.set(c.submissionId, original);
    else first.set(key, c);
  }
  return { unique: [...first.values()].sort((a, b) => a.row - b.row), duplicates };
}

export async function runSelection(ai: EventAi, intake: SubmissionsFile, seed: string): Promise<SelectionRun> {
  const subs = new Map(intake.submissions.map((s) => [s.id, s]));
  const screens = await mapLimit(intake.submissions, SCREEN_CONCURRENCY, async (s): Promise<ScreenResult | null> =>
    s.gamePrompt ? screenSubmission(ai, s) : null,
  );
  const survivors = screens.flatMap((r) => {
    if (!r?.ok) return [];
    const sub = subs.get(r.candidate.submissionId)!;
    return [{ c: r.candidate, flagged: r.flagged, text: stripInjection(sub.gamePrompt).clean }];
  });
  const { unique, duplicates } = representatives(survivors);
  const flagged = new Set(survivors.filter((s) => s.flagged).map((s) => s.c.submissionId));
  const { scored } = await scoreCandidates(ai, unique, flagged, seed);

  let selection: Selection | null = null;
  let picked: PickResult | null = null;
  let error: string | null = null;
  if (scored.length >= PICK_COUNT) {
    picked = await pickThemes(ai, scored, seed);
    const consented = picked.picks.flatMap(({ scored: { candidate } }) => {
      const sub = subs.get(candidate.submissionId)!;
      return sub.creditOk ? [{ id: sub.id, name: creditName(sub) }] : [];
    });
    selection = buildSelection(picked, subs, await screenCredits(ai, consented), seed);
  } else {
    error = `only ${scored.length} usable game prompts; need ${PICK_COUNT}`;
  }

  const byId = new Map<string, Scored>(scored.map((s) => [s.candidate.submissionId, s]));
  const entries = intake.submissions.map((sub, i): ReportEntry => {
    const screen = screens[i];
    const s = byId.get(sub.id);
    const injection = screen?.flagged ?? false;
    const entry = (status: Status, reason: string): ReportEntry => ({
      row: sub.row,
      submissionId: sub.id,
      username: sub.username,
      status,
      reason,
      injection,
      score: s?.total ?? null,
    });
    if (!screen) return entry('noPrompt', 'no game prompt (the character prompt is still used)');
    if (!screen.ok) return entry(screen.status, screen.reason);
    const original = duplicates.get(sub.id);
    if (original) return entry('duplicatePrompt', `same game prompt as row ${original.row}, which competes for both`);
    if (!s) return entry('unscored', 'the scoring model returned no score');
    const penalty = s.penalty ? ` Injection penalty -${s.penalty}.` : '';
    const rewrite = screen.candidate.rewritten ? ` (${screen.reason})` : '';
    const pick = picked?.picks.find((p) => p.scored === s);
    if (pick) return entry('picked', `${pick.reason}${rewrite}${penalty}`);
    if (picked?.shortlist.includes(sub.id)) {
      return entry('runnerUp', `shortlisted but not among the 5: ${s.reason}${rewrite}${penalty}`);
    }
    return entry('notShortlisted', `${s.reason}${rewrite}${penalty}`);
  });
  for (const d of intake.dropped) {
    entries.push({ ...d, submissionId: null, injection: false, score: null });
  }
  entries.sort((a, b) => a.row - b.row);
  return { selection, error, entries };
}
