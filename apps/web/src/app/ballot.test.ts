import { describe, expect, it } from 'bun:test';
import { BALLOT_THEME_IDS, CHALGA_THEME_ID, VOTE_THEME_IDS } from '@wobble/shared/assets/index';
import { VOTE } from '@wobble/shared/constants';
import { PackSchema, ThemeDefV2Schema } from '@wobble/shared/schemas/index';
import { ballotCard, ballotLeader, ballotRows } from './ballot.ts';

const [classic, galaxy, chalga] = BALLOT_THEME_IDS as [string, string, string];
const tallies = (...t: number[]) => [...t, ...new Array(VOTE.options - t.length).fill(0)];

describe('waiting-room ballot', () => {
  it('offers Classic, Fallen Galaxy and the chalga concert, padded to the wire length', () => {
    expect(BALLOT_THEME_IDS).toEqual([classic, 'e:theme-fallen-galaxy', CHALGA_THEME_ID]);
    expect(VOTE_THEME_IDS).toHaveLength(VOTE.options);
  });

  it('shows each map once, in ballot order, with its votes', () => {
    const rows = ballotRows({ options: VOTE_THEME_IDS, tallies: tallies(1, 0, 3) });
    expect(rows).toEqual([
      { id: classic, votes: 1 },
      { id: galaxy, votes: 0 },
      { id: chalga, votes: 3 },
    ]);
  });

  it('the leader is the most-voted map, the first card on ties (as the server decides)', () => {
    expect(ballotLeader({ options: VOTE_THEME_IDS, tallies: tallies(0, 2, 1) })).toBe(galaxy);
    expect(ballotLeader({ options: VOTE_THEME_IDS, tallies: tallies(0, 2, 2) })).toBe(galaxy);
    expect(ballotLeader({ options: VOTE_THEME_IDS, tallies: tallies() })).toBe(classic);
  });

  it('every map has a card with a title', () => {
    for (const id of BALLOT_THEME_IDS) expect(ballotCard(id).title).not.toBe(id);
    expect(ballotCard(chalga).title).toBe('Chalga Night');
    expect(ballotCard(chalga).card).not.toBeNull(); // its picture, as on the title screen
  });

  // The asset store falls back to Classic for a missing or invalid pack, so a bad file means that map never shows.
  it('every event map on the ballot ships a pack the asset store accepts', async () => {
    for (const id of BALLOT_THEME_IDS.filter((x) => x.startsWith('e:'))) {
      const url = new URL(`../../public/event/packs/theme/${id.slice(2)}.json`, import.meta.url);
      const raw = (await Bun.file(url).json()) as { id: string; data: unknown };
      expect(PackSchema.safeParse(raw).success).toBe(true);
      expect(raw.id).toBe(id);
      expect(ThemeDefV2Schema.strict().safeParse(raw.data).success).toBe(true);
    }
  });
});
