// Waiting-room map ballot (#27): one picture card per map, like the theme picker on the title screen. Everyone
// taps a card to vote (and may change it); each card shows its votes and the leader wears a crown. The host's
// Play races the leader. The DOM is built once and updated in place, so a tap is never lost to a re-render.
import { BALLOT_THEME_IDS } from '@wobble/shared/assets/index';
import { h } from '../ui/dom.ts';
import { THEME_CHOICES, type ThemeChoice } from './themes.ts';

export interface BallotCard extends ThemeChoice {
  /** Shown on the picture when there is no card image. */
  glyph: string;
}

/** Card details for a ballot theme id: the same title, tagline and picture as the title-screen theme picker. */
export function ballotCard(id: string): BallotCard {
  const base: ThemeChoice = THEME_CHOICES.find((c) => c.id === id) ?? {
    id,
    title: id,
    tagline: '',
    card: null,
    color: '#888',
  };
  return { ...base, glyph: base.card ? '' : '🍬' };
}

export interface BallotState {
  /** Wire options (padded with repeats to VOTE.options). */
  options: readonly string[];
  tallies: readonly number[];
}

/** Each theme once, in ballot order, with its votes (repeats in the wire list never get votes). */
export function ballotRows(state: BallotState): { id: string; votes: number }[] {
  const out: { id: string; votes: number }[] = [];
  state.options.forEach((id, i) => {
    const row = out.find((r) => r.id === id);
    if (row) row.votes += state.tallies[i] ?? 0;
    else out.push({ id, votes: state.tallies[i] ?? 0 });
  });
  return out;
}

/** The theme Play would race: most votes, first card on ties (as the server decides). */
export function ballotLeader(state: BallotState): string | null {
  const rows = ballotRows(state);
  if (rows.length === 0) return null;
  let best = rows[0]!;
  for (const r of rows) if (r.votes > best.votes) best = r;
  return best.id;
}

export interface Ballot {
  readonly el: HTMLElement;
  update(state: BallotState, myVote: string): void;
}

export function createBallot(doc: Document, onVote: (id: string) => void): Ballot {
  const grid = h(doc, 'div', { class: 'wr-ballot', role: 'group', 'aria-label': 'Vote for the map' });
  const cards = new Map<string, { el: HTMLButtonElement; count: Text; label: string }>();

  function card(id: string) {
    const c = ballotCard(id);
    const count = doc.createTextNode('0 votes');
    const el = h(
      doc,
      'button',
      { type: 'button', class: 'wr-ballot-card', 'aria-pressed': 'false' },
      h(doc, 'span', { class: 'wr-ballot-pic', 'aria-hidden': 'true' }, c.glyph),
      h(doc, 'span', { class: 'wr-ballot-crown', 'aria-hidden': 'true' }, '👑'),
      h(doc, 'span', { class: 'wr-ballot-name' }, c.title),
      h(doc, 'span', { class: 'wr-ballot-tag' }, c.tagline),
      h(doc, 'span', { class: 'wr-ballot-votes' }, count),
      h(doc, 'span', { class: 'wr-ballot-mine' }, 'Your vote'),
    ) as HTMLButtonElement;
    el.style.setProperty('--card-color', c.color);
    if (c.card) el.style.setProperty('--card-image', `url("${c.card}")`);
    el.addEventListener('click', () => onVote(id));
    const entry = { el, count, label: c.title };
    cards.set(id, entry);
    grid.appendChild(el);
    return entry;
  }
  for (const id of BALLOT_THEME_IDS) card(id);

  return {
    el: grid,
    update(state, myVote) {
      const rows = ballotRows(state);
      const leader = rows.some((r) => r.votes > 0) ? ballotLeader(state) : null;
      for (const r of rows) {
        const c = cards.get(r.id) ?? card(r.id);
        const n = `${r.votes} vote${r.votes === 1 ? '' : 's'}`;
        if (c.count.nodeValue !== n) c.count.nodeValue = n;
        c.el.setAttribute('aria-pressed', String(myVote === r.id));
        c.el.classList.toggle('is-leader', leader === r.id);
        c.el.setAttribute('aria-label', `${c.label}: ${r.votes} vote${r.votes === 1 ? '' : 's'}`);
      }
    },
  };
}
