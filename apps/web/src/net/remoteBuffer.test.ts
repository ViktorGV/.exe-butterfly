import { describe, expect, test } from 'bun:test';
import { Anim, POS_SCALE, WIRE } from '@wobble/shared/constants';
import { createRemoteBuffer } from './remoteBuffer.ts';

interface Rec {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim?: number;
  flags?: number;
}

/** Encodes a SNAPSHOT frame per docs/CONTRACTS.md §6 (test-only; the real codec is #17). */
function encodeSnapshot(serverTimeMs: number, recs: Rec[]): ArrayBuffer {
  const buf = new ArrayBuffer(WIRE.SNAPSHOT_HEADER_BYTES + recs.length * WIRE.SNAPSHOT_RECORD_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, WIRE.MSG_SNAPSHOT);
  dv.setUint32(1, serverTimeMs, true);
  dv.setUint16(5, recs.length, true);
  let off = WIRE.SNAPSHOT_HEADER_BYTES;
  for (const r of recs) {
    dv.setUint16(off, r.id, true);
    dv.setInt16(off + 2, Math.round(r.x * POS_SCALE), true);
    dv.setInt16(off + 4, Math.round(r.y * POS_SCALE), true);
    dv.setInt16(off + 6, Math.round(r.z * POS_SCALE), true);
    dv.setUint8(off + 8, Math.round((r.yaw / (2 * Math.PI)) * 256) & 255);
    dv.setUint8(off + 9, (r.anim ?? 0) | (r.flags ?? 0));
    off += WIRE.SNAPSHOT_RECORD_BYTES;
  }
  return buf;
}

function clock(start = 0) {
  const c = { now: start, serverNow: () => c.now };
  return c;
}

const DELAY = 100;

