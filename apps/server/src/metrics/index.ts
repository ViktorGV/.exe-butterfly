// Server metrics (#73, MP-12). Plain counters updated in place: nothing is allocated per message.
// Rates are averaged over the last WINDOW_S seconds using one bucket per second.

const WINDOW_S = 10;

export interface TickStatsSource {
  avgMs: number;
  maxMs: number;
}

export interface MetricsSnapshot {
  rooms: number;
  players: number;
  tickAvgMs: number;
  tickMaxMs: number;
  bytesPerSec: number;
  snapshotsPerSec: number;
  snapshotsDroppedPerSec: number;
  messagesPerSec: number;
}

export interface Metrics {
  setRooms(n: number): void;
  setPlayers(n: number): void;
  /** Source of avg/max tick time, e.g. `() => tickLoop.stats()`. Read only when a snapshot is taken. */
  setTickStats(source: () => Readonly<TickStatsSource>): void;
  /** One snapshot frame of `bytes` bytes was sent to one player. */
  snapshotSent(bytes: number): void;
  snapshotDropped(): void;
  messageReceived(): void;
  /** Builds a fresh object; call it from /healthz, not per message. */
  snapshot(): MetricsSnapshot;
}

const defaultClock = (): number => Bun.nanoseconds() / 1e6;

export function createMetrics({ clock = defaultClock }: { clock?: () => number } = {}): Metrics {
  const bytes = new Float64Array(WINDOW_S);
  const sent = new Float64Array(WINDOW_S);
  const dropped = new Float64Array(WINDOW_S);
  const messages = new Float64Array(WINDOW_S);
  const startMs = clock();

  let rooms = 0;
  let players = 0;
  let tickSource: (() => Readonly<TickStatsSource>) | null = null;
  let currentSec = 0;

  // Moves to the bucket for "now", zeroing buckets that were skipped. No allocation.
  function advance(): number {
    const sec = Math.floor((clock() - startMs) / 1000);
    if (sec > currentSec) {
      const steps = Math.min(sec - currentSec, WINDOW_S);
      for (let i = 1; i <= steps; i++) {
        const b = (currentSec + i) % WINDOW_S;
        bytes[b] = 0;
        sent[b] = 0;
        dropped[b] = 0;
        messages[b] = 0;
      }
      currentSec = sec;
    }
    return currentSec % WINDOW_S;
  }

  function sum(a: Float64Array): number {
    let total = 0;
    for (let i = 0; i < WINDOW_S; i++) total += a[i];
    return total;
  }

  return {
    setRooms: (n) => {
      rooms = n;
    },
    setPlayers: (n) => {
      players = n;
    },
    setTickStats: (source) => {
      tickSource = source;
    },
    snapshotSent(n) {
      const b = advance();
      bytes[b] += n;
      sent[b] += 1;
    },
    snapshotDropped() {
      dropped[advance()] += 1;
    },
    messageReceived() {
      messages[advance()] += 1;
    },
    snapshot() {
      advance();
      // Seconds covered by the window so far (the current second counts as a full one).
      const span = Math.min(WINDOW_S, currentSec + 1);
      const ticks = tickSource?.();
      return {
        rooms,
        players,
        tickAvgMs: ticks?.avgMs ?? 0,
        tickMaxMs: ticks?.maxMs ?? 0,
        bytesPerSec: sum(bytes) / span,
        snapshotsPerSec: sum(sent) / span,
        snapshotsDroppedPerSec: sum(dropped) / span,
        messagesPerSec: sum(messages) / span,
      };
    },
  };
}
