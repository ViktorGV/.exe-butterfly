// Room player store (#12): applies roomPatch deltas and reports which rows changed.
import type { RoomPlayer, RoomState } from '@wobble/shared';

export interface RoomPatch {
  joined?: RoomPlayer[];
  left?: number[];
  updated?: (Partial<RoomPlayer> & { id: number })[];
  phase?: RoomState['phase'];
  hostId?: number;
  config?: RoomState['config'];
}

export interface PatchResult {
  /** ids whose row must be redrawn */
  changed: number[];
  /** true when rows were added or removed (list order changed) */
  orderChanged: boolean;
}

export interface PlayerStore {
  readonly order: readonly number[];
  readonly size: number;
  get(id: number): RoomPlayer | undefined;
  readyCount(): number;
  reset(players: readonly RoomPlayer[]): void;
  apply(patch: RoomPatch): PatchResult;
}

export function createPlayerStore(): PlayerStore {
  const byId = new Map<number, RoomPlayer>();
  let order: number[] = [];
  let ready = 0;

  return {
    get order() {
      return order;
    },
    get size() {
      return order.length;
    },
    get: (id) => byId.get(id),
    readyCount: () => ready,
    reset(players) {
      byId.clear();
      ready = 0;
      order = [];
      for (const p of players) {
        if (byId.has(p.id)) continue;
        byId.set(p.id, { ...p });
        order.push(p.id);
        if (p.ready) ready++;
      }
    },
    apply(patch) {
      const changed: number[] = [];
      let orderChanged = false;
      if (patch.left?.length) {
        const gone = new Set<number>();
        for (const id of patch.left) {
          const p = byId.get(id);
          if (!p) continue;
          if (p.ready) ready--;
          byId.delete(id);
          gone.add(id);
        }
        if (gone.size) {
          order = order.filter((id) => !gone.has(id));
          orderChanged = true;
        }
      }
      for (const p of patch.joined ?? []) {
        const prev = byId.get(p.id);
        if (prev?.ready) ready--;
        if (!prev) {
          order.push(p.id);
          orderChanged = true;
        }
        byId.set(p.id, { ...p });
        if (p.ready) ready++;
        changed.push(p.id);
      }
      for (const u of patch.updated ?? []) {
        const p = byId.get(u.id);
        if (!p) continue;
        if (u.ready !== undefined && u.ready !== p.ready) ready += u.ready ? 1 : -1;
        Object.assign(p, u);
        changed.push(u.id);
      }
      return { changed, orderChanged };
    },
  };
}

/** Folds a patch into a room snapshot's non-player fields. */
export function applyRoomFields(room: RoomState, patch: RoomPatch): void {
  if (patch.phase) room.phase = patch.phase;
  if (patch.hostId !== undefined) room.hostId = patch.hostId;
  if (patch.config) room.config = { ...patch.config };
}

/** A row window over a long list: which indexes to draw for a scroll offset. */
export function visibleRange(
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  count: number,
  overscan = 4,
): { start: number; end: number } {
  const start = Math.max(0, Math.min(count, Math.floor(scrollTop / rowHeight) - overscan));
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { start, end: Math.max(start, end) };
}
