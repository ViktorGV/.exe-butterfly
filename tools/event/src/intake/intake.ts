// Intake: raw form export -> tools/event/out/submissions.json. Owned by #56; #63 reads the output.
import { normalizeUsername } from '@wobble/shared';
import { z } from 'zod';
import { sha256Hex } from '../lib/hash.ts';
import { clip } from '../lib/text.ts';
import type { ColumnConfig } from './columns.ts';
import { resolveColumns } from './columns.ts';
import { csvRecords } from './csv.ts';

export const GAME_PROMPT_MAX = 500;
export const CHARACTER_PROMPT_MAX = 300;

export const SubmissionSchema = z.object({
  /** Stable id: "sub-" + 10 hex of sha256(usernameKey). */
  id: z.string(),
  /** 1-based data row in the source file (header excluded). */
  row: z.number().int(),
  /** As typed (trimmed). Display only; match players with `usernameKey`. */
  username: z.string(),
  /** normalizeUsername(username) from #54. */
  usernameKey: z.string().min(1),
  gamePrompt: z.string(),
  characterPrompt: z.string(),
  /** Did they agree to be credited? null when the form had no answer. */
  creditOk: z.boolean().nullable(),
  submittedAt: z.string().nullable(),
  /** e.g. "gamePromptTruncated", "characterPromptTruncated". */
  flags: z.array(z.string()),
});
export type Submission = z.infer<typeof SubmissionSchema>;

export const DroppedRowSchema = z.object({
  row: z.number().int(),
  username: z.string(),
  status: z.enum(['invalid', 'duplicate']),
  reason: z.string(),
});
export type DroppedRow = z.infer<typeof DroppedRowSchema>;

export const SubmissionsFileSchema = z.object({
  version: z.literal(1),
  submissions: z.array(SubmissionSchema),
  /** Rows that are not in `submissions`, with why. */
  dropped: z.array(DroppedRowSchema),
});
export type SubmissionsFile = z.infer<typeof SubmissionsFileSchema>;

const clean = (s: string) =>
  s
    .normalize('NFKC')
    // Control, zero-width and bidi characters. Tabs, newlines and emoji joiners (U+200C/D) stay.
    .replace(/(?![\t\n])\p{Cc}|[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

function cut(s: string, max: number): [string, boolean] {
  return s.length > max ? [clip(s, max), true] : [s, false];
}

/** yes/no/true/false/y/n/1/0 (any case) -> boolean; anything else -> null. */
export function parseYesNo(value: string | undefined): boolean | null {
  const v = (value ?? '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'ja', 'ok'].includes(v)) return true;
  if (['no', 'n', 'false', '0', 'nee'].includes(v)) return false;
  return null;
}

const timeOf = (s: Submission) => (s.submittedAt ? Date.parse(s.submittedAt) : Number.NaN);

/**
 * Parse, clean and de-duplicate submissions. A username that appears more than once keeps its latest
 * row (by `submitted_at` when every copy has a parseable one, else the last row) and lists the others as dropped.
 */
export function intakeCsv(text: string, columns: ColumnConfig = {}): SubmissionsFile {
  const { headers, records } = csvRecords(text);
  const col = resolveColumns(headers, columns);
  const get = (rec: Record<string, string>, field: keyof typeof col) => {
    const header = col[field];
    return header === undefined ? '' : (rec[header] ?? '');
  };
  const dropped: DroppedRow[] = [];
  const byKey = new Map<string, Submission[]>();

  records.forEach((rec, i) => {
    const row = i + 1;
    const username = clean(get(rec, 'username'));
    const usernameKey = normalizeUsername(username);
    const [gamePrompt, gameCut] = cut(clean(get(rec, 'game_prompt')), GAME_PROMPT_MAX);
    const [characterPrompt, charCut] = cut(clean(get(rec, 'character_prompt')), CHARACTER_PROMPT_MAX);
    if (!usernameKey) return dropped.push({ row, username, status: 'invalid', reason: 'empty username' });
    if (!gamePrompt && !characterPrompt) {
      return dropped.push({ row, username, status: 'invalid', reason: 'no game or character prompt' });
    }
    const flags: string[] = [];
    if (gameCut) flags.push('gamePromptTruncated');
    if (charCut) flags.push('characterPromptTruncated');
    const submittedAt = clean(get(rec, 'submitted_at')) || null;
    const sub: Submission = {
      id: `sub-${sha256Hex(usernameKey).slice(0, 10)}`,
      row,
      username,
      usernameKey,
      gamePrompt,
      characterPrompt,
      creditOk: parseYesNo(get(rec, 'credit_ok')),
      submittedAt,
      flags,
    };
    const list = byKey.get(usernameKey) ?? [];
    list.push(sub);
    byKey.set(usernameKey, list);
  });

  const submissions: Submission[] = [];
  for (const list of byKey.values()) {
    const byTime = list.every((s) => !Number.isNaN(timeOf(s)));
    const sorted = list.slice().sort((a, b) => (byTime ? timeOf(a) - timeOf(b) || a.row - b.row : a.row - b.row));
    const kept = sorted[sorted.length - 1];
    submissions.push(kept);
    for (const old of sorted.slice(0, -1)) {
      dropped.push({
        row: old.row,
        username: old.username,
        status: 'duplicate',
        reason: `duplicate username "${kept.usernameKey}": kept the later row ${kept.row}`,
      });
    }
  }
  submissions.sort((a, b) => a.row - b.row);
  dropped.sort((a, b) => a.row - b.row);
  return { version: 1, submissions, dropped };
}
