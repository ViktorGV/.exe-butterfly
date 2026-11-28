// The themes players vote among in the lobby (#27). Replace this list with the team's 5 preselected theme ids.
// It must hold exactly VOTE.options ids; the built-ins below are placeholders (repeated if fewer than 5 exist).
import { VOTE } from '../constants.ts';
import { BUILTIN_THEME_PACKS } from './builtin/index.ts';

function padToVote(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < VOTE.options; i++) out.push(ids[i % ids.length]!);
  return out;
}

export const VOTE_THEME_IDS: readonly string[] = Object.freeze(padToVote(BUILTIN_THEME_PACKS.map((p) => p.id)));
