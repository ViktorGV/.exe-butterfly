// The themes players vote among in the waiting room (#27): the three maps of the demo. The wire format carries
// exactly VOTE.options ids, so the list is padded by repeating it; clients show each theme once, and the server
// counts a vote on the first copy, so the repeats never win.
import { VOTE } from '../constants.ts';
import { DEFAULT_THEME_ID } from './builtin/index.ts';

/** The chalga concert theme being added for the demo. Its pack is served at /event/packs/theme/theme-chalga-concert.json. */
export const CHALGA_THEME_ID = 'e:theme-chalga-concert';

/** The maps on the ballot, in card order. */
export const BALLOT_THEME_IDS: readonly string[] = Object.freeze([
  DEFAULT_THEME_ID,
  'e:theme-fallen-galaxy',
  CHALGA_THEME_ID,
]);

function padToVote(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < VOTE.options; i++) out.push(ids[i % ids.length]!);
  return out;
}

export const VOTE_THEME_IDS: readonly string[] = Object.freeze(padToVote(BALLOT_THEME_IDS));
