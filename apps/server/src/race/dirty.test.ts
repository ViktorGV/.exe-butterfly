import { describe, expect, it } from 'bun:test';
import { SNAPSHOT_HZ, WIRE } from '@wobble/shared/constants';
import { createDirtyTracker, QUIET_AFTER_TICKS } from './dirty.ts';
import { createSnapshotBuilder, writeRecord } from './snapshot.ts';
import type { SnapshotSource } from './snapshot.ts';

const R = WIRE.SNAPSHOT_RECORD_BYTES;

function rig(count: number) {
  const records = new Uint8Array(count * R);
  const dv = new DataView(records.buffer);
  const visible = new Uint8Array(count).fill(1);
  const tracker = createDirtyTracker(count);
  const write = (i: number, x: number, flags = 0) => writeRecord(dv, i * R, i + 1, x, 0, 0, 0, flags);
  return { tracker, visible, write, records };
}

describe('dirty tracker', () => {
  it('a player standing still is sent once per second, not every tick', () => {
    const { tracker, visible, write, records } = rig(3);
    let sent = 0;
    const TICKS = SNAPSHOT_HZ * 4; // 4 s
    for (let t = 0; t < TICKS; t++) {
      for (let i = 0; i < 3; i++) write(i, 5);
      tracker.update(records, visible, 3, t);
      sent += tracker.active[0];
    }
    // the first sighting and its short tail, then one keyframe per second
    const expected = QUIET_AFTER_TICKS + 1 + 4;
    expect(sent).toBeLessThanOrEqual(expected + 1);
    expect(sent).toBeLessThan(TICKS / 4);
  });

  it('every player is delivered at least once in any window of one second', () => {
    const { tracker, visible, write, records } = rig(20);
    const lastSent = new Array(20).fill(-1);
    let worst = 0;
    for (let t = 0; t < SNAPSHOT_HZ * 6; t++) {
      for (let i = 0; i < 20; i++) write(i, i);
      tracker.update(records, visible, 20, t);
      for (let i = 0; i < 20; i++) {
        if (tracker.active[i]) lastSent[i] = t;
        if (t > SNAPSHOT_HZ) worst = Math.max(worst, t - lastSent[i]);
      }
    }
    expect(worst).toBeLessThan(SNAPSHOT_HZ);
  });

  it('finish and respawn flags are delivered in the tick they happen', () => {
    const { tracker, visible, write, records } = rig(1);
    let t = 0;
    const settle = () => {
      for (let k = 0; k < SNAPSHOT_HZ - 3; k++) {
        write(0, 5);
        tracker.update(records, visible, 1, t++);
      }
    };
    settle();
    for (const flags of [WIRE.FLAG_RESPAWNED, WIRE.FLAG_FINISHED]) {
      // pick a tick that is neither a keyframe nor in the tail, so only the change can make it active
      while (tracker.active[0] || (t + 0) % SNAPSHOT_HZ === SNAPSHOT_HZ - 1) {
        write(0, 5);
        tracker.update(records, visible, 1, t++);
      }
      write(0, 5, flags);
      tracker.update(records, visible, 1, t++);
      expect(tracker.active[0]).toBe(1);
      settle();
    }
  });

  it('a player that moves is always sent; invisible players never are', () => {
    const { tracker, visible, write, records } = rig(2);
    visible[1] = 0;
    for (let t = 0; t < 30; t++) {
      write(0, t);
      write(1, t);
      tracker.update(records, visible, 2, t);
      expect(tracker.active[0]).toBe(1);
      expect(tracker.active[1]).toBe(0);
    }
  });
});

describe('snapshot builder with dirty tracking', () => {
  function source(n: number): SnapshotSource {
    return {
      count: n,
      ids: Uint16Array.from({ length: n }, (_, i) => i + 1),
      x: Float64Array.from({ length: n }, (_, i) => i),
      y: new Float64Array(n),
      z: new Float64Array(n),
      yaw: new Float64Array(n),
      animFlags: new Uint8Array(n),
      visible: new Uint8Array(n).fill(1),
      receives: new Uint8Array(n).fill(1),
    };
  }

  it('sends fewer bytes when half the players are finished, and still shows a new finisher at once', () => {
    const N = 120;
    const run = (skipQuiet: boolean) => {
      const src = source(N);
      const b = createSnapshotBuilder(N, { skipQuiet });
      let bytes = 0;
      let finisherSeen = -1;
      for (let t = 0; t < SNAPSHOT_HZ * 10; t++) {
        for (let i = 0; i < N; i++) {
          if (i < N / 2) src.x[i] += 0.1; // racing
        }
        if (t === 100) src.animFlags[N - 1] = WIRE.FLAG_FINISHED; // a player finishes in this tick
        b.build(src, t * 66, (to, data) => {
          bytes += data.byteLength;
          if (to === 0 && t === 100) {
            const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
            const count = dv.getUint16(5, true);
            for (let k = 0; k < count; k++)
              if (dv.getUint16(WIRE.SNAPSHOT_HEADER_BYTES + k * R, true) === N) finisherSeen = t;
          }
        });
      }
      return { bytes, finisherSeen };
    };
    const before = run(false);
    const after = run(true);
    expect(after.bytes).toBeLessThan(before.bytes * 0.9); // the near-64 cap already limits what is sent, so the saving is modest
    expect(after.finisherSeen).toBe(100);
  });

  it('a new finisher reaches a far receiver in its own tick even when the near set is full', () => {
    const N = 120;
    const RACING = 100; // more moving players than NEAR_SET_SIZE, so the near cut leaves some out
    const src = source(N);
    const b = createSnapshotBuilder(N);
    const FINISHER = N - 1;
    let seenAt = -1;
    for (let t = 0; t < 60; t++) {
      for (let i = 0; i < RACING; i++) src.x[i] += 0.1;
      if (t === 40) src.animFlags[FINISHER] = WIRE.FLAG_FINISHED;
      b.build(src, t * 66, (to, data) => {
        if (to !== 0 || t < 40 || seenAt >= 0) return;
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        for (let k = 0; k < dv.getUint16(5, true); k++) {
          if (dv.getUint16(WIRE.SNAPSHOT_HEADER_BYTES + k * R, true) === FINISHER + 1) seenAt = t;
        }
      });
    }
    expect(seenAt).toBe(40);
  });
});
