import { describe, expect, it } from 'bun:test';
import { SNAPSHOT_HZ, WIRE } from '@wobble/shared/constants';
import { createDirtyTracker } from './dirty.ts';
import type { SnapshotSource } from './snapshot.ts';

const STEP_MS = 1000 / SNAPSHOT_HZ;

function makeSource(count: number): SnapshotSource {
  return {
    count,
    ids: Uint16Array.from({ length: count }, (_, i) => 1000 + i),
    x: new Float64Array(count),
    y: new Float64Array(count).fill(0.5),
    z: new Float64Array(count),
    yaw: new Float64Array(count),
    animFlags: new Uint8Array(count),
    visible: new Uint8Array(count).fill(1),
    receives: new Uint8Array(count).fill(1),
  };
}

describe('createDirtyTracker', () => {
  it('sends a player standing still once per second, not every tick', () => {
    const tracker = createDirtyTracker(1);
    const src = makeSource(1);
    const out = new Uint8Array(1);
    const sentTicks: number[] = [];
    const ticks = SNAPSHOT_HZ * 3; // 3 s
    for (let t = 1; t <= ticks; t++) {
      tracker.filter(src, t * STEP_MS, out);
      if (out[0]) sentTicks.push(t);
    }
    expect(sentTicks[0]).toBe(1); // never sent before: included at once
    expect(sentTicks.length).toBeGreaterThanOrEqual(3);
    expect(sentTicks.length).toBeLessThanOrEqual(4);
    for (let k = 1; k < sentTicks.length; k++) expect(sentTicks[k] - sentTicks[k - 1]).toBe(SNAPSHOT_HZ);
  });

  it('sends a moving player every tick, then stops once it stands still', () => {
    const tracker = createDirtyTracker(1);
    const src = makeSource(1);
    const out = new Uint8Array(1);
    for (let t = 1; t <= 30; t++) {
      src.z[0] = -t * 0.5;
      tracker.filter(src, t * STEP_MS, out);
      expect(out[0]).toBe(1);
    }
    tracker.filter(src, 31 * STEP_MS, out); // same position, keyframe not due
    expect(out[0]).toBe(0);
  });

  it('skips unchanged ticks and treats sub-2 cm jitter as unchanged', () => {
    const tracker = createDirtyTracker(1);
    const src = makeSource(1);
    const out = new Uint8Array(1);
    tracker.filter(src, STEP_MS, out);
    expect(out[0]).toBe(1);
    src.x[0] = 0.004; // rounds to the same 2 cm step
    tracker.filter(src, 2 * STEP_MS, out);
    expect(out[0]).toBe(0);
    src.x[0] = 0.03; // next step
    tracker.filter(src, 3 * STEP_MS, out);
    expect(out[0]).toBe(1);
    src.yaw[0] = 0.1;
    tracker.filter(src, 4 * STEP_MS, out);
    expect(out[0]).toBe(1);
    tracker.filter(src, 5 * STEP_MS, out);
    expect(out[0]).toBe(0);
  });

  it('always delivers finish and respawn flags in the tick they happen', () => {
    const tracker = createDirtyTracker(2);
    const src = makeSource(2);
    const out = new Uint8Array(2);
    tracker.filter(src, STEP_MS, out); // both sent once
    tracker.filter(src, 2 * STEP_MS, out);
    expect(Array.from(out)).toEqual([0, 0]);

    src.animFlags[0] = WIRE.FLAG_FINISHED; // player 0 finishes, position unchanged
    src.animFlags[1] = WIRE.FLAG_RESPAWNED; // player 1 respawns
    expect(tracker.filter(src, 3 * STEP_MS, out)).toBe(2);
    expect(Array.from(out)).toEqual([1, 1]);

    tracker.filter(src, 4 * STEP_MS, out); // the flags stay set: nothing new to say
    expect(Array.from(out)).toEqual([0, 0]);
    src.animFlags[1] = 0; // respawn flag clears: that is a change too
    tracker.filter(src, 5 * STEP_MS, out);
    expect(Array.from(out)).toEqual([0, 1]);
  });

  it('keeps finished players in the stream at the keyframe rate', () => {
    const tracker = createDirtyTracker(1);
    const src = makeSource(1);
    src.animFlags[0] = WIRE.FLAG_FINISHED;
    const out = new Uint8Array(1);
    let sends = 0;
    for (let t = 1; t <= SNAPSHOT_HZ * 5; t++) {
      tracker.filter(src, t * STEP_MS, out);
      sends += out[0];
    }
    expect(sends).toBeGreaterThanOrEqual(5);
    expect(sends).toBeLessThanOrEqual(6);
  });

  it('never includes hidden players and resends a player the moment it is shown again', () => {
    const tracker = createDirtyTracker(2);
    const src = makeSource(2);
    const out = new Uint8Array(2);
    tracker.filter(src, STEP_MS, out);
    src.visible[1] = 0; // disconnected
    for (let t = 2; t <= 10; t++) {
      tracker.filter(src, t * STEP_MS, out);
      expect(out[1]).toBe(0);
    }
    src.visible[1] = 1; // back, nothing moved
    tracker.filter(src, 11 * STEP_MS, out);
    expect(out[1]).toBe(1);
    tracker.reset(0);
    tracker.filter(src, 12 * STEP_MS, out);
    expect(out[0]).toBe(1);
  });

  it('spreads the keyframes of 300 idle players over the second', () => {
    const tracker = createDirtyTracker(300);
    const src = makeSource(300);
    const out = new Uint8Array(300);
    expect(tracker.filter(src, STEP_MS, out)).toBe(300); // everybody once
    let worst = 0;
    let total = 0;
    for (let t = 2; t <= SNAPSHOT_HZ * 3; t++) {
      const n = tracker.filter(src, t * STEP_MS, out);
      worst = Math.max(worst, n);
      total += n;
    }
    expect(worst).toBeLessThanOrEqual(Math.ceil(300 / SNAPSHOT_HZ) + 1);
    expect(total).toBeGreaterThanOrEqual(300 * 2); // ~every player twice more in 3 s
  });

  it('bench: 120 players, half finished, sends far fewer bytes than resending everyone', () => {
    const tracker = createDirtyTracker(120);
    const src = makeSource(120);
    for (let i = 60; i < 120; i++) src.animFlags[i] = WIRE.FLAG_FINISHED; // finished, standing on the pad
    const out = new Uint8Array(120);
    const H = WIRE.SNAPSHOT_HEADER_BYTES;
    const R = WIRE.SNAPSHOT_RECORD_BYTES;
    const ticks = SNAPSHOT_HZ * 20;
    let before = 0;
    let after = 0;
    for (let t = 1; t <= ticks; t++) {
      for (let i = 0; i < 60; i++) src.z[i] = -t * 0.4 - i * 0.1; // racers keep running
      before += H + 120 * R;
      const n = tracker.filter(src, t * STEP_MS, out);
      after += n > 0 ? H + n * R : 0;
    }
    console.log(
      `snapshot bytes over 20 s, 120 players (60 finished): before ${before}, after ${after} (${((1 - after / before) * 100).toFixed(1)}% less)`,
    );
    expect(after).toBeLessThan(before * 0.6);
  });

  it('rejects a bad keyframe interval', () => {
    expect(() => createDirtyTracker(1, { keyframeMs: 0 })).toThrow(RangeError);
  });
});
