// The interface shared by the online client and the offline session (#20, docs/CONTRACTS.md §8).
import type {
  ClientMessage,
  GrabKind,
  MatchConfig,
  PlayerState,
  RemoteState,
  RoomState,
  ServerMessage,
} from '@wobble/shared/types';

type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

/** `hello` without `t` and `v`; the session fills those (and the resume token) in. */
export type Hello = Omit<Extract<ClientMessage, { t: 'hello' }>, 't' | 'v'>;

export interface NetStats {
  rttMs: number;
  jitterMs: number;
  clockOffsetMs: number;
  kbInPerSec: number;
  kbOutPerSec: number;
  snapshotsPerSec: number;
  /** How far behind synced server time remote players are drawn, in ms. */
  renderDelayMs: number;
}

export interface NetEvents {
  welcome: { playerId: number; room: RoomState };
  room: RoomState;
  /** A roomPatch delta as received (after it was applied to `room`). */
  roomPatch: Msg<'roomPatch'>;
  /** Event mode (#54): theme vote tallies and the winner. */
  voteState: Msg<'voteState'>;
  voteResult: Msg<'voteResult'>;
  matchConfig: MatchConfig;
  countdown: { startAt: number };
  checkpoint: Msg<'checkpoint'>;
  correct: Msg<'correct'>;
  finished: Msg<'finished'>;
  raceEnd: Msg<'raceEnd'>;
  error: Msg<'error'>;
  /** Butterfly effect (#84) */
  grabbed: Msg<'grabbed'>;
  marked: Msg<'marked'>;
  storm: Msg<'storm'>;
  /** The villain throws at a marked player / hits you (only you, only if you are marked). */
  throw: Msg<'throw'>;
  hit: Msg<'hit'>;
  /** The hero opens a wind-sheltered bridge for you: you saved others and never pushed. */
  hero: Msg<'hero'>;
  /** Gun: the shots you hold now (after earning it, or after each shot). */
  gun: Msg<'gun'>;
  /** Gun: `by` shot `target` (to everyone); the target goes back to its last checkpoint. */
  shot: Msg<'shot'>;
  disconnect: { willReconnect: boolean };
  reconnect: { playerId: number };
}
export type NetEventName = keyof NetEvents;

export interface NetSession {
  connect(hello: Hello): void;
  on<E extends NetEventName>(evt: E, fn: (payload: NetEvents[E]) => void): () => void;
  disconnect(): void;
  sendState(state: PlayerState): void;
  /** Synced server time in ms. */
  serverNow(): number;
  /** Seconds since the race start (negative during the countdown, 0 before one). */
  raceTimeSec(): number;
  sampleRemote(): Map<number, RemoteState>;
  setSkin(skinId: string): void;
  setReady(ready: boolean): void;
  setConfig(cfg: { courseId: string; themeId: string }): void;
  start(): void;
  /** Event mode (#54): host starts the theme vote. */
  startVote(): void;
  /** Event mode (#54): vote for a theme option. */
  vote(themeId: string): void;
  sendLoaded(): void;
  /** Butterfly effect (#84): ask the server to push, save or help up `target`. `dir` is the unit xz vector toward the target. */
  grab(target: number, kind: GrabKind, dir: readonly [number, number]): void;
  /** Gun: fire at `target` (the nearest racer, picked by the client's auto-aim). */
  shoot(target: number): void;
  stats(): NetStats;
  readonly playerId: number | null;
  readonly room: RoomState | null;
  /** `welcome.event` in event mode, else null. */
  readonly welcomeEvent: Msg<'welcome'>['event'] | null;
}

/** Minimal typed event emitter. */
export function createEmitter() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  return {
    on<E extends NetEventName>(evt: E, fn: (payload: NetEvents[E]) => void): () => void {
      let set = handlers.get(evt);
      if (!set) handlers.set(evt, (set = new Set()));
      const f = fn as (p: unknown) => void;
      set.add(f);
      return () => set.delete(f);
    },
    emit<E extends NetEventName>(evt: E, payload: NetEvents[E]): void {
      const set = handlers.get(evt);
      if (set) for (const fn of set) fn(payload);
    },
  };
}
