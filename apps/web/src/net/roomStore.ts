// Local RoomState kept in step with `welcome` and `roomPatch` (docs/CONTRACTS.md §6).
import type { RoomPlayer, RoomState, ServerMessage } from '@wobble/shared/types';

export type RoomPatch = Extract<ServerMessage, { t: 'roomPatch' }>;

export interface RoomStore {
  readonly room: RoomState | null;
  reset(room: RoomState): void;
  /** Applies a patch. Returns false (and changes nothing) before the first reset. */
  apply(patch: RoomPatch): boolean;
  clear(): void;
}

export function createRoomStore(): RoomStore {
  let room: RoomState | null = null;

  function upsert(p: RoomPlayer): void {
    if (!room) return;
    const i = room.players.findIndex((q) => q.id === p.id);
    if (i >= 0) room.players[i] = { ...p };
    else room.players.push({ ...p });
  }

  return {
    get room() {
      return room;
    },
    reset(next) {
      room = { ...next, config: { ...next.config }, players: next.players.map((p) => ({ ...p })) };
    },
    apply(patch) {
      if (!room) return false;
      if (patch.left) {
        const gone = new Set(patch.left);
        room.players = room.players.filter((p) => !gone.has(p.id));
      }
      if (patch.joined) for (const p of patch.joined) upsert(p);
      if (patch.updated) {
        for (const u of patch.updated) {
          const p = room.players.find((q) => q.id === u.id);
          if (p) Object.assign(p, u);
        }
      }
      if (patch.phase) room.phase = patch.phase;
      if (patch.hostId !== undefined) room.hostId = patch.hostId;
      if (patch.config) room.config = { ...patch.config };
      return true;
    },
    clear() {
      room = null;
    },
  };
}
