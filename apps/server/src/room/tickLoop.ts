// Fixed-rate server tick loop (#61, MP-4).
// Each tick is scheduled against an absolute target time (start + index * interval),
// so timer lateness never accumulates into drift. If the loop falls more than
// `maxBehindTicks` behind, it skips ahead instead of firing a burst of catch-up ticks.

export interface TickLoopOptions {
  /** Ticks per second. */
  hz: number;
  /** Called once per tick. `tick` is the schedule index (it jumps forward over skipped ticks). */
  onTick: (nowMs: number, tick: number) => void;
  /** How many ticks the loop may fall behind before it skips ahead. Default 3. */
  maxBehindTicks?: number;
  /** Monotonic clock in milliseconds. Defaults to `Bun.nanoseconds() / 1e6`. */
  clock?: () => number;
}

export interface TickLoopStats {
  /** Ticks fired since creation. */
  ticks: number;
  /** Ticks skipped because the loop fell too far behind. */
  skipped: number;
  /** Mean `onTick` duration over roughly the last 10 s, in ms. */
  avgMs: number;
  /** Max `onTick` duration over roughly the last 10 s, in ms. */
  maxMs: number;
}

export interface TickLoop {
  start(): void;
  stop(): void;
  readonly running: boolean;
  /** Returns the same object on every call; copy it if you need to keep a snapshot. */
  stats(): Readonly<TickLoopStats>;
}

const STATS_WINDOW_S = 10;
/** A timer that wakes up this close to its target fires instead of sleeping again. */
const EARLY_WAKE_TOLERANCE_MS = 1;

const defaultClock = (): number => Bun.nanoseconds() / 1e6;

export function createTickLoop({ hz, onTick, maxBehindTicks = 3, clock = defaultClock }: TickLoopOptions): TickLoop {
  if (!Number.isFinite(hz) || hz <= 0) throw new RangeError(`hz must be a positive number, got ${hz}`);
  if (!Number.isFinite(maxBehindTicks) || maxBehindTicks < 0) {
    throw new RangeError(`maxBehindTicks must be >= 0, got ${maxBehindTicks}`);
  }

  const intervalMs = 1000 / hz;
  const durations = new Float64Array(Math.max(1, Math.ceil(hz * STATS_WINDOW_S)));
  const out: TickLoopStats = { ticks: 0, skipped: 0, avgMs: 0, maxMs: 0 };

  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startMs = 0;
  let index = 0;
  let ticks = 0;
  let skipped = 0;
  let ringPos = 0;
  let ringCount = 0;

  function schedule(): void {
    const delay = startMs + index * intervalMs - clock();
    timer = setTimeout(run, delay > 0 ? delay : 0);
  }

  function run(): void {
    timer = undefined;
    if (!running) return;

    let now = clock();
    const target = startMs + index * intervalMs;
    if (now < target - EARLY_WAKE_TOLERANCE_MS) {
      schedule();
      return;
    }

    const behind = Math.floor((now - target) / intervalMs);
    if (behind > maxBehindTicks) {
      // Skip ahead and re-phase the schedule on `now`, so the next tick is a full interval away.
      index += behind;
      skipped += behind;
      startMs = now - index * intervalMs;
    }

    const t0 = clock();
    try {
      onTick(now, index);
    } finally {
      now = clock();
      durations[ringPos] = now - t0;
      ringPos = ringPos + 1 === durations.length ? 0 : ringPos + 1;
      if (ringCount < durations.length) ringCount++;
      ticks++;
      index++;
      if (running) schedule();
    }
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      startMs = clock();
      index = 0;
      schedule();
    },
    stop(): void {
      running = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    get running(): boolean {
      return running;
    },
    stats(): Readonly<TickLoopStats> {
      let sum = 0;
      let max = 0;
      for (let i = 0; i < ringCount; i++) {
        const d = durations[i] as number;
        sum += d;
        if (d > max) max = d;
      }
      out.ticks = ticks;
      out.skipped = skipped;
      out.avgMs = ringCount > 0 ? sum / ringCount : 0;
      out.maxMs = max;
      return out;
    },
  };
}
