// Types shared by the asset store modules (#24).
import type { EventManifest, MatchConfig, Pack, PackKind } from '@wobble/shared';

export type AssetErrorCode = 'rate_limited' | 'invalid' | 'unavailable' | 'network';

/** Typed failure of generate, list and report, so the lobby can show a fitting message. */
export class AssetError extends Error {
  readonly code: AssetErrorCode;
  /** Seconds to wait, only for `rate_limited`. */
  readonly retryAfterSec: number | null;

  constructor(code: AssetErrorCode, message: string, retryAfterSec: number | null = null) {
    super(message);
    this.name = 'AssetError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export type FallbackReason = 'not_found' | 'invalid' | 'timeout' | 'network' | 'unavailable' | 'unsupported';

export interface Fallback {
  id: string;
  reason: FallbackReason;
}

export interface PreloadReport {
  /** Distinct ids asked for. */
  requested: number;
  /** Ids that came back as the real pack (from memory, disk, built-ins or the network). */
  loaded: number;
  /** Ids that were replaced by the default pack of their kind. */
  fallbacks: Fallback[];
  /** True when the blocking part hit its hard timeout. */
  timedOut: boolean;
  /** Every requested id with the pack to use (the default pack for fallbacks). */
  packs: Record<string, Pack>;
}

export interface Preload {
  /** Course, theme and the local player's skin. The race can start when this resolves. */
  blocking: Promise<PreloadReport>;
  /** Every other player's skin. Never rejects. */
  background: Promise<PreloadReport>;
}

export interface PreloadOptions {
  /** Id of the local player in `matchConfig.players`; its skin is loaded in the blocking part. */
  localPlayerId?: number;
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

export interface AssetStoreOptions {
  /** Base URL of the pack API, without a trailing slash. Default: same origin. */
  apiBase?: string;
  /** Base URL of the static event packs. Default `/event`. */
  eventBase?: string;
  /** Replaces `fetch`, for tests. */
  fetch?: typeof fetch;
  /** Disk cache. `null` means memory only. Default: IndexedDB when it exists. */
  persistence?: PackPersistence | null;
  /** Where the anonymous client id lives. `null` keeps it in memory. Default: localStorage when it works. */
  storage?: ClientIdStorage | null;
  /** Per-request timeout. Default 8000 ms. */
  requestTimeoutMs?: number;
  /** Hard timeout of `preloadMatch(...).blocking`. Default 10000 ms. */
  blockingTimeoutMs?: number;
  /** Ids per batch request, at most 50. Default 50. */
  batchSize?: number;
  /** Requests in flight for the background preload. Default 6. */
  concurrency?: number;
  /** Packs kept in memory. Default 400. */
  memoryEntries?: number;
}

export interface ClientIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Disk cache for packs. Packs are immutable by id, so entries never expire. */
export interface PackPersistence {
  get(id: string): Promise<Pack | null>;
  put(pack: Pack): Promise<void>;
}

export interface AssetStore {
  /** Never rejects: any failure resolves to the default pack of `kind` (default `skin`). */
  getPack(id: string, kind?: PackKind): Promise<Pack>;
  preloadMatch(cfg: MatchConfig, opts?: PreloadOptions): Preload;
  /** Event mode: `/event/manifest.json`, validated; null when missing or invalid. */
  eventManifest(): Promise<EventManifest | null>;
  /** Lobby: the 5 vote cards at once, then each theme's `@0.5x` images. Never rejects. */
  prefetchLobby(): Promise<void>;
  /** On `voteResult`: the winning theme's full-resolution images. Never rejects. */
  voteResult(themeId: string): Promise<void>;
  list(kind: PackKind, cursor?: string | null): Promise<PackPage>;
  generate(kind: PackKind, prompt: string, opts?: { themeId?: string }): Promise<Pack>;
  report(id: string): Promise<void>;
  /** The anonymous id sent with generate and report. */
  clientId(): string;
  /** Fires when a pack arrives from disk or the network. Returns an unsubscribe function. */
  on(evt: 'pack', fn: (id: string, pack: Pack) => void): () => void;
}
