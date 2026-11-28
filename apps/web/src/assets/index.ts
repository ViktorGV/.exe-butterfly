// Client asset store (#24). The single door to asset packs: built-in, generated or event.
export { createAssetStore } from './store.ts';
export { createIdbPersistence, loadClientId } from './persistence.ts';
export { AssetError } from './types.ts';
export type {
  AssetErrorCode,
  AssetStore,
  AssetStoreOptions,
  ClientIdStorage,
  Fallback,
  FallbackReason,
  PackPage,
  PackPersistence,
  PackSummary,
  Preload,
  PreloadOptions,
  PreloadReport,
} from './types.ts';
