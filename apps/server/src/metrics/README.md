# metrics

Owned by #73 (MP-12). `createMetrics()` keeps plain in-place counters over a 10 s window: bytes, snapshots sent and dropped, messages received, plus rooms/players gauges and tick avg/max from `setTickStats(() => tickLoop.stats())`.

`GET /healthz` returns `ok`, `protocol`, `uptimeSec` and every field of `MetricsSnapshot`.

Wiring left for the code that owns the data: the race/room code calls `snapshotSent(bytes)` / `snapshotDropped()` and sets rooms and players; the transport (#18) calls `messageReceived()` for binary frames. Overhead check: `bun apps/server/src/metrics/bench.ts`.
