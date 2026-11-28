// The maps (themes) players vote among in the waiting room: today Classic and Fallen Galaxy. A third is coming:
// add its id here and bump VOTE.lobbyOptions in constants.ts (a contract-change PR). Must hold exactly VOTE.lobbyOptions ids.
import { DEFAULT_THEME_ID } from './builtin/index.ts';

export const VOTE_THEME_IDS: readonly string[] = Object.freeze([DEFAULT_THEME_ID, 'e:theme-fallen-galaxy']);
