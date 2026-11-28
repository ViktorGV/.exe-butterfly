// Theme vote state machine (#12): idle -> voting -> reveal.
import type { VoteResult, VoteState } from '@wobble/shared';

export type VotePhase = 'idle' | 'voting' | 'reveal';

export interface VoteModel {
  phase: VotePhase;
  options: string[];
  tallies: number[];
  endsAt: number;
  myChoice: string | null;
  winner: string | null;
}

export function createVoteModel(): VoteModel {
  return { phase: 'idle', options: [], tallies: [], endsAt: 0, myChoice: null, winner: null };
}

/** A `voteState` arrived. Ignored after the reveal (late frames). */
export function onVoteState(m: VoteModel, s: Pick<VoteState, 'options' | 'tallies' | 'endsAt'>): VoteModel {
  if (m.phase === 'reveal') return m;
  const myChoice = m.myChoice && s.options.includes(m.myChoice) ? m.myChoice : null;
  return { ...m, phase: 'voting', options: [...s.options], tallies: [...s.tallies], endsAt: s.endsAt, myChoice };
}

/** The local player picked (or changed to) a theme. Returns null when the pick is not allowed. */
export function choose(m: VoteModel, themeId: string): VoteModel | null {
  if (m.phase !== 'voting' || !m.options.includes(themeId)) return null;
  if (m.myChoice === themeId) return m;
  return { ...m, myChoice: themeId };
}

export function onVoteResult(m: VoteModel, r: Pick<VoteResult, 'themeId' | 'tallies'>): VoteModel {
  return { ...m, phase: 'reveal', tallies: [...r.tallies], winner: r.themeId };
}

/** Whole seconds left, never negative. */
export function secondsLeft(m: VoteModel, now: number): number {
  return m.phase === 'voting' ? Math.max(0, Math.ceil((m.endsAt - now) / 1000)) : 0;
}

/** The winner, else the theme in the lead (first option on ties), or null with no votes. */
export function leader(m: VoteModel): string | null {
  if (m.winner) return m.winner;
  let best = 0;
  let id: string | null = null;
  for (let i = 0; i < m.options.length; i++) {
    const t = m.tallies[i] ?? 0;
    if (t > best) {
      best = t;
      id = m.options[i]!;
    }
  }
  return id;
}

/** Share of the vote per option, 0..1. */
export function shares(m: VoteModel): number[] {
  let total = 0;
  for (const t of m.tallies) total += t;
  return m.tallies.map((t) => (total ? t / total : 0));
}
