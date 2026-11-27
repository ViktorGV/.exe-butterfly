// Quantisation shared by STATE frames and SNAPSHOT records (docs/CONTRACTS.md §6):
//   pos       = round(metres × POS_SCALE) as int16
//   yaw       = round(yaw / 2π × 256) & 255
//   animFlags = anim | grounded<<4 | finished<<5 | respawned<<6
// Every function here is total: NaN and ±Infinity never throw and never leave the int range.
import { Anim, POS_SCALE, WIRE } from '../constants.ts';

export const INT16_MIN = -32768;
export const INT16_MAX = 32767;
/** Largest and smallest position (metres) that survive quantisation; anything beyond is clamped. */
export const POS_MAX = INT16_MAX / POS_SCALE;
export const POS_MIN = INT16_MIN / POS_SCALE;

const TWO_PI = Math.PI * 2;
const YAW_STEP = TWO_PI / 256;
const MAX_ANIM = Math.max(...Object.values(Anim));
/** Bits an encoder can set: a known flag or the anim nibble. Bit 7 is reserved and must be 0. */
const FLAGS_MASK = WIRE.FLAG_GROUNDED | WIRE.FLAG_FINISHED | WIRE.FLAG_RESPAWNED;
const USED_BITS = WIRE.ANIM_MASK | FLAGS_MASK;

/** Metres -> int16, clamped at the int16 limits. NaN becomes 0. */
export function quantizePos(metres: number): number {
  const q = Math.round(metres * POS_SCALE);
  return q > INT16_MAX ? INT16_MAX : q < INT16_MIN ? INT16_MIN : q | 0;
}

/** int16 -> metres. */
export function dequantizePos(q: number): number {
  return q / POS_SCALE;
}

/** Radians (any real value, any number of turns) -> 0..255. NaN and ±Infinity become 0. */
export function quantizeYaw(radians: number): number {
  return Math.round((radians / TWO_PI) * 256) & 255;
}

/** 0..255 -> radians in [-π, π). */
export function dequantizeYaw(byte: number): number {
  return (byte < 128 ? byte : byte - 256) * YAW_STEP;
}

export function packAnimFlags(anim: number, grounded: boolean, finished: boolean, respawned: boolean): number {
  return (
    (anim & WIRE.ANIM_MASK) |
    (grounded ? WIRE.FLAG_GROUNDED : 0) |
    (finished ? WIRE.FLAG_FINISHED : 0) |
    (respawned ? WIRE.FLAG_RESPAWNED : 0)
  );
}

/** True when an animFlags byte is one `packAnimFlags` can produce from a real `Anim` value. */
export function isValidAnimFlags(animFlags: number): boolean {
  return (animFlags & ~USED_BITS) === 0 && (animFlags & WIRE.ANIM_MASK) <= MAX_ANIM;
}

/** The WIRE.FLAG_* bits of an animFlags byte (what `RemoteState.flags` holds). */
export function flagsOf(animFlags: number): number {
  return animFlags & FLAGS_MASK;
}
