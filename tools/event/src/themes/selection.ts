// Reads tools/event/out/selection.json, written by #56 (SelectionSchema). The extra checks are about what
// theme generation does with a slug: it names a folder and the pack id e:theme-<slug>.
import { SelectionSchema } from '../select/schemas.ts';
import type { SelectionPick } from '../select/schemas.ts';

export type Pick = SelectionPick;

/** Pack ids allow 64 characters after "e:", and 6 of them are "theme-". */
const MAX_SLUG = 58;

export async function readSelection(file: string): Promise<Pick[]> {
  const source = Bun.file(file);
  if (!(await source.exists())) {
    throw new Error(`no selection file at ${file}. Run event:select first, or pass --selection <path>.`);
  }
  const { picks } = SelectionSchema.parse(await source.json());
  if (new Set(picks.map((p) => p.slug)).size !== picks.length) throw new Error('selection slugs must be unique');
  for (const { slug } of picks) {
    if (slug.length > MAX_SLUG) throw new Error(`selection slug "${slug}" is longer than ${MAX_SLUG} characters`);
    if (slug === 'fixture') throw new Error('selection slug "fixture" is reserved for the contract fixture');
  }
  return [...picks].sort((a, b) => a.rank - b.rank);
}
