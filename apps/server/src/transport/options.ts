// WebSocket limits and the slow-client-safe snapshot sender (#62, MP-5).
// Bun closes dead sockets and caps queued bytes for us; we only turn it on and drop snapshots
// for clients that already have a backlog, instead of queueing them.

export const DEFAULT_BACKPRESSURE_LIMIT = 256 * 1024;
export const DEFAULT_SOFT_LIMIT = 64 * 1024;
export const DEFAULT_IDLE_TIMEOUT_S = 30;

export interface WebSocketLimits {
  backpressureLimit: number;
  closeOnBackpressureLimit: boolean;
  idleTimeout: number;
  sendPings: boolean;
  perMessageDeflate: boolean;
}

/** Options to spread into the `websocket` object of Bun.serve. */
export function websocketOptions(overrides: Partial<WebSocketLimits> = {}): WebSocketLimits {
  return {
    backpressureLimit: DEFAULT_BACKPRESSURE_LIMIT,
    closeOnBackpressureLimit: true,
    idleTimeout: DEFAULT_IDLE_TIMEOUT_S,
    sendPings: true,
    perMessageDeflate: false,
    ...overrides,
  };
}

/** The part of Bun's ServerWebSocket that sendSnapshot uses. */
export interface SnapshotSocket {
  getBufferedAmount(): number;
  sendBinary(data: Uint8Array): number;
}

export interface SendSnapshotOptions {
  /** Skip the snapshot when more than this many bytes are already queued. */
  softLimit?: number;
  /** Called with the frame size when a snapshot is sent. */
  onSent?: (bytes: number) => void;
  /** Called when a snapshot is skipped (feed this into the per-room dropped counter). */
  onDrop?: () => void;
}

/** Sends one snapshot frame, or skips it if the client is behind. Returns true if it was sent. */
export function sendSnapshot(ws: SnapshotSocket, bytes: Uint8Array, opts: SendSnapshotOptions = {}): boolean {
  if (ws.getBufferedAmount() > (opts.softLimit ?? DEFAULT_SOFT_LIMIT)) {
    opts.onDrop?.();
    return false;
  }
  ws.sendBinary(bytes);
  opts.onSent?.(bytes.byteLength);
  return true;
}
