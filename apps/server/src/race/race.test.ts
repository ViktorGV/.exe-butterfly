import { describe, expect, it, mock } from 'bun:test';
import { fixtureCourse } from '@wobble/shared/fixtures/index';
import { createRaceSession, FAKE_RACE_DURATION_MS } from './index.ts';

describe('createRaceSession seam (fake seeded by #2)', () => {
  it('ends the race after the fake duration', () => {
    const onEvent = mock(() => {});
    const session = createRaceSession({
      course: fixtureCourse,
      players: [
        { id: 7, slot: 1 },
        { id: 3, slot: 0 },
      ],
      config: { qualifyCount: 1, timeLimitMs: 60_000 },
      send: () => {},
      onEvent,
    });
    session.start(1000);
    session.handleState(7, {
      seq: 1,
      raceTimeMs: 500,
      pos: [0, 0, -36],
      vel: [0, 0, 0],
      yaw: 0,
      anim: 1,
      grounded: true,
      checkpoint: 0,
      finished: false,
    });
    session.tick(1000 + FAKE_RACE_DURATION_MS - 1);
    expect(session.finished).toBe(false);
    session.tick(1000 + FAKE_RACE_DURATION_MS);
    expect(session.finished).toBe(true);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(session.results()).toEqual([
      { id: 3, place: 1, timeMs: null, checkpoint: -1 },
      { id: 7, place: 2, timeMs: null, checkpoint: 0 },
    ]);
  });
});
