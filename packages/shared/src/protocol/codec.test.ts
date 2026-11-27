import { describe, expect, it } from 'bun:test';
import { Anim, MAX_PLAYERS_PER_ROOM, POS_SCALE, WIRE } from '../constants.ts';
import type { IncomingState } from '../types.ts';
import {
  INT16_MAX,
  INT16_MIN,
  POS_MAX,
  POS_MIN,
  asBytes,
  createSnapshotWriter,
  decodeSnapshot,
  decodeState,
  dequantizePos,
  dequantizeYaw,
  encodePlayerRecord,
  encodeState,
  flagsOf,
  isValidAnimFlags,
  packAnimFlags,
  quantizePos,
  quantizeYaw,
  snapshotTime,
} from './index.ts';
import type { DecodedState, WireState } from './index.ts';
import { angleDiff, randomState, refEncodeSnapshot, refEncodeState, rng } from './testkit.ts';
import type { RefPlayer, RefRecord } from './testkit.ts';

const POS_TOLERANCE = 0.01 + 1e-9; // 1 cm
const YAW_TOLERANCE = (1.5 * Math.PI) / 180; // 1.5 degrees
const state = (over: Partial<WireState> = {}): WireState => ({
  pos: [1.5, 0, -20],
  yaw: Math.PI / 2,
  anim: Anim.RUN,
  grounded: true,
  finished: false,
  ...over,
});

function collect(frame: Uint8Array): { serverTimeMs: number | null; records: RefRecord[] } {
  const records: RefRecord[] = [];
  const serverTimeMs = decodeSnapshot(frame, (id, x, y, z, yaw, anim, flags) => {
    records.push({ id, x, y, z, yaw, anim, flags });
  });
  return { serverTimeMs, records };
}

function assemble(serverTimeMs: number, players: RefPlayer[]): Uint8Array {
  const records = new Uint8Array(players.length * WIRE.SNAPSHOT_RECORD_BYTES);
  players.forEach((p, i) => encodePlayerRecord(p.id, p.state, records, i * WIRE.SNAPSHOT_RECORD_BYTES));
  const writer = createSnapshotWriter();
  writer.begin(serverTimeMs);
  players.forEach((_, i) => writer.copyRecord(records, i));
  return writer.finish();
}

describe('quantisation', () => {
  it('rounds to 2 cm steps and clamps at the int16 limits', () => {
    expect(quantizePos(1.5)).toBe(75);
    expect(quantizePos(-20)).toBe(-1000);
    expect(quantizePos(0.25)).toBe(13); // 12.5 rounds toward +infinity, as Math.round does
    expect(quantizePos(-0.25)).toBe(-12);
    expect(quantizePos(POS_MAX)).toBe(INT16_MAX);
    expect(quantizePos(POS_MIN)).toBe(INT16_MIN);
    for (const big of [POS_MAX + 0.02, 1e6, 1e300, Infinity]) expect(quantizePos(big)).toBe(INT16_MAX);
    for (const small of [POS_MIN - 0.02, -1e6, -1e300, -Infinity]) expect(quantizePos(small)).toBe(INT16_MIN);
    expect(quantizePos(NaN)).toBe(0);
    expect(Object.is(quantizePos(-0.001), 0)).toBe(true); // never -0
    expect(dequantizePos(INT16_MAX)).toBe(INT16_MAX / POS_SCALE);
  });

  it('wraps yaw into one byte and back into [-pi, pi)', () => {
    expect(quantizeYaw(0)).toBe(0);
    expect(quantizeYaw(Math.PI / 2)).toBe(64);
    expect(quantizeYaw(Math.PI)).toBe(128);
    expect(quantizeYaw(-Math.PI / 2)).toBe(192);
    expect(quantizeYaw(Math.PI * 2)).toBe(0);
    expect(quantizeYaw(Math.PI * 2 * 5 + Math.PI / 2)).toBe(64);
    for (const bad of [NaN, Infinity, -Infinity]) expect(quantizeYaw(bad)).toBe(0);
    for (let b = 0; b < 256; b++) {
      const rad = dequantizeYaw(b);
      expect(rad).toBeGreaterThanOrEqual(-Math.PI);
      expect(rad).toBeLessThan(Math.PI);
      expect(quantizeYaw(rad)).toBe(b);
    }
  });

  it('packs anim and flags into the documented bits', () => {
    expect(packAnimFlags(Anim.CELEBRATE, true, true, true)).toBe(0x77);
    expect(packAnimFlags(Anim.RUN, true, false, false)).toBe(Anim.RUN | WIRE.FLAG_GROUNDED);
    expect(packAnimFlags(Anim.IDLE, false, true, false)).toBe(WIRE.FLAG_FINISHED);
    expect(packAnimFlags(Anim.IDLE, false, false, true)).toBe(WIRE.FLAG_RESPAWNED);
    expect(flagsOf(0x77)).toBe(0x70);
    expect(isValidAnimFlags(0x77)).toBe(true);
    expect(isValidAnimFlags(0x08)).toBe(false); // anim 8 does not exist
    expect(isValidAnimFlags(0x80)).toBe(false); // reserved bit
  });
});

