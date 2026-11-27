// C->S STATE frame, type 0x01, 15 bytes (docs/CONTRACTS.md §6):
//   0 u8 type · 1 u16 seq · 3 u32 raceTimeMs · 7 i16 x · 9 i16 y · 11 i16 z · 13 u8 yaw · 14 u8 animFlags
import { WIRE } from '../constants.ts';
import type { AnimValue, Vec3 } from '../types.ts';
import { readI16, readU16, readU32, writeU16, writeU32 } from './bytes.ts';
import { dequantizePos, dequantizeYaw, isValidAnimFlags, packAnimFlags, quantizePos, quantizeYaw } from './quantize.ts';

const U32_MAX = 0xffffffff;

/** The part of a player's state that goes on the wire. `PlayerState` and `IncomingState` both fit. */
export interface WireState {
  pos: Vec3;
  yaw: number;
  anim: AnimValue;
  grounded: boolean;
  finished: boolean;
  /** true on the first frame after a respawn, so receivers snap instead of interpolating */
  respawned?: boolean;
}

/** What `decodeState` fills in. An `IncomingState` fits; its `vel` and `checkpoint` are left alone. */
export interface StateTarget extends WireState {
  seq: number;
  raceTimeMs: number;
}

export interface DecodedState extends StateTarget {
  respawned: boolean;
}

/**
 * Writes a STATE frame into `out[0..15)` and returns `out`. Pass a reused 15-byte array to
 * allocate nothing; without `out` a new array is created.
 *
 * `seq` wraps at 65536. `raceTimeMs` is rounded and clamped to 0..2^32-1, so the negative race
 * time of the countdown is sent as 0. Positions are clamped at the int16 limits.
 */
export function encodeState(state: WireState, seq: number, raceTimeMs: number, out?: Uint8Array): Uint8Array {
  const b = out ?? new Uint8Array(WIRE.STATE_BYTES);
  if (b.length < WIRE.STATE_BYTES) throw new RangeError(`encodeState: out needs ${WIRE.STATE_BYTES} bytes`);
  const ms = Math.round(raceTimeMs);
  const pos = state.pos;
  b[0] = WIRE.MSG_STATE;
  writeU16(b, 1, seq);
  writeU32(b, 3, ms > 0 ? (ms < U32_MAX ? ms : U32_MAX) : 0);
  writeU16(b, 7, quantizePos(pos[0]));
  writeU16(b, 9, quantizePos(pos[1]));
  writeU16(b, 11, quantizePos(pos[2]));
  b[13] = quantizeYaw(state.yaw);
  b[14] = packAnimFlags(state.anim, state.grounded, state.finished, state.respawned === true);
  return b;
}

function newState(): DecodedState {
  return { seq: 0, raceTimeMs: 0, pos: [0, 0, 0], yaw: 0, anim: 0, grounded: false, finished: false, respawned: false };
}

/**
 * Reads a STATE frame. Returns `null`, without touching `out`, unless `buf` is exactly one
 * frame an encoder could have produced: 15 bytes, type 0x01, a known anim and no reserved bit.
 * It never throws. Pass a reused `out` to allocate nothing.
 */
export function decodeState(buf: Uint8Array): DecodedState | null;
export function decodeState<T extends StateTarget>(buf: Uint8Array, out: T): T | null;
export function decodeState(buf: Uint8Array, out?: StateTarget): StateTarget | null {
  if (!(buf instanceof Uint8Array) || buf.length !== WIRE.STATE_BYTES || buf[0] !== WIRE.MSG_STATE) return null;
  const animFlags = buf[14];
  if (!isValidAnimFlags(animFlags)) return null;
  const s: StateTarget = out ?? newState();
  s.seq = readU16(buf, 1);
  s.raceTimeMs = readU32(buf, 3);
  s.pos[0] = dequantizePos(readI16(buf, 7));
  s.pos[1] = dequantizePos(readI16(buf, 9));
  s.pos[2] = dequantizePos(readI16(buf, 11));
  s.yaw = dequantizeYaw(buf[13]);
  s.anim = (animFlags & WIRE.ANIM_MASK) as AnimValue;
  s.grounded = (animFlags & WIRE.FLAG_GROUNDED) !== 0;
  s.finished = (animFlags & WIRE.FLAG_FINISHED) !== 0;
  s.respawned = (animFlags & WIRE.FLAG_RESPAWNED) !== 0;
  return s;
}
