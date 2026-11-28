// Reconnect grace policy (#66, MP-6): how long a dropped player keeps their seat.
// The room keeps the Member (id, token, slot) and the race session keeps position and checkpoint
// (setConnected only flips a flag), so a hello with the same token re-attaches to the same player.
// This module only decides how long to wait before giving the seat up, which depends on the phase.

/** Grace period in the lobby, where nothing is lost by leaving (default 5 s). */
export const DEFAULT_LOBBY_GRACE_MS = 5000;

export interface GraceTimings {
  /** Grace while loading, in the countdown and during the race (default 15 s in DEFAULT_TIMINGS). */
  reconnectMs: number;
  /** Grace in the lobby; defaults to 5 s and is never longer than `reconnectMs`. */
  lobbyReconnectMs?: number;
}

/** How long a player who disconnects while the room is in `phase` keeps their seat, in ms. */
export function graceMs(phase: string, timings: GraceTimings): number {
  if (phase !== 'lobby') return timings.reconnectMs;
  return Math.min(timings.lobbyReconnectMs ?? DEFAULT_LOBBY_GRACE_MS, timings.reconnectMs);
}
