// Wire protocol codec (#17). One implementation for the browser client, the game server and
// the load-test bots. Layouts: docs/CONTRACTS.md §6 and WIRE in constants.ts.
export { asBytes } from './bytes.ts';
export {
  INT16_MAX,
  INT16_MIN,
  POS_MAX,
  POS_MIN,
  dequantizePos,
  dequantizeYaw,
  flagsOf,
  isValidAnimFlags,
  packAnimFlags,
  quantizePos,
  quantizeYaw,
} from './quantize.ts';
export { decodeState, encodeState } from './state.ts';
export type { DecodedState, StateTarget, WireState } from './state.ts';
export { createSnapshotWriter, decodeSnapshot, encodePlayerRecord, snapshotTime } from './snapshot.ts';
export type { SnapshotVisitor, SnapshotWriter } from './snapshot.ts';
export {
  PROTOCOL_MISMATCH,
  SERVER_CONTROL_MAX_BYTES,
  checkProtocolVersion,
  controlMaxBytes,
  isProtocolSupported,
  parseClientControl,
  parseControl,
  parseServerControl,
  serializeControl,
} from './control.ts';
export type { ControlMessage, ControlSender } from './control.ts';
