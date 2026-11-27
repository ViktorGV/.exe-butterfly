// Overhead of one tick's worth of metrics calls with 120 players: bun apps/server/src/metrics/bench.ts
import { createMetrics } from './index.ts';

const m = createMetrics();
const PLAYERS = 120;
const TICKS = 20_000;
const t0 = performance.now();
for (let t = 0; t < TICKS; t++) {
  m.tick(0.5);
  for (let p = 0; p < PLAYERS; p++) {
    m.received();
    m.sent(1210);
  }
  m.dropped();
}
const perTickMs = (performance.now() - t0) / TICKS;
console.log(`metrics overhead per tick with ${PLAYERS} players: ${perTickMs.toFixed(4)} ms`);
