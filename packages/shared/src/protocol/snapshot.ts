// S->C SNAPSHOT frame, type 0x02, 7 + 10 × count bytes (docs/CONTRACTS.md §6):
//   header  0 u8 type · 1 u32 serverTimeMs · 5 u16 count
//   record  0 u16 playerId · 2 i16 x · 4 i16 y · 6 i16 z · 8 u8 yaw · 9 u8 animFlags
import { MAX_PLAYERS_PER_ROOM, WIRE } from '../constants.ts';
import type { AnimValue } from '../types.ts';
import { readI16, readU16, readU32, writeU16, writeU32 } from './bytes.ts';
import {
  dequantizePos,
  dequantizeYaw,
  flagsOf,
  isValidAnimFlags,
  packAnimFlags,
  quantizePos,
  quantizeYaw,
} from './quantize.ts';
import type { WireState } from './state.ts';

const HEADER = WIRE.SNAPSHOT_HEADER_BYTES;
const REC = WIRE.SNAPSHOT_RECORD_BYTES;
const MAX_COUNT = 0xffff;

/**
 * Writes one 10-byte player record at `target[offset]` and returns the offset after it.
 * The server keeps one `Uint8Array(players × 10)`, encodes every player into it once per tick
 * and then builds each recipient's snapshot with `SnapshotWriter.copyRecord`.
 */
export function encodePlayerRecord(playerId: number, state: WireState, target: Uint8Array, offset: number): number {
  if (!(offset >= 0) || offset + REC > target.length) throw new RangeError('encodePlayerRecord: record out of range');
  const pos = state.pos;
  writeU16(target, offset, playerId);
  writeU16(target, offset + 2, quantizePos(pos[0]));
  writeU16(target, offset + 4, quantizePos(pos[1]));
  writeU16(target, offset + 6, quantizePos(pos[2]));
  target[offset + 8] = quantizeYaw(state.yaw);
  target[offset + 9] = packAnimFlags(state.anim, state.grounded, state.finished, state.respawned === true);
  return offset + REC;
}

export interface SnapshotWriter {
  /** Starts a new, empty snapshot. `serverTimeMs` is sent as u32 and wraps every 2^32 ms. */
  begin(serverTimeMs: number): void;
  /** Appends record number `index` of `source`, a buffer filled by `encodePlayerRecord`. */
  copyRecord(source: Uint8Array, index: number): void;
  /**
   * Returns the finished frame: a view of the writer's own buffer, exactly 7 + 10 × count bytes.
   * It is valid until the next `begin()`, so send it before starting the next snapshot.
   */
  finish(): Uint8Array;
  /** Records added since `begin()`. */
  readonly count: number;
  readonly maxRecords: number;
}

/**
 * Assembles SNAPSHOT frames with no allocation per frame: one buffer for the largest frame,
 * and one view per record count, created the first time that count is finished.
 */
export function createSnapshotWriter({
  maxRecords = MAX_PLAYERS_PER_ROOM,
}: { maxRecords?: number } = {}): SnapshotWriter {
  if (!Number.isInteger(maxRecords) || maxRecords < 0 || maxRecords > MAX_COUNT) {
    throw new RangeError('createSnapshotWriter: maxRecords must be an integer in 0..65535');
  }
  const buf = new Uint8Array(HEADER + maxRecords * REC);
  const views: (Uint8Array | undefined)[] = new Array(maxRecords + 1).fill(undefined);
  let count = 0;
  buf[0] = WIRE.MSG_SNAPSHOT;

  return {
    begin(serverTimeMs) {
      writeU32(buf, 1, serverTimeMs);
      count = 0;
    },
    copyRecord(source, index) {
      const from = index * REC;
      if (count >= maxRecords) throw new RangeError('SnapshotWriter: snapshot is full');
      if (!(index >= 0) || from + REC > source.length) throw new RangeError('SnapshotWriter: no such record');
      const to = HEADER + count * REC;
      buf[to] = source[from];
      buf[to + 1] = source[from + 1];
      buf[to + 2] = source[from + 2];
      buf[to + 3] = source[from + 3];
      buf[to + 4] = source[from + 4];
      buf[to + 5] = source[from + 5];
      buf[to + 6] = source[from + 6];
      buf[to + 7] = source[from + 7];
      buf[to + 8] = source[from + 8];
      buf[to + 9] = source[from + 9];
      count++;
    },
    finish() {
      writeU16(buf, 5, count);
      return (views[count] ??= buf.subarray(0, HEADER + count * REC));
    },
    get count() {
      return count;
    },
    maxRecords,
  };
}

/** Called once per record: position in metres, yaw in radians [-π, π), `flags` = WIRE.FLAG_* bits. */
export type SnapshotVisitor = (
  id: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  anim: AnimValue,
  flags: number,
) => void;

/** Record count of a well-formed frame, or -1. Every check a decoder needs is done here. */
function validCount(buf: Uint8Array): number {
  if (!(buf instanceof Uint8Array)) return -1;
  const len = buf.length;
  if (len < HEADER || buf[0] !== WIRE.MSG_SNAPSHOT) return -1;
  const count = readU16(buf, 5);
  if (len !== HEADER + count * REC) return -1;
  for (let o = HEADER + REC - 1; o < len; o += REC) if (!isValidAnimFlags(buf[o])) return -1;
  return count;
}

/** `serverTimeMs` of a well-formed SNAPSHOT frame, or `null`. Never throws. */
export function snapshotTime(buf: Uint8Array): number | null {
  return validCount(buf) < 0 ? null : readU32(buf, 1);
}

/**
 * Reads a SNAPSHOT frame: calls `visitor` once per record, in frame order, and returns the
 * frame's `serverTimeMs`. Nothing is allocated, so keep `visitor` in a variable instead of
 * writing a new closure per call; use `snapshotTime(buf)` when the visitor needs the time.
 *
 * Returns `null` without calling `visitor` unless `buf` is exactly one frame an encoder could
 * have produced: type 0x02, a length of 7 + 10 × count, known anims and no reserved bits.
 * It never throws on bad bytes (an error thrown by `visitor` itself does propagate).
 */
export function decodeSnapshot(buf: Uint8Array, visitor: SnapshotVisitor): number | null {
  const count = validCount(buf);
  if (count < 0) return null;
  const end = HEADER + count * REC;
  for (let o = HEADER; o < end; o += REC) {
    const animFlags = buf[o + 9];
    visitor(
      readU16(buf, o),
      dequantizePos(readI16(buf, o + 2)),
      dequantizePos(readI16(buf, o + 4)),
      dequantizePos(readI16(buf, o + 6)),
      dequantizeYaw(buf[o + 8]),
      (animFlags & WIRE.ANIM_MASK) as AnimValue,
      flagsOf(animFlags),
    );
  }
  return readU32(buf, 1);
}
