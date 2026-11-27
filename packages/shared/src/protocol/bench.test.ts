// Budgets from #17. Every timing takes the best of several batches, so a busy CI machine
// cannot fail a budget by chance. Run `PROTOCOL_BENCH=1 bun test packages/shared/src/protocol/bench`
// to print the measured numbers.
import { describe, expect, it } from 'bun:test';
import { MAX_PLAYERS_PER_ROOM, WIRE } from '../constants.ts';
import { createSnapshotWriter, decodeSnapshot, decodeState, encodePlayerRecord, encodeState } from './index.ts';
import { randomState, rng } from './testkit.ts';

const PLAYERS = MAX_PLAYERS_PER_ROOM;
const report = (label: string, micros: number) => {
  if (process.env.PROTOCOL_BENCH) console.log(`[protocol bench] ${label}: ${micros.toFixed(3)} µs`);
};

/** Best average time of one `fn()` call in microseconds, over `batches` batches of `rounds` calls. */
function bestMicros(fn: () => void, rounds: number, batches = 12): number {
  for (let r = 0; r < rounds; r++) fn(); // warm up the JIT
  let best = Infinity;
  for (let b = 0; b < batches; b++) {
    const t0 = performance.now();
    for (let r = 0; r < rounds; r++) fn();
    best = Math.min(best, ((performance.now() - t0) * 1000) / rounds);
  }
  return best;
}

describe('benchmark', () => {
  const rand = rng(99);
  const states = Array.from({ length: PLAYERS }, () => randomState(rand));
  const records = new Uint8Array(PLAYERS * WIRE.SNAPSHOT_RECORD_BYTES);
  states.forEach((s, id) => encodePlayerRecord(id, s, records, id * WIRE.SNAPSHOT_RECORD_BYTES));
  const writer = createSnapshotWriter();
  let frame: Uint8Array = new Uint8Array(0);
  let tick = 0;
  const assemble = () => {
    writer.begin(tick++);
    for (let i = 0; i < PLAYERS; i++) writer.copyRecord(records, i);
    frame = writer.finish();
  };

  it('assembles a 300-record snapshot from pre-encoded records in < 20 µs', () => {
    const micros = bestMicros(assemble, 2000);
    report('assemble 300-record snapshot', micros);
    expect(frame.length).toBe(WIRE.SNAPSHOT_HEADER_BYTES + PLAYERS * WIRE.SNAPSHOT_RECORD_BYTES);
    expect(micros).toBeLessThan(20);
  });

  it('assembles every snapshot into the same buffer and the same view (no allocation per message)', () => {
    assemble();
    const first = frame;
    for (let i = 0; i < 1000; i++) {
      assemble();
      if (frame !== first) throw new Error('finish() returned a new view');
    }
    expect(frame.buffer).toBe(first.buffer);
  });

  it('encodes all 300 records and decodes a 300-record snapshot well inside a tick', () => {
    const encodeAll = () => {
      for (let i = 0; i < PLAYERS; i++) encodePlayerRecord(i, states[i], records, i * WIRE.SNAPSHOT_RECORD_BYTES);
    };
    let sum = 0;
    const visitor = (id: number, x: number, y: number, z: number, yaw: number, anim: number, flags: number) => {
      sum += id + x + y + z + yaw + anim + flags;
    };
    assemble();
    const encodeMicros = bestMicros(encodeAll, 500);
    const decodeMicros = bestMicros(() => void decodeSnapshot(frame, visitor), 500);
    report('encode 300 player records', encodeMicros);
    report('decode 300-record snapshot', decodeMicros);
    expect(Number.isFinite(sum)).toBe(true);
    expect(encodeMicros).toBeLessThan(200);
    expect(decodeMicros).toBeLessThan(200);
  });

  it('encodes and decodes a STATE frame in place in < 2 µs', () => {
    const buf = new Uint8Array(WIRE.STATE_BYTES);
    const out = decodeState(encodeState(states[0], 0, 0, buf))!;
    let i = 0;
    let failed = 0;
    const micros = bestMicros(() => {
      i++;
      const b = encodeState(states[i % PLAYERS], i, i * 66, buf);
      if (b !== buf || decodeState(b, out) !== out) failed++;
    }, 20000);
    report('encode + decode one STATE', micros);
    expect(failed).toBe(0); // always the caller's buffer and the caller's object
    expect(micros).toBeLessThan(2);
  });
});
