// Overhead check for #73: `bun apps/server/src/metrics/bench.ts`.
// Simulates one tick with 120 players: 120 snapshotSent + 120 messageReceived + a few drops.
import { createMetrics } from './index.ts';

const PLAYERS = 120;
const TICKS = 20_000;
const m = createMetrics();
for (let t = 0; t < 2_000; t++) for (let p = 0; p < PLAYERS; p++) m.snapshotSent(180); // warm up

const t0 = Bun.nanoseconds();
for (let t = 0; t < TICKS; t++) {
  for (let p = 0; p < PLAYERS; p++) {
    m.snapshotSent(180);
    m.messageReceived();
  }
  m.snapshotDropped();
}
const msPerTick = (Bun.nanoseconds() - t0) / 1e6 / TICKS;
console.log(`metrics overhead: ${msPerTick.toFixed(4)} ms per tick with ${PLAYERS} players (limit 0.1 ms)`);
if (msPerTick >= 0.1) process.exit(1);
