// Race bench (#19): `bun apps/server/src/race/bench.ts` — 300 honest bots, tick p99 and bytes per recipient.
import { SNAPSHOT_HZ } from '@wobble/shared/constants';
import { createHarness } from './harness.ts';

const N = 300;
const h = createHarness({ count: N, seed: 42, timeLimitMs: 600_000 });
// warm up through the countdown
while (h.now < h.startAt + 500) h.step();
const samples: number[] = [];
const bytes0 = h.snapshotBytes;
const heap0 = process.memoryUsage().heapUsed;
const TICKS = 150;
for (let k = 0; k < TICKS && !h.session.finished; k++) {
  const t0 = performance.now();
  h.step();
  samples.push(performance.now() - t0);
}
const heap1 = process.memoryUsage().heapUsed;
samples.sort((a, b) => a - b);
const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))].toFixed(3);
const kbps = ((h.snapshotBytes - bytes0) / samples.length / N) * (SNAPSHOT_HZ / 1024);
console.log(`players ${N}, ticks ${samples.length} (each includes ${N} handleState calls)`);
console.log(`tick p50 ${p(0.5)} ms, p99 ${p(0.99)} ms, max ${p(1)} ms`);
console.log(`snapshot ${kbps.toFixed(2)} KB/s per recipient`);
console.log(
  `heap delta ${((heap1 - heap0) / 1024).toFixed(1)} KB over ${samples.length} ticks (includes harness bots)`,
);
