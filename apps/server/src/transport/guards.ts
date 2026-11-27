// Connection guards: origin allow-list, per-IP cap and backpressure policy.

export const BACKPRESSURE_DROP_BYTES = 256 * 1024;
export const BACKPRESSURE_KICK_BYTES = 1024 * 1024;

/** True when a WebSocket upgrade from `origin` may proceed. An empty list allows any origin. */
export function originAllowed(origin: string | null, host: string | null, allowed: readonly string[]): boolean {
  if (!origin || allowed.length === 0) return true;
  if (allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === host; // same-origin page
  } catch {
    return false;
  }
}

export interface IpCounter {
  /** Reserves a slot for `ip`; false when the cap is reached. */
  acquire(ip: string): boolean;
  release(ip: string): void;
}

export function createIpCounter(max: number): IpCounter {
  const counts = new Map<string, number>();
  return {
    acquire(ip) {
      const n = counts.get(ip) ?? 0;
      if (n >= max) return false;
      counts.set(ip, n + 1);
      return true;
    },
    release(ip) {
      const n = (counts.get(ip) ?? 0) - 1;
      if (n > 0) counts.set(ip, n);
      else counts.delete(ip);
    },
  };
}

export type SendVerdict = 'send' | 'drop' | 'kick';

/** Backpressure decision for a droppable frame (snapshots), from the socket's buffered bytes. */
export function backpressure(buffered: number): SendVerdict {
  if (buffered > BACKPRESSURE_KICK_BYTES) return 'kick';
  if (buffered > BACKPRESSURE_DROP_BYTES) return 'drop';
  return 'send';
}
