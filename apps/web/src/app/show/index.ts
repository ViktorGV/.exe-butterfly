// Elimination show (#35), client side: tracks the round from the existing messages. A theme vote starts a show;
// every matchConfig without a lobby in between is the next round; a matchConfig with one qualifier is the final.
import type { MatchConfig, RaceResult } from '@wobble/shared/types';

export type RoundOutcome = 'qualified' | 'eliminated' | 'winner' | null;

export interface ShowTracker {
  /** 1-based round of the running show, 0 when this is a single race. */
  readonly round: number;
  readonly final: boolean;
  /** A theme vote ended: the next matchConfig is round 1. */
  onVoteResult(): void;
  onMatchConfig(cfg: MatchConfig): void;
  /** What the round meant for `me`; null outside a show. */
  onRaceEnd(results: readonly RaceResult[], me: number): RoundOutcome;
  /** The room went back to its lobby: the show is over. */
  reset(): void;
  /** Loading-screen label for the round, or null outside a show. */
  label(): string | null;
}

export function createShowTracker(): ShowTracker {
  let armed = false;
  let round = 0;
  let final = false;
  let qualifyCount = 0;
  return {
    get round() {
      return round;
    },
    get final() {
      return final;
    },
    onVoteResult() {
      armed = true;
      round = 0;
    },
    onMatchConfig(cfg) {
      if (!armed) return;
      round++;
      qualifyCount = cfg.qualifyCount;
      final = cfg.qualifyCount === 1 || cfg.players.length <= 2;
    },
    onRaceEnd(results, me) {
      if (round === 0) return null;
      const mine = results.find((r) => r.id === me);
      if (!mine) return null;
      if (mine.place > qualifyCount) return 'eliminated';
      return final ? 'winner' : 'qualified';
    },
    reset() {
      armed = false;
      round = 0;
      final = false;
      qualifyCount = 0;
    },
    label() {
      if (round === 0) return null;
      return final ? `Final round: first to finish wins!` : `Round ${round}: top ${qualifyCount} qualify`;
    },
  };
}

export function outcomeLine(o: RoundOutcome, round: number): string | null {
  if (o === 'winner') return 'You won the show!';
  if (o === 'qualified') return `Qualified for round ${round + 1}!`;
  if (o === 'eliminated') return `Eliminated in round ${round}. Stay and watch the rest of the show.`;
  return null;
}
