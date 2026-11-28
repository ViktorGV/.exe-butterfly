// Offline twin of the net client for solo practice (#20): same interface, local clock, no
// remote players. Checkpoint and finish come from the local controller; the app forwards them
// through reportCheckpoint / reportFinish.
import type { GrabKind, MatchConfig, PlayerState, RemoteState, RoomState } from '@wobble/shared/types';
import { createEmitter } from './session.ts';
import type { Hello, NetSession, NetStats } from './session.ts';

export interface OfflineSessionOptions {
  courseId: string;
  themeId: string;
  skinId: string;
  countdownMs?: number;
  now?: () => number;
  /** Delivers events on a later tick, like a socket would. Default queueMicrotask. */
  defer?: (fn: () => void) => void;
  /** Solo bots: receives the player's grabs (the local bots act on them). Default: grabs do nothing. */
  onGrab?: (target: number, kind: GrabKind, dir: readonly [number, number]) => void;
}

export const OFFLINE_PLAYER_ID = 0;

export interface OfflineSession extends NetSession {
  reportCheckpoint(index: number): void;
  reportFinish(): void;
}

export function createOfflineSession(cfg: OfflineSessionOptions): OfflineSession {
  const now = cfg.now ?? (() => performance.timeOrigin + performance.now());
  const defer = cfg.defer ?? queueMicrotask;
  const countdownMs = cfg.countdownMs ?? 3000;
  const ev = createEmitter();
  const remote = new Map<number, RemoteState>();
  const stats: NetStats = {
    rttMs: 0,
    jitterMs: 0,
    clockOffsetMs: 0,
    kbInPerSec: 0,
    kbOutPerSec: 0,
    snapshotsPerSec: 0,
    renderDelayMs: 0,
  };
  let room: RoomState | null = null;
  let startAt: number | null = null;
  let finished = false;

  const emitRoom = () => room && ev.emit('room', room);

  function raceTimeSec(): number {
    return startAt === null ? 0 : (now() - startAt) / 1000;
  }

  return {
    connect(hello: Hello) {
      room = {
        id: 'offline',
        code: 'SOLOO',
        phase: 'lobby',
        hostId: OFFLINE_PLAYER_ID,
        config: { courseId: cfg.courseId, themeId: cfg.themeId },
        players: [{ id: OFFLINE_PLAYER_ID, name: hello.name, skinId: cfg.skinId, ready: false, connected: true }],
      };
      defer(() => {
        if (!room) return;
        ev.emit('welcome', { playerId: OFFLINE_PLAYER_ID, room });
        emitRoom();
      });
    },
    on: ev.on,
    disconnect() {
      if (!room) return;
      room = null;
      startAt = null;
      ev.emit('disconnect', { willReconnect: false });
    },
    sendState(_s: PlayerState) {},
    startVote() {},
    vote(_themeId: string) {},
    welcomeEvent: null,
    serverNow: now,
    raceTimeSec,
    sampleRemote: () => remote,
    setSkin(skinId) {
      if (!room) return;
      room.players[0]!.skinId = skinId;
      emitRoom();
    },
    setReady(ready) {
      if (!room) return;
      room.players[0]!.ready = ready;
      emitRoom();
    },
    setConfig(c) {
      if (!room) return;
      room.config = { courseId: c.courseId, themeId: c.themeId };
      emitRoom();
    },
    start() {
      if (!room) return;
      const r = room;
      r.phase = 'loading';
      finished = false;
      const match: MatchConfig = {
        courseId: r.config.courseId,
        themeId: r.config.themeId,
        qualifyCount: 1,
        players: [{ id: OFFLINE_PLAYER_ID, slot: 0, skinId: r.players[0]!.skinId, name: r.players[0]!.name }],
      } as MatchConfig;
      defer(() => {
        emitRoom();
        ev.emit('matchConfig', match);
      });
    },
    grab(target, kind, dir) {
      if (startAt === null || finished || target === OFFLINE_PLAYER_ID) return;
      cfg.onGrab?.(target, kind, dir);
    },
    sendLoaded() {
      if (!room || room.phase !== 'loading') return;
      room.phase = 'countdown';
      startAt = now() + countdownMs;
      const at = startAt;
      defer(() => {
        emitRoom();
        ev.emit('countdown', { startAt: at });
      });
    },
    reportCheckpoint(index) {
      if (startAt === null || finished) return;
      ev.emit('checkpoint', { t: 'checkpoint', index });
    },
    reportFinish() {
      if (startAt === null || finished || !room) return;
      finished = true;
      const timeMs = Math.max(0, Math.round(raceTimeSec() * 1000));
      room.phase = 'results';
      ev.emit('finished', { t: 'finished', id: OFFLINE_PLAYER_ID, place: 1, timeMs });
      ev.emit('raceEnd', { t: 'raceEnd', results: [{ id: OFFLINE_PLAYER_ID, place: 1, timeMs, checkpoint: -1 }] });
      emitRoom();
    },
    stats: () => stats,
    get playerId() {
      return room ? OFFLINE_PLAYER_ID : null;
    },
    get room() {
      return room;
    },
  };
}
