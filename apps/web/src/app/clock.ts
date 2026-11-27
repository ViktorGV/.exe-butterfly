// Offline race clock (#26): countdown, then race time from GO. Advanced only by the fixed step,
// so pausing simply stops calling advance(). Race time is negative during the countdown, which
// is what obstacles and the contract expect.

export const COUNTDOWN_SEC = 3;

export interface RaceClock {
  /** Race time in seconds: -COUNTDOWN_SEC at the start of the countdown, 0 at GO. */
  readonly t: number;
  /** Whole seconds left in the countdown (3, 2, 1), or 0 once the race is running. */
  readonly countdown: number;
  readonly started: boolean;
  /** Elapsed race time in ms when the race was finished, else null. */
  readonly finishMs: number | null;
  advance(dt: number): { wentGo: boolean };
  finish(): number;
  reset(): void;
}

export function createRaceClock(countdownSec = COUNTDOWN_SEC): RaceClock {
  let t = -countdownSec;
  let finishMs: number | null = null;
  return {
    get t() {
      return t;
    },
    get countdown() {
      return t < 0 ? Math.ceil(-t - 1e-9) : 0;
    },
    get started() {
      return t >= 0;
    },
    get finishMs() {
      return finishMs;
    },
    advance(dt) {
      if (finishMs !== null) return { wentGo: false };
      const before = t;
      t += dt;
      if (Math.abs(t) < 1e-6) t = 0; // absorb float drift so GO lands exactly on the step
      return { wentGo: before < 0 && t >= 0 };
    },
    finish() {
      finishMs ??= Math.round(Math.max(0, t) * 1000);
      return finishMs;
    },
    reset() {
      t = -countdownSec;
      finishMs = null;
    },
  };
}

/** Personal bests per course, kept in localStorage when it is available. */
export interface BestTimes {
  get(courseId: string): number | null;
  /** Record a time; returns true if it is a new best. */
  submit(courseId: string, ms: number): boolean;
}

export function createBestTimes(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  prefix = 'wobble.best.',
): BestTimes {
  const mem = new Map<string, number>();
  const read = (id: string) => {
    if (mem.has(id)) return mem.get(id)!;
    try {
      const v = storage?.getItem(prefix + id);
      const n = v === null || v === undefined ? NaN : Number(v);
      if (Number.isFinite(n) && n > 0) {
        mem.set(id, n);
        return n;
      }
    } catch {
      // storage blocked (private mode): fall back to memory
    }
    return null;
  };
  return {
    get: read,
    submit(id, ms) {
      const best = read(id);
      if (best !== null && best <= ms) return false;
      mem.set(id, ms);
      try {
        storage?.setItem(prefix + id, String(ms));
      } catch {
        // ignore
      }
      return true;
    },
  };
}
