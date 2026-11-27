// Batches lobby changes into one `roomPatch` per window (#57, extends #18).
//
// Without batching every join / leave / ready change is one roomPatch to every player, so
// 100 players joining at once is ~10,000 messages. The room module feeds each change into a
// batcher and the batcher publishes at most one merged patch every `intervalMs`.
//
// Patch invariant: a player id appears in at most ONE of `joined`, `left` and `updated`, so a
// client can apply the three lists in any order and get the same RoomState.
import type { RoomPlayer, RoomState, ServerMessage } from '@wobble/shared/types';

/** z.infer of RoomPatchMsg, taken from the shared ServerMessage union. */
export type RoomPatch = Extract<ServerMessage, { t: 'roomPatch' }>;
export type RoomPlayerUpdate = NonNullable<RoomPatch['updated']>[number];
export type RoomPhase = RoomState['phase'];
export type RoomConfig = RoomState['config'];

export interface PatchBatcherOptions {
  /** Shortest time between two timed flushes. Default 200 ms. */
  intervalMs?: number;
  /** Sends one merged patch to the room topic. Never called with an empty patch. */
  publish(msg: RoomPatch): void;
  /** Injectable for tests. Default `setTimeout`. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** Injectable for tests. Default `clearTimeout`. */
  clearTimer?: (handle: unknown) => void;
}

export interface PatchBatcher {
  /** A player entered the room. Must not already be in the room. */
  join(player: RoomPlayer): void;
  /** A player left the room. */
  leave(id: number): void;
  /** Some fields of a player changed (ready, connected, skinId, ...). */
  update(change: RoomPlayerUpdate): void;
  /** Flushes at once for `loading` and `countdown` so the race start is never delayed. */
  setPhase(phase: RoomPhase): void;
  setHost(id: number): void;
  setConfig(config: RoomConfig): void;
  /** Publishes the pending patch now (if it has anything in it). */
  flush(): void;
  /** Cancels the timer and drops pending changes. Later calls are ignored. */
  dispose(): void;
}

/** Phases that must reach clients without waiting for the batch window. */
const URGENT_PHASES: ReadonlySet<RoomPhase> = new Set<RoomPhase>(['loading', 'countdown']);

export function createPatchBatcher(opts: PatchBatcherOptions): PatchBatcher {
  const intervalMs = opts.intervalMs ?? 200;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  // Pending changes since the last flush, relative to the state clients last saw:
  // - joined:  players new to clients (full entries)
  // - left:    players clients know about who are now gone
  // - updated: changed fields of players clients know about (a full entry after a rejoin)
  const joined = new Map<number, RoomPlayer>();
  const left = new Set<number>();
  const updated = new Map<number, RoomPlayerUpdate>();
  let phase: RoomPhase | undefined;
  let hostId: number | undefined;
  let config: RoomConfig | undefined;

  let timer: unknown = null;
  let disposed = false;

  function schedule(): void {
    if (timer === null && !disposed) {
      timer = setTimer(() => {
        timer = null;
        flush();
      }, intervalMs);
    }
  }

  function join(player: RoomPlayer): void {
    if (disposed) return;
    const entry = { ...player };
    if (left.delete(player.id)) {
      // Left and came back in the same window: clients still have the old entry, so send
      // the whole new entry as an update instead of a left + joined pair.
      updated.set(player.id, entry);
    } else {
      joined.set(player.id, entry);
    }
    schedule();
  }

  function leave(id: number): void {
    if (disposed) return;
    // Joined in this window: clients never saw it, so the join and the leave cancel out.
    if (!joined.delete(id)) {
      updated.delete(id);
      left.add(id);
    }
    schedule();
  }

  function update(change: RoomPlayerUpdate): void {
    if (disposed || left.has(change.id)) return; // changes to a departed player are moot
    const target = joined.get(change.id) ?? updated.get(change.id);
    if (target) {
      assignDefined(target, change);
    } else {
      updated.set(change.id, assignDefined({ id: change.id }, change));
    }
    schedule();
  }

  function setPhase(next: RoomPhase): void {
    if (disposed) return;
    phase = next;
    if (URGENT_PHASES.has(next)) flush();
    else schedule();
  }

  function setHost(id: number): void {
    if (disposed) return;
    hostId = id;
    schedule();
  }

  function setConfig(next: RoomConfig): void {
    if (disposed) return;
    config = { ...next };
    schedule();
  }

  function flush(): void {
    if (disposed) return;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    const msg: RoomPatch = { t: 'roomPatch' };
    if (joined.size > 0) msg.joined = [...joined.values()];
    if (left.size > 0) msg.left = [...left];
    if (updated.size > 0) msg.updated = [...updated.values()];
    if (phase !== undefined) msg.phase = phase;
    if (hostId !== undefined) msg.hostId = hostId;
    if (config !== undefined) msg.config = config;
    clearPending();
    if (Object.keys(msg).length > 1) opts.publish(msg); // never send just `{ t }`
  }

  function clearPending(): void {
    joined.clear();
    left.clear();
    updated.clear();
    phase = undefined;
    hostId = undefined;
    config = undefined;
  }

  function dispose(): void {
    if (timer !== null) clearTimer(timer);
    timer = null;
    disposed = true;
    clearPending();
  }

  return { join, leave, update, setPhase, setHost, setConfig, flush, dispose };
}

/** Object.assign that skips `undefined` values, so a partial never erases a field. */
function assignDefined<T extends object>(target: T, src: object): T {
  for (const [k, v] of Object.entries(src)) {
    if (v !== undefined) (target as Record<string, unknown>)[k] = v;
  }
  return target;
}
