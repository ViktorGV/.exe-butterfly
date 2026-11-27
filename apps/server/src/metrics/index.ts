// Per-process server metrics for /healthz (#73). Plain numbers updated in place: recording
// allocates nothing. Rates and tick times cover a sliding window of the last 10 whole seconds.

export const WINDOW_S = 10;

export interface MetricsSnapshot {
  /** bytes written to clients per second */
  bytesPerSec: number;
  /** snapshots dropped for backpressure per second */
  snapshotsDroppedPerSec: number;
  /** client messages received per second */
  messagesPerSec: number;
  /** mean and max room-tick duration in ms */
  tickAvgMs: number;
  tickMaxMs: number;
}

export interface ServerMetrics {
  /** `n` bytes went to one or more clients */
  sent(bytes: number): void;
  /** a snapshot was dropped because the client's socket was backed up */
  dropped(): void;
  /** one client message (text or binary) arrived */
  received(): void;
  /** one room tick took `ms` */
  tick(ms: number): void;
  /** Returns the same object on every call; copy it to keep it. */
  snapshot(): Readonly<MetricsSnapshot>;
}

export function createMetrics(clock: () => number = Date.now): ServerMetrics {
  const bytes = new Float64Array(WINDOW_S);
  const drops = new Float64Array(WINDOW_S);
  const msgs = new Float64Array(WINDOW_S);
  const tickSum = new Float64Array(WINDOW_S);
  const tickCount = new Float64Array(WINDOW_S);
  const tickMax = new Float64Array(WINDOW_S);
  const startedAt = clock();
  const out: MetricsSnapshot = {
    bytesPerSec: 0,
    snapshotsDroppedPerSec: 0,
    messagesPerSec: 0,
    tickAvgMs: 0,
    tickMaxMs: 0,
  };
  let second = Math.floor(startedAt / 1000);

  /** Moves the window to the current second, clearing the buckets it skips over. */
  function advance(): number {
    const now = Math.floor(clock() / 1000);
    if (now !== second) {
      const steps = Math.min(WINDOW_S, now - second);
      for (let i = 1; i <= steps; i++) {
        const b = (second + i) % WINDOW_S;
        bytes[b] = drops[b] = msgs[b] = tickSum[b] = tickCount[b] = tickMax[b] = 0;
      }
      second = now;
    }
    return second % WINDOW_S;
  }

  return {
    sent(n) {
      bytes[advance()] += n;
    },
    dropped() {
      drops[advance()] += 1;
    },
    received() {
      msgs[advance()] += 1;
    },
    tick(ms) {
      const b = advance();
      tickSum[b] += ms;
      tickCount[b] += 1;
      if (ms > tickMax[b]) tickMax[b] = ms;
    },
    snapshot() {
      advance();
      // before the window fills, divide by the time actually elapsed
      const span = Math.max(1, Math.min(WINDOW_S, (clock() - startedAt) / 1000));
      let b = 0;
      let d = 0;
      let m = 0;
      let ts = 0;
      let tc = 0;
      let tm = 0;
      for (let i = 0; i < WINDOW_S; i++) {
        b += bytes[i];
        d += drops[i];
        m += msgs[i];
        ts += tickSum[i];
        tc += tickCount[i];
        if (tickMax[i] > tm) tm = tickMax[i];
      }
      out.bytesPerSec = b / span;
      out.snapshotsDroppedPerSec = d / span;
      out.messagesPerSec = m / span;
      out.tickAvgMs = tc > 0 ? ts / tc : 0;
      out.tickMaxMs = tm;
      return out;
    },
  };
}
