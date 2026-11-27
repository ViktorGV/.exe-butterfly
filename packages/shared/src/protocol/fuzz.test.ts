// Fuzz: 100,000 random, truncated, padded and mutated byte arrays go through every decoder.
// Each input is read through a guard that counts reads outside the array, and each result is
// compared with the independent DataView reference decoder in testkit.ts.
import { describe, expect, it } from 'bun:test';
import { WIRE } from '../constants.ts';
import {
  createSnapshotWriter,
  decodeSnapshot,
  decodeState,
  encodePlayerRecord,
  encodeState,
  snapshotTime,
} from './index.ts';
import type { DecodedState } from './index.ts';
import { createReadGuard, randomState, refDecodeSnapshot, refDecodeState, rng } from './testkit.ts';

const CASES = 100_000;
const MAX_RECORDS = 12;

describe('fuzz', () => {
  it('the read guard really counts out-of-bounds reads', () => {
    const guard = createReadGuard();
    guard.use(new Uint8Array([1, 2, 3]));
    expect(guard.view instanceof Uint8Array).toBe(true);
    expect([guard.view.length, guard.view[0], guard.view[2]]).toEqual([3, 1, 3]);
    expect(guard.outOfBounds).toBe(0);
    expect([guard.view[3], guard.view[-1]] as unknown[]).toEqual([undefined, undefined]);
    expect(guard.outOfBounds).toBe(2);
  });

  it(`${CASES.toLocaleString('en')} hostile inputs never throw, never read out of bounds and match the reference`, () => {
    const rand = rng(0xb077e2f1);
    const int = (n: number) => Math.floor(rand() * n);
    const guard = createReadGuard();
    const writer = createSnapshotWriter({ maxRecords: MAX_RECORDS });
    const records = new Uint8Array(MAX_RECORDS * WIRE.SNAPSHOT_RECORD_BYTES);

    const validState = () => encodeState(randomState(rand), int(65536), int(4294967296));
    const validSnapshot = () => {
      const n = int(MAX_RECORDS + 1);
      writer.begin(int(4294967296));
      for (let i = 0; i < n; i++) {
        encodePlayerRecord(int(65536), randomState(rand), records, i * WIRE.SNAPSHOT_RECORD_BYTES);
        writer.copyRecord(records, i);
      }
      return writer.finish().slice();
    };
    const valid = () => (rand() < 0.5 ? validState() : validSnapshot());
    const randomBytes = (n: number) => Uint8Array.from({ length: n }, () => int(256));

    function input(kind: number): Uint8Array {
      const frame = valid();
      switch (kind) {
        case 0: // pure noise of any length
          return randomBytes(int(80));
        case 1: // noise with a STATE header and length
          return Uint8Array.of(WIRE.MSG_STATE, ...randomBytes(WIRE.STATE_BYTES - 1));
        case 2: {
          // noise shaped like a SNAPSHOT: right type, sometimes the right count
          const n = int(6);
          const bytes = Uint8Array.of(WIRE.MSG_SNAPSHOT, ...randomBytes(6 + n * WIRE.SNAPSHOT_RECORD_BYTES));
          if (rand() < 0.7) bytes.set([n, 0], 5);
          return bytes;
        }
        case 3: // truncated
          return frame.subarray(0, int(frame.length));
        case 4: // trailing bytes
          return Uint8Array.of(...frame, ...randomBytes(1 + int(12)));
        case 5: {
          // one to three flipped bytes
          for (let k = 1 + int(3); k > 0; k--) frame[int(frame.length)] = int(256);
          return frame;
        }
        case 6: {
          // a frame at an offset inside a larger buffer full of other data
          const padded = randomBytes(frame.length + 16);
          padded.set(frame, 8);
          return padded.subarray(8, 8 + frame.length);
        }
        default: // valid and untouched
          return frame;
      }
    }

    const out = decodeState(validState()) as DecodedState;
    const seen = { id: 0, x: 0, y: 0, z: 0, yaw: 0, anim: 0, flags: 0 };
    let visited = 0;
    let mismatches = 0;
    let expected: ReturnType<typeof refDecodeSnapshot> = null;
    const visitor = (id: number, x: number, y: number, z: number, yaw: number, anim: number, flags: number) => {
      const r = expected?.records[visited++];
      seen.id = id;
      if (!r || r.id !== id || r.x !== x || r.y !== y || r.z !== z || r.anim !== anim || r.flags !== flags)
        mismatches++;
      else if (Math.abs(r.yaw - yaw) > 1e-12) mismatches++;
    };

    let thrown = 0;
    let decodedStates = 0;
    let decodedSnapshots = 0;
    let rejected = 0;
    for (let i = 0; i < CASES; i++) {
      const bytes = input(i % 8);
      guard.use(bytes);
      const refState = refDecodeState(bytes);
      expected = refDecodeSnapshot(bytes);
      visited = 0;
      try {
        const s = decodeState(guard.view, out);
        if ((s === null) !== (refState === null)) mismatches++;
        if (s !== null && refState !== null) {
          decodedStates++;
          if (s.seq !== refState.seq || s.raceTimeMs !== refState.raceTimeMs) mismatches++;
          if (s.pos[0] !== refState.x || s.pos[1] !== refState.y || s.pos[2] !== refState.z) mismatches++;
          if (Math.abs(s.yaw - refState.yaw) > 1e-12 || s.anim !== (refState.animFlags & WIRE.ANIM_MASK)) mismatches++;
        }
        const time = decodeSnapshot(guard.view, visitor);
        if (time !== (expected ? expected.serverTimeMs : null)) mismatches++;
        if (visited !== (expected ? expected.records.length : 0)) mismatches++;
        if (snapshotTime(guard.view) !== time) mismatches++;
        if (time !== null) decodedSnapshots++;
        if (s === null && time === null) rejected++;
      } catch {
        thrown++;
      }
    }

    expect(thrown).toBe(0);
    expect(guard.outOfBounds).toBe(0);
    expect(mismatches).toBe(0);
    // the corpus must exercise both outcomes, or the checks above prove nothing
    expect(decodedStates).toBeGreaterThan(5000);
    expect(decodedSnapshots).toBeGreaterThan(5000);
    expect(rejected).toBeGreaterThan(50000);
    expect(decodedStates + decodedSnapshots + rejected).toBe(CASES);
  });
});
