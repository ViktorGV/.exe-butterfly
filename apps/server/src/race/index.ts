// SEAM. Seeded by #2 with a fake race session; replaced by #19 (validation, checkpoints, snapshots).
// The room code (#18) creates sessions only through this factory.
import type { RaceResult, RaceSession, RaceSessionOptions } from '@wobble/shared/types';

export const FAKE_RACE_DURATION_MS = 10_000;

/**
 * FAKE: accepts any state, never sends snapshots, and ends the race 10 s after start
 * with every player unfinished, ranked by slot.
 */
export function createRaceSession({ players, onEvent }: RaceSessionOptions): RaceSession {
  let startAt = Infinity;
  let finished = false;
  /** latest checkpoint per player */
  const checkpoints = new Map<number, number>(players.map((p) => [p.id, -1]));

  const results = (): RaceResult[] =>
    [...players]
      .sort((a, b) => a.slot - b.slot)
      .map((p, i) => ({ id: p.id, place: i + 1, timeMs: null, checkpoint: checkpoints.get(p.id) ?? -1 }));

  return {
    start(startAtMs) {
      startAt = startAtMs;
    },
    handleState(playerId, state) {
      if (checkpoints.has(playerId) && typeof state?.checkpoint === 'number')
        checkpoints.set(playerId, state.checkpoint);
    },
    setConnected() {},
    tick(nowMs) {
      if (finished || nowMs < startAt + FAKE_RACE_DURATION_MS) return;
      finished = true;
      onEvent({ type: 'raceEnd', results: results() });
    },
    get finished() {
      return finished;
    },
    results,
  };
}
