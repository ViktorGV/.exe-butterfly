// A made-up 100-row submission sample for mock runs and tests (#63). No real people's usernames.
import type { CharacterSubmission } from './pregen.ts';

const COLORS = ['pink', 'blue', 'green', 'purple', 'orange', 'yellow', 'teal', 'red', 'silver', 'gold'];
const MOTIFS = [
  'crown',
  'bow',
  'cape',
  'horns',
  'wings',
  'hat',
  'glasses',
  'tail',
  'scarf',
  'helmet',
  'spikes',
  'ears',
];
const KINDS = ['princess', 'robot', 'dragon', 'cat', 'wizard', 'knight', 'fox', 'alien', 'bunny', 'pirate'];

/** Prompts with a known expected status, mixed into the sample. */
export const SPECIAL_PROMPTS = Object.freeze({
  tooVague: ['a cool guy', 'something fun', 'idk make it awesome', 'my favourite', 'surprise me please'],
  unsafe: ['a bloody zombie with gore everywhere', 'a nazi soldier', 'a naked dancer', 'a cocaine dealer'],
  empty: ['', '   ', '??'],
  ip: ['Pikachu but pink with a bow', 'Batman in green with a crown', 'Taylor Swift with purple wings'],
});

export const SAMPLE_PRINCESS = 'A pink bubble-gum princess with a tiny crown';

export function sampleSubmissions(n = 100): CharacterSubmission[] {
  const special = [
    ...SPECIAL_PROMPTS.tooVague,
    ...SPECIAL_PROMPTS.unsafe,
    ...SPECIAL_PROMPTS.empty,
    ...SPECIAL_PROMPTS.ip,
    SAMPLE_PRINCESS,
  ];
  const rows: CharacterSubmission[] = [];
  for (let i = 0; i < n; i++) {
    const characterPrompt =
      i < special.length
        ? special[i]!
        : `a ${COLORS[i % COLORS.length]} ${KINDS[(i * 7) % KINDS.length]} with a ${MOTIFS[(i * 5) % MOTIFS.length]}` +
          (i % 3 === 0 ? ` and ${COLORS[(i * 3 + 1) % COLORS.length]} stripes` : '');
    rows.push({ username: `Racer_${String(i).padStart(3, '0')}`, characterPrompt });
  }
  return rows;
}
