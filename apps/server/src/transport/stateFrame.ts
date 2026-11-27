// Decodes a client STATE frame (docs/CONTRACTS.md §6) into a reused IncomingState.
// Interim decoder until the shared codec (#17, packages/shared/src/protocol) lands; swap the import then.
import { POS_SCALE, WIRE } from '@wobble/shared/constants';
import type { AnimValue, IncomingState } from '@wobble/shared/types';

const TAU = Math.PI * 2;

/** One reusable target per decoder: the returned object is overwritten by the next decode. */
export function createStateDecoder(): (bytes: Uint8Array) => IncomingState | null {
  const out: IncomingState = {
    seq: 0,
    raceTimeMs: 0,
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    yaw: 0,
    anim: 0,
    grounded: false,
    checkpoint: -1,
    finished: false,
    respawned: false,
  };
  return (bytes) => {
    if (bytes.byteLength !== WIRE.STATE_BYTES || bytes[0] !== WIRE.MSG_STATE) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    out.seq = dv.getUint16(1, true);
    out.raceTimeMs = dv.getUint32(3, true);
    out.pos[0] = dv.getInt16(7, true) / POS_SCALE;
    out.pos[1] = dv.getInt16(9, true) / POS_SCALE;
    out.pos[2] = dv.getInt16(11, true) / POS_SCALE;
    out.yaw = (dv.getUint8(13) / 256) * TAU;
    const flags = dv.getUint8(14);
    out.anim = (flags & WIRE.ANIM_MASK) as AnimValue;
    out.grounded = (flags & WIRE.FLAG_GROUNDED) !== 0;
    out.finished = (flags & WIRE.FLAG_FINISHED) !== 0;
    out.respawned = (flags & WIRE.FLAG_RESPAWNED) !== 0;
    return out;
  };
}