describe('remoteBuffer', () => {
  test('same Map and same value objects across 1000 calls with 120 players', () => {
    const c = clock(1000);
    const rb = createRemoteBuffer({ serverNow: c.serverNow, interpDelayMs: DELAY });
    const recs = (t: number): Rec[] =>
      Array.from({ length: 120 }, (_, i) => ({ id: i + 1, x: i + t / 1000, y: 0, z: -i, yaw: 0 }));
    for (let t = 0; t <= 1000; t += 66) rb.ingest(encodeSnapshot(t, recs(t)));

    const first = rb.sampleRemote();
    expect(first.size).toBe(120);
    const objs = new Map([...first].map(([id, s]) => [id, s] as const));
    const posArrays = new Map([...first].map(([id, s]) => [id, s.pos] as const));

    for (let i = 0; i < 1000; i++) {
      c.now = 1000 + (i % 100);
      const m = rb.sampleRemote();
      expect(m).toBe(first);
      expect(m.size).toBe(120);
      for (const [id, s] of m) {
        expect(s).toBe(objs.get(id)!);
        expect(s.pos).toBe(posArrays.get(id)!);
      }
    }
  });

  test('interpolates midpoint position', () => {
    const c = clock();
    const rb = createRemoteBuffer({ serverNow: c.serverNow, interpDelayMs: DELAY });
    rb.ingest(encodeSnapshot(1000, [{ id: 7, x: 0, y: 1, z: -10, yaw: 0, anim: Anim.RUN }]));
    rb.ingest(encodeSnapshot(1100, [{ id: 7, x: 4, y: 3, z: -20, yaw: 0, anim: Anim.JUMP }]));
    c.now = 1050 + DELAY;
    const s = rb.sampleRemote().get(7)!;
    expect(s.pos[0]).toBeCloseTo(2, 5);
    expect(s.pos[1]).toBeCloseTo(2, 5);
    expect(s.pos[2]).toBeCloseTo(-15, 5);
    // anim/flags from the sample at or before renderTime
    expect(s.anim).toBe(Anim.RUN);
  });

  test('shortest-path yaw across the ±π wrap', () => {
    const c = clock();
    const rb = createRemoteBuffer({ serverNow: c.serverNow, interpDelayMs: DELAY });
    const a = Math.PI - 0.2;
    const b = -Math.PI + 0.2;
    rb.ingest(encodeSnapshot(1000, [{ id: 1, x: 0, y: 0, z: 0, yaw: a }]));
    rb.ingest(encodeSnapshot(1100, [{ id: 1, x: 0, y: 0, z: 0, yaw: b }]));
    c.now = 1050 + DELAY;
    const yaw = rb.sampleRemote().get(1)!.yaw;
    // midpoint of the short arc is ±π, not 0
    expect(Math.abs(Math.abs(yaw) - Math.PI)).toBeLessThan(2 * ((2 * Math.PI) / 256));
    expect(yaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(yaw).toBeLessThan(Math.PI);

    // a quarter of the way goes further positive (past a), still the short way
    c.now = 1025 + DELAY;
    const q = rb.sampleRemote().get(1)!.yaw;
    expect(Math.abs(q)).toBeGreaterThan(Math.PI - 0.2);
  });

  test('holds newest past the end and oldest before the start', () => {
    const c = clock();
    const rb = createRemoteBuffer({ serverNow: c.serverNow, interpDelayMs: DELAY });
    rb.ingest(encodeSnapshot(1000, [{ id: 3, x: 1, y: 0, z: 0, yaw: 0 }]));
    rb.ingest(encodeSnapshot(1100, [{ id: 3, x: 2, y: 0, z: 0, yaw: 0 }]));
    c.now = 2000;
    expect(rb.sampleRemote().get(3)!.pos[0]).toBeCloseTo(2, 5);
    c.now = 500;
    expect(rb.sampleRemote().get(3)!.pos[0]).toBeCloseTo(1, 5);
  });

  test('ignores out-of-order and duplicate samples (newer wins across streams)', () => {
    const c = clock();
    const rb = createRemoteBuffer({ serverNow: c.serverNow, interpDelayMs: DELAY });
    // "near" stream
    expect(rb.ingest(encodeSnapshot(1100, [{ id: 5, x: 10, y: 0, z: 0, yaw: 0 }]))).toBe(1);
    // late "far" snapshot with older data for the same player, plus a new player
    expect(
      rb.ingest(
        encodeSnapshot(1000, [
          { id: 5, x: -99, y: 0, z: 0, yaw: 0 },
          { id: 6, x: 1, y: 0, z: 0, yaw: 0 },
        ]),
      ),
    ).toBe(1);
    // duplicate time is ignored too
    expect(rb.ingest(encodeSnapshot(1100, [{ id: 5, x: -99, y: 0, z: 0, yaw: 0 }]))).toBe(0);
    c.now = 1000 + DELAY;
    const m = rb.sampleRemote();
    expect(m.get(5)!.pos[0]).toBeCloseTo(10, 5);
    expect(m.get(6)!.pos[0]).toBeCloseTo(1, 5);
  });

  test('ignores malformed frames', () => {
    const rb = createRemoteBuffer({ serverNow: () => 0 });
    const good = encodeSnapshot(10, [{ id: 1, x: 0, y: 0, z: 0, yaw: 0 }]);
    expect(rb.ingest(good.slice(0, good.byteLength - 1))).toBe(0);
    const wrongType = new Uint8Array(good.slice(0));
    wrongType[0] = WIRE.MSG_STATE;
    expect(rb.ingest(wrongType.buffer)).toBe(0);
    expect(rb.ingest(new ArrayBuffer(3))).toBe(0);
    expect(rb.size).toBe(0);
  });

  test('removes players not seen for staleMs and reuses their slot', () => {
    const c = clock();
    const rb = createRemoteBuffer({ serverNow: c.serverNow, interpDelayMs: DELAY, maxPlayers: 2 });
    rb.ingest(
      encodeSnapshot(1000, [
        { id: 1, x: 0, y: 0, z: 0, yaw: 0 },
        { id: 2, x: 0, y: 0, z: 0, yaw: 0 },
      ]),
    );
    rb.ingest(encodeSnapshot(3500, [{ id: 2, x: 0, y: 0, z: 0, yaw: 0 }]));
    c.now = 3900;
    expect(rb.sampleRemote().size).toBe(2);
    c.now = 4001; // id 1 last seen at 1000 -> stale
    const m = rb.sampleRemote();
    expect(m.has(1)).toBe(false);
    expect(m.has(2)).toBe(true);
    expect(rb.size).toBe(1);
    // full at 2 players: the freed slot can be used by a new id
    expect(rb.ingest(encodeSnapshot(4000, [{ id: 9, x: 1, y: 0, z: 0, yaw: 0 }]))).toBe(1);
    expect(rb.ingest(encodeSnapshot(4000, [{ id: 10, x: 1, y: 0, z: 0, yaw: 0 }]))).toBe(0);
    expect(rb.sampleRemote().has(9)).toBe(true);
    rb.clear();
    expect(rb.size).toBe(0);
    expect(rb.sampleRemote().size).toBe(0);
  });

  test('quantisation round-trip within 1/POS_SCALE', () => {
    const c = clock();
    const rb = createRemoteBuffer({ serverNow: c.serverNow, interpDelayMs: 0 });
    const recs: Rec[] = [];
    for (let i = 0; i < 50; i++) {
      recs.push({
        id: 100 + i,
        x: Math.sin(i) * 600,
        y: (i % 7) * 1.337,
        z: -i * 7.919,
        yaw: (i / 50) * 2 * Math.PI - Math.PI,
        anim: i % 8,
        flags: i % 2 ? WIRE.FLAG_GROUNDED : WIRE.FLAG_FINISHED,
      });
    }
    rb.ingest(new DataView(encodeSnapshot(500, recs)));
    c.now = 500;
    const m = rb.sampleRemote();
    for (const r of recs) {
      const s = m.get(r.id)!;
      expect(Math.abs(s.pos[0] - r.x)).toBeLessThanOrEqual(1 / POS_SCALE);
      expect(Math.abs(s.pos[1] - r.y)).toBeLessThanOrEqual(1 / POS_SCALE);
      expect(Math.abs(s.pos[2] - r.z)).toBeLessThanOrEqual(1 / POS_SCALE);
      const dy = Math.abs(((s.yaw - r.yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(dy).toBeLessThanOrEqual(Math.PI / 256 + 1e-6);
      expect(s.anim as number).toBe(r.anim as number);
      expect(s.flags).toBe(r.flags as number);
    }
  });

  test('benchmark: sampleRemote() with 120 players', () => {
    const c = clock(0);
    const rb = createRemoteBuffer({ serverNow: c.serverNow });
    for (let t = 0; t < 8 * 66; t += 66) {
      rb.ingest(
        encodeSnapshot(
          t,
          Array.from({ length: 120 }, (_, i) => ({ id: i, x: i + t * 0.01, y: 0, z: -t * 0.01, yaw: t * 0.001 })),
        ),
      );
    }
    // warm up
    for (let i = 0; i < 200; i++) {
      c.now = 300 + (i % 150);
      rb.sampleRemote();
    }
    const N = 1000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      c.now = 300 + (i % 150);
      rb.sampleRemote();
    }
    const msPerCall = (performance.now() - t0) / N;
    console.log(`sampleRemote() 120 players: ${msPerCall.toFixed(4)} ms/call`);
    expect(rb.sampleRemote().size).toBe(120);
    expect(msPerCall).toBeLessThan(1);
  });
});
