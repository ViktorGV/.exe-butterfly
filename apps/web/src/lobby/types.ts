// Lobby (#12) seams: the subset of the net client and asset store the lobby needs.
import type { EventManifest, Pack, PackKind, RoomState, VoteResult, VoteState } from '@wobble/shared';
import type { RoomPatch } from './players.ts';

export type Unsubscribe = () => void;

/** `welcome.event` (event mode, #54). */
export interface WelcomeEvent {
  matched: boolean;
  previewSkins: Record<string, string> | null;
}

export interface LobbyNet {
  /** Our player id once welcomed, -1 before. */
  readonly playerId: number;
  /** Full room state (on welcome and on resync). */
  on(evt: 'room', fn: (room: RoomState) => void): Unsubscribe;
  /** A roomPatch delta. Optional: nets that only emit 'room' work too. */
  on(evt: 'roomPatch', fn: (patch: RoomPatch) => void): Unsubscribe;
  on(evt: 'vote', fn: (state: VoteState) => void): Unsubscribe;
  on(evt: 'voteResult', fn: (result: VoteResult) => void): Unsubscribe;
  setSkin(id: string): void;
  setReady(ready: boolean): void;
  setConfig(cfg: { courseId: string; themeId: string }): void;
  start(): void;
  startVote(): void;
  vote(themeId: string): void;
  /** Server clock in ms (for vote countdowns). Falls back to Date.now(). */
  serverNow?(): number;
  /** Event mode identity from `welcome.event`; absent outside event mode. */
  readonly welcomeEvent?: WelcomeEvent | null;
}

export interface PackSummary {
  id: string;
  kind: PackKind;
  name: string;
  swatch: string[];
}

export interface PackPage {
  items: PackSummary[];
  nextCursor: string | null;
}

/** Thrown (or rejected) by `assets.generate`. Mirrors the HTTP API: 422 refused, 429 + Retry-After, 503. */
export interface GenerateFailure {
  status: number;
  retryAfterSec?: number;
  message?: string;
}

export interface LobbyAssets {
  list(kind: PackKind, cursor: string | null): Promise<PackPage>;
  generate(kind: 'skin', prompt: string): Promise<Pack>;
  getPack(id: string): Promise<Pack | null>;
  report(id: string): Promise<void>;
  /** The event manifest, or null outside event mode. */
  eventManifest(): Promise<EventManifest | null>;
}

export interface Preview {
  el: HTMLElement;
  dispose(): void;
}

export interface LobbyOptions {
  net: LobbyNet;
  assets: LobbyAssets;
  previewFactory?: (skin: Pack | null, doc: Document) => Preview;
  minimapFactory?: (courseId: string, doc: Document) => Preview;
  /** Builds the invite link for a room code. */
  inviteLink?: (code: string) => string;
  /** Public rooms start the vote automatically, so the host gets no Start vote button. */
  publicRoom?: boolean;
  /** Show the prompt / Generate / Report part of the skin picker. Off by default (future feature). */
  generate?: boolean;
  /** Theme vote among `assets.eventManifest()` themes even outside event mode; the skin gallery stays. */
  vote?: boolean;
}
