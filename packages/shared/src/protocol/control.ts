// JSON control frames `{ t, ...payload }` (docs/CONTRACTS.md §6). The schemas are the frozen
// ones in schemas/protocol.ts; this file only adds the size cap, JSON handling and direction.
import { PROTOCOL_VERSION, WIRE } from '../constants.ts';
import { ClientMessageSchema, ServerMessageSchema } from '../schemas/protocol.ts';
import type { ClientMessage, ServerMessage } from '../types.ts';

export type ControlMessage = ClientMessage | ServerMessage;
/** Who wrote the frame. A server parses `'client'` frames, a browser or bot parses `'server'` frames. */
export type ControlSender = 'client' | 'server';

/**
 * Size cap for server -> client frames. `WIRE.CONTROL_MAX_BYTES` (4 KB) is enforced on what
 * clients send, but `welcome`, `matchConfig` and `raceEnd` list every player, so a full room
 * of 300 needs roughly 30 KB (see README.md). This cap only stops a runaway frame.
 */
export const SERVER_CONTROL_MAX_BYTES = 128 * 1024;

const CLIENT_TYPES: ReadonlySet<string> = new Set(ClientMessageSchema.options.map((o) => o.shape.t.value));

export function controlMaxBytes(from: ControlSender): number {
  return from === 'client' ? WIRE.CONTROL_MAX_BYTES : SERVER_CONTROL_MAX_BYTES;
}

/** Bytes `text` takes as a UTF-8 text frame, without encoding it. */
export function utf8ByteLength(text: string): number {
  const len = text.length;
  let bytes = len;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) bytes += 1;
    else if (c >= 0xd800 && c <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 2; // surrogate pair: 4 bytes for 2 code units
      i++;
    } else bytes += 2; // 3 bytes; a lone surrogate is sent as U+FFFD, also 3 bytes
  }
  return bytes;
}

function fits(text: string, maxBytes: number): boolean {
  // every code unit is at least 1 and at most 3 bytes, so most frames need no counting
  return text.length <= maxBytes && (text.length * 3 <= maxBytes || utf8ByteLength(text) <= maxBytes);
}

/**
 * Parses and validates one control frame written by `from`. Returns `null`, and never throws,
 * when the frame is over the size cap, is not JSON, has an unknown `t` (including a message
 * type of the other direction) or fails its schema. Fields the schema does not name are dropped.
 */
export function parseControl(text: string, from: 'client', maxBytes?: number): ClientMessage | null;
export function parseControl(text: string, from: 'server', maxBytes?: number): ServerMessage | null;
export function parseControl(text: string, from: ControlSender, maxBytes?: number): ControlMessage | null;
export function parseControl(
  text: string,
  from: ControlSender,
  maxBytes = controlMaxBytes(from),
): ControlMessage | null {
  if (typeof text !== 'string' || !fits(text, maxBytes)) return null;
  try {
    const result = (from === 'client' ? ClientMessageSchema : ServerMessageSchema).safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null; // not JSON, or nested too deeply to parse
  }
}

/** Server side: a frame received from a client (4 KB cap). */
export function parseClientControl(text: string): ClientMessage | null {
  return parseControl(text, 'client');
}

/** Client side: a frame received from the server. */
export function parseServerControl(text: string): ServerMessage | null {
  return parseControl(text, 'server');
}

/**
 * Validates `msg` against its schema and returns the text frame, without any field the schema
 * does not name. A message that is invalid or over the size cap is a bug in the caller, so
 * this throws (`TypeError` / `RangeError`) instead of sending something the other side drops.
 */
export function serializeControl(msg: ControlMessage): string {
  const from: ControlSender = CLIENT_TYPES.has(msg?.t) ? 'client' : 'server';
  const result = (from === 'client' ? ClientMessageSchema : ServerMessageSchema).safeParse(msg);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
    throw new TypeError(`serializeControl: invalid '${String(msg?.t)}' message${where}: ${issue?.message}`);
  }
  const text = JSON.stringify(result.data);
  if (!fits(text, controlMaxBytes(from))) {
    throw new RangeError(`serializeControl: '${result.data.t}' is over ${controlMaxBytes(from)} bytes`);
  }
  return text;
}

type ErrorMessage = Extract<ServerMessage, { t: 'error' }>;

/** `error.code` a server sends when a `hello` carries another protocol version. */
export const PROTOCOL_MISMATCH = 'protocol_mismatch';

export function isProtocolSupported(v: unknown): boolean {
  return v === PROTOCOL_VERSION;
}

/**
 * Handshake check for `hello.v`: `null` when the client speaks this build's protocol,
 * otherwise the `error` message to send before closing the socket.
 */
export function checkProtocolVersion(v: unknown): ErrorMessage | null {
  if (isProtocolSupported(v)) return null;
  const theirs = typeof v === 'number' ? `v${v}` : 'an unknown version';
  return {
    t: 'error',
    code: PROTOCOL_MISMATCH,
    msg: `protocol mismatch: client speaks ${theirs}, server speaks v${PROTOCOL_VERSION}. Reload the page.`,
  };
}