describe('STATE', () => {
  it('round-trips random states within 1 cm and 1.5 degrees (property, 20,000 cases)', () => {
    const rand = rng(17);
    const frame = new Uint8Array(WIRE.STATE_BYTES);
    const out = decodeState(encodeState(state(), 0, 0))!;
    let worstPos = 0;
    let worstYaw = 0;
    let wrong = 0;
    for (let i = 0; i < 20000; i++) {
      const s = randomState(rand);
      const seq = Math.floor(rand() * 65536);
      const raceTimeMs = Math.floor(rand() * 4294967296);
      const d = decodeState(encodeState(s, seq, raceTimeMs, frame), out);
      if (d !== out) wrong++;
      for (let a = 0; a < 3; a++) worstPos = Math.max(worstPos, Math.abs(out.pos[a] - s.pos[a]));
      worstYaw = Math.max(worstYaw, angleDiff(out.yaw, s.yaw));
      if (out.seq !== seq || out.raceTimeMs !== raceTimeMs || out.anim !== s.anim) wrong++;
      if (out.grounded !== s.grounded || out.finished !== s.finished || out.respawned !== s.respawned) wrong++;
      const ref = refEncodeState(s, seq, raceTimeMs);
      for (let b = 0; b < frame.length; b++) if (frame[b] !== ref[b]) wrong++;
    }
    expect(wrong).toBe(0);
    expect(worstPos).toBeLessThanOrEqual(POS_TOLERANCE);
    expect(worstYaw).toBeLessThanOrEqual(YAW_TOLERANCE);
  });

  it('is exactly 15 bytes and reuses the buffers it is given', () => {
    expect(encodeState(state(), 1, 1000).length).toBe(WIRE.STATE_BYTES);
    const frame = new Uint8Array(WIRE.STATE_BYTES);
    expect(encodeState(state(), 1, 1000, frame)).toBe(frame);
    const out = decodeState(frame)!;
    const pos = out.pos;
    expect(decodeState(frame, out)).toBe(out);
    expect(out.pos).toBe(pos);
    expect(() => encodeState(state(), 0, 0, new Uint8Array(14))).toThrow(RangeError);
  });

  it('clamps positions, wraps seq and clamps race time', () => {
    const d = decodeState(encodeState(state({ pos: [1000, -1000, NaN] }), 65538, -50))!;
    expect(d.pos).toEqual([POS_MAX, POS_MIN, 0]);
    expect(d.seq).toBe(2);
    expect(d.raceTimeMs).toBe(0);
    expect(decodeState(encodeState(state(), 0, 1e12))!.raceTimeMs).toBe(4294967295);
    expect(decodeState(encodeState(state(), 0, 1000.4))!.raceTimeMs).toBe(1000);
    expect(decodeState(encodeState(state(), 0, NaN))!.raceTimeMs).toBe(0);
  });

  it('treats a missing respawned as false', () => {
    expect(decodeState(encodeState(state(), 0, 0))!.respawned).toBe(false);
    expect(decodeState(encodeState(state({ respawned: true }), 0, 0))!.respawned).toBe(true);
  });

  it('fills an IncomingState and leaves vel and checkpoint alone', () => {
    const incoming: IncomingState = {
      pos: [0, 0, 0],
      vel: [1, 2, 3],
      yaw: 0,
      anim: Anim.IDLE,
      grounded: false,
      checkpoint: 4,
      finished: false,
      seq: 0,
      raceTimeMs: 0,
    };
    expect(decodeState(encodeState(state({ respawned: true }), 9, 500), incoming)).toBe(incoming);
    expect(incoming).toMatchObject({ seq: 9, raceTimeMs: 500, vel: [1, 2, 3], checkpoint: 4, respawned: true });
    expect(incoming.pos).toEqual([1.5, 0, -20]);
  });

  it('returns null for malformed frames and leaves out untouched', () => {
    const good = encodeState(state(), 1, 1000);
    const out = decodeState(good)!;
    const before: DecodedState = structuredClone(out);
    const wrongType = good.slice();
    wrongType[0] = WIRE.MSG_SNAPSHOT;
    const badAnim = good.slice();
    badAnim[14] = 0x18;
    const reserved = good.slice();
    reserved[14] = 0x91;
    const cases = [new Uint8Array(0), good.subarray(0, 14), new Uint8Array([...good, 0]), wrongType, badAnim, reserved];
    for (const bad of cases) expect(decodeState(bad, out)).toBeNull();
    expect(out).toEqual(before);
    for (const notBytes of [null, undefined, 'x', 15, {}, [], new ArrayBuffer(15)]) {
      expect(decodeState(notBytes as unknown as Uint8Array)).toBeNull();
    }
  });
});

