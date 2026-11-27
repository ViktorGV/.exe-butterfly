// Bun WebSocket limits and the snapshot send policy (#62).
// Bun enforces the hard limit (`backpressureLimit` + `closeOnBackpressureLimit`) and the idle timeout;
// `sendSnapshot` adds a soft limit below it so a slow client loses snapshots instead of queueing them.

export const WS_DEFAULTS = Object.freeze({
  /** hard limit: a client with more than this buffered is closed */
  backpressureLimit: 256 * 1024,
  /** soft limit: above this buffered amount, snapshots for the client are skipped */
  softLimit: 64 * 1024,
  /** seconds of silence (pongs count) before Bun closes the socket */
  idleTimeout: 30,
});

export interface WebSocketLimits {
  backpressureLimit?: number;
  idleTimeout?: number;
}

/** The limit options to spread into the `websocket` object given to `Bun.serve`. */
export function websocketOptions({
  backpressureLimit = WS_DEFAULTS.backpressureLimit,
  idleTimeout = WS_DEFAULTS.idleTimeout,
}: WebSocketLimits = {}) {
  return {
    backpressureLimit,
    closeOnBackpressureLimit: true,
    idleTimeout,
    sendPings: true,
    perMessageDeflate: false,
  };
}

/** True when a snapshot should be skipped for a socket with `buffered` bytes waiting. */
export const overSoftLimit = (buffered: number, softLimit = WS_DEFAULTS.softLimit): boolean => buffered > softLimit;

export interface SnapshotSocket {
  send(data: string | Uint8Array): unknown;
  getBufferedAmount(): number;
}

/** Sends `bytes` unless the socket is backed up. Returns false when the snapshot was dropped. */
export function sendSnapshot(
  ws: SnapshotSocket,
  bytes: string | Uint8Array,
  softLimit = WS_DEFAULTS.softLimit,
): boolean {
  if (overSoftLimit(ws.getBufferedAmount(), softLimit)) return false;
  ws.send(bytes);
  return true;
}
