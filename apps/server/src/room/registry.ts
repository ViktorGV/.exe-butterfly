// All rooms of one server: quick play, private codes, reconnect lookup, empty-room collection.
import { ROOM_PHASES } from '@wobble/shared/constants';
import type { ServerMetrics } from '../metrics/index.ts';
import type { ResolveCourse } from './courses.ts';
import { createRoom } from './room.ts';
import type { Member, Room, RoomTimings } from './room.ts';

export interface RoomSummary {
  rooms: number;
  players: number;
  byPhase: Record<string, number>;
}

export interface RoomRegistryOptions {
  maxPlayers: number;
  timings: RoomTimings;
  resolveCourse: ResolveCourse;
  publish(topic: string, data: string): void;
  metrics?: ServerMetrics;
  random?: () => number;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function createRoomRegistry(opts: RoomRegistryOptions) {
  const rooms = new Map<string, Room>(); // by code
  const random = opts.random ?? Math.random;
  let nextRoomId = 1;
  let draining = false;

  function newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += LETTERS[Math.floor(random() * LETTERS.length)];
      if (!rooms.has(c)) return c;
    }
  }

  function create(isPublic: boolean): Room | null {
    if (draining) return null;
    const code = newCode();
    const room = createRoom({
      id: `r${nextRoomId++}`,
      code,
      isPublic,
      maxPlayers: opts.maxPlayers,
      timings: opts.timings,
      resolveCourse: opts.resolveCourse,
      publish: opts.publish,
      metrics: opts.metrics,
      onEmpty: (r) => {
        if (rooms.get(r.code) === r) rooms.delete(r.code);
      },
    });
    rooms.set(code, room);
    return room;
  }

  /**
   * The fullest public room with space, in any phase (a newcomer to a running room waits for the next
   * round); a lobby wins ties. A new public room only when no public room has space.
   */
  function quick(): Room | null {
    let best: Room | null = null;
    for (const r of rooms.values()) {
      if (!r.isPublic || r.size === 0 || !r.hasSpace()) continue;
      if (!best || r.size > best.size || (r.size === best.size && r.phase === 'lobby' && best.phase !== 'lobby'))
        best = r;
    }
    return best ?? create(true);
  }

  function findToken(token: string): { room: Room; member: Member } | null {
    for (const room of rooms.values()) {
      const member = room.findToken(token);
      if (member) return { room, member };
    }
    return null;
  }

  function summary(): RoomSummary {
    const byPhase: Record<string, number> = {};
    for (const p of ROOM_PHASES) byPhase[p] = 0;
    let players = 0;
    for (const r of rooms.values()) {
      players += r.size;
      byPhase[r.phase] = (byPhase[r.phase] ?? 0) + 1;
    }
    return { rooms: rooms.size, players, byPhase };
  }

  return {
    create,
    quick,
    byCode: (code: string) => rooms.get(code) ?? null,
    findToken,
    summary,
    rooms: () => rooms.values(),
    get size() {
      return rooms.size;
    },
    get draining() {
      return draining;
    },
    /** Stop creating rooms (SIGTERM). Existing rooms keep running. */
    startDraining() {
      draining = true;
    },
    dispose() {
      for (const r of rooms.values()) r.dispose();
      rooms.clear();
    },
  };
}

export type RoomRegistry = ReturnType<typeof createRoomRegistry>;