describe('SNAPSHOT', () => {
  it('round-trips random snapshots within 1 cm and 1.5 degrees (property, 300 frames)', () => {
    const rand = rng(23);
    let worstPos = 0;
    let worstYaw = 0;
    for (let f = 0; f < 300; f++) {
      const players: RefPlayer[] = Array.from({ length: Math.floor(rand() * 41) }, () => ({
        id: Math.floor(rand() * 65536),
        state: randomState(rand),
      }));
      const time = Math.floor(rand() * 4294967296);
      const frame = assemble(time, players);
      expect(frame).toEqual(refEncodeSnapshot(time, players));
      const { serverTimeMs, records } = collect(frame);
      expect(serverTimeMs).toBe(time);
      expect(snapshotTime(frame)).toBe(time);
      expect(records.length).toBe(players.length);
      records.forEach((r, i) => {
        const s = players[i].state;
        expect(r.id).toBe(players[i].id);
        expect(r.anim).toBe(s.anim);
        expect(r.flags).toBe(packAnimFlags(0, s.grounded, s.finished, s.respawned === true));
        worstPos = Math.max(worstPos, Math.abs(r.x - s.pos[0]), Math.abs(r.y - s.pos[1]), Math.abs(r.z - s.pos[2]));
        worstYaw = Math.max(worstYaw, angleDiff(r.yaw, s.yaw));
      });
    }
    expect(worstPos).toBeLessThanOrEqual(POS_TOLERANCE);
    expect(worstYaw).toBeLessThanOrEqual(YAW_TOLERANCE);
  });

  it('builds a different snapshot per recipient from records encoded once', () => {
    const rand = rng(5);
    const players: RefPlayer[] = Array.from({ length: 6 }, (_, id) => ({ id, state: randomState(rand) }));
    const records = new Uint8Array(players.length * WIRE.SNAPSHOT_RECORD_BYTES);
    let offset = 0;
    for (const p of players) offset = encodePlayerRecord(p.id, p.state, records, offset);
    expect(offset).toBe(records.length);
    const writer = createSnapshotWriter();
    for (const recipient of players) {
      const others = players.filter((p) => p.id !== recipient.id);
      writer.begin(777);
      players.forEach((p, i) => {
        if (p.id !== recipient.id) writer.copyRecord(records, i);
      });
      expect(writer.count).toBe(5);
      expect(writer.finish()).toEqual(refEncodeSnapshot(777, others));
    }
  });

  it('finish() returns an exact-length view of one reused buffer', () => {
    const records = new Uint8Array(3 * WIRE.SNAPSHOT_RECORD_BYTES);
    const writer = createSnapshotWriter({ maxRecords: 3 });
    expect(writer.maxRecords).toBe(3);
    expect(createSnapshotWriter().maxRecords).toBe(MAX_PLAYERS_PER_ROOM);
    writer.begin(1);
    const empty = writer.finish();
    expect(empty.length).toBe(WIRE.SNAPSHOT_HEADER_BYTES);
    expect(collect(empty)).toEqual({ serverTimeMs: 1, records: [] });
    writer.begin(2);
    writer.copyRecord(records, 0);
    writer.copyRecord(records, 2);
    const two = writer.finish();
    expect(two.length).toBe(WIRE.SNAPSHOT_HEADER_BYTES + 2 * WIRE.SNAPSHOT_RECORD_BYTES);
    writer.begin(3);
    writer.copyRecord(records, 1);
    writer.copyRecord(records, 1);
    expect(writer.finish()).toBe(two); // same view object for the same record count
    expect(two.buffer).toBe(empty.buffer);
    expect(snapshotTime(two)).toBe(3);
  });

  it('wraps serverTimeMs at 2^32', () => {
    const writer = createSnapshotWriter();
    writer.begin(4294967296 + 5);
    expect(snapshotTime(writer.finish())).toBe(5);
  });

  it('throws on misuse of the encoder side', () => {
    const records = new Uint8Array(2 * WIRE.SNAPSHOT_RECORD_BYTES);
    const writer = createSnapshotWriter({ maxRecords: 1 });
    writer.begin(0);
    for (const index of [2, -1, NaN]) expect(() => writer.copyRecord(records, index)).toThrow(RangeError);
    writer.copyRecord(records, 1);
    expect(() => writer.copyRecord(records, 0)).toThrow(RangeError); // full
    for (const at of [11, -1, NaN]) expect(() => encodePlayerRecord(1, state(), records, at)).toThrow(RangeError);
    for (const max of [-1, 1.5, 65536, NaN])
      expect(() => createSnapshotWriter({ maxRecords: max })).toThrow(RangeError);
  });

  it('returns null for malformed frames without calling the visitor', () => {
    const good = assemble(42, [
      { id: 1, state: state() },
      { id: 2, state: state() },
    ]);
    const wrongType = good.slice();
    wrongType[0] = WIRE.MSG_STATE;
    const wrongCount = good.slice();
    wrongCount[5] = 3;
    const badAnim = good.slice();
    badAnim[good.length - 1] = 0x0f;
    const cases = [new Uint8Array(0), good.subarray(0, 6), good.subarray(0, good.length - 1), wrongType, wrongCount];
    cases.push(badAnim, new Uint8Array([...good, 0]));
    let calls = 0;
    for (const bad of cases) {
      expect(decodeSnapshot(bad, () => calls++)).toBeNull();
      expect(snapshotTime(bad)).toBeNull();
    }
    expect(decodeSnapshot(null as unknown as Uint8Array, () => calls++)).toBeNull();
    expect(calls).toBe(0);
  });

  it('decodes frames that sit at an offset inside a larger buffer', () => {
    const good = assemble(42, [{ id: 9, state: state() }]);
    const padded = new Uint8Array(good.length + 8).fill(0xff);
    padded.set(good, 5);
    expect(collect(padded.subarray(5, 5 + good.length))).toEqual(collect(good));
    expect(collect(asBytes(new DataView(padded.buffer, 5, good.length)))).toEqual(collect(good));
    expect(collect(asBytes(good.slice().buffer))).toEqual(collect(good));
    expect(asBytes(good)).toBe(good);
  });
});
