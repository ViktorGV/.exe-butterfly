// Map form headers to submission fields. Owned by #56.
import { z } from 'zod';

export const FIELDS = ['username', 'game_prompt', 'character_prompt', 'credit_ok', 'submitted_at'] as const;
export type Field = (typeof FIELDS)[number];
const REQUIRED: readonly Field[] = ['username', 'game_prompt', 'character_prompt'];

/** A column config file: field -> the exact header text in your form export. Any field may be left out. */
export const ColumnConfigSchema = z.partialRecord(z.enum(FIELDS), z.string().min(1));
export type ColumnConfig = z.infer<typeof ColumnConfigSchema>;

/** Header spellings tried when no config names the column (compared after lower-casing and stripping punctuation). */
export const DEFAULT_ALIASES: Readonly<Record<Field, readonly string[]>> = {
  username: ['username', 'user name', 'your username', 'handle', 'nickname', 'name'],
  game_prompt: ['game prompt', 'describe your game', 'game idea', 'game'],
  character_prompt: ['character prompt', 'describe your character', 'character idea', 'character'],
  credit_ok: ['credit ok', 'may we credit you', 'credit me', 'credit'],
  submitted_at: ['submitted at', 'timestamp', 'submitted', 'time'],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Resolve field -> header. Order: the config's exact header, an exact alias match, then a header
 * that starts with an alias ("Describe your game (max 500 characters)"). Throws if a required field has no column.
 */
export function resolveColumns(headers: readonly string[], config: ColumnConfig = {}): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  const taken = new Set<string>();
  const claim = (field: Field, header: string | undefined) => {
    if (header === undefined || taken.has(header)) return false;
    out[field] = header;
    taken.add(header);
    return true;
  };
  for (const field of FIELDS) {
    const wanted = config[field];
    if (wanted === undefined) continue;
    if (!headers.includes(wanted)) throw new Error(`column config: no header "${wanted}" for ${field}`);
    claim(field, wanted);
  }
  for (const pass of ['exact', 'prefix'] as const) {
    for (const field of FIELDS) {
      if (out[field]) continue;
      for (const alias of DEFAULT_ALIASES[field]) {
        const a = norm(alias);
        if (pass === 'prefix' && a.length < 5) continue; // "name", "game" only match exactly
        const hit = headers.find(
          (h) => !taken.has(h) && (pass === 'exact' ? norm(h) === a : norm(h).startsWith(`${a} `)),
        );
        if (claim(field, hit)) break;
      }
    }
  }
  const missing = REQUIRED.filter((f) => !out[f]);
  if (missing.length) throw new Error(`no column for ${missing.join(', ')} (headers: ${headers.join(' | ')})`);
  return out;
}
