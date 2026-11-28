// #60 bench: snapshot bytes with 120 players, half of them finished. bun apps/server/src/race/bench.dirty.ts
import { SNAPSHOT_HZ, WIRE } from '@wobble/shared/constants';
import { createSnapshotBuilder } from './snapshot.ts';

const N = 120;
const SECONDS = 20;
function run(skipQuiet: boolean) {
  const b = createSnapshotBuilder(N, { skipQuiet });
  const src = {
    count: N,
    ids: Uint16Array.from({ length: N }, (_, i) => i + 1),
    x: Float64Array.from({ length: N }, (_, i) => i * 2),
    y: new Float64Array(N),
    z: Float64Array.from({ length: N }, (_, i) => -i),
    yaw: new Float64Array(N),
    animFlags: new Uint8Array(N),
    visible: new Uint8Array(N).fill(1),
    receives: new Uint8Array(N).fill(1),
  };
  for (let i = N / 2; i < N; i++) src.animFlags[i] = WIRE.FLAG_FINISHED;
  let bytes = 0;
  const t0 = performance.now();
  const ticks = SNAPSHOT_HZ * SECONDS;
  for (let t = 0; t < ticks; t++) {
    for (let i = 0; i < N / 2; i++) src.z[i] -= 0.4; // the other half keeps racing
    b.build(src, t * 66, (_, d) => (bytes += d.byteLength));
  }
  const ms = (performance.now() - t0) / ticks;
  return { kbps: bytes / SECONDS / N / 1024, ms };
}
const before = run(false);
const after = run(true);
console.log(`120 players, half finished, ${SECONDS} s`);
console.log(`before: ${before.kbps.toFixed(2)} KB/s per receiver, ${before.ms.toFixed(3)} ms per tick`);
console.log(`after:  ${after.kbps.toFixed(2)} KB/s per receiver, ${after.ms.toFixed(3)} ms per tick`);
console.log(`saved ${((1 - after.kbps / before.kbps) * 100).toFixed(0)} % of snapshot bytes`);
