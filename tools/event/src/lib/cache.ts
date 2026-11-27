// On-disk cache of AI results under tools/event/.cache/. Owned by #56, shared with #59 and #63.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256Hex, stableStringify } from './hash.ts';

/** What identifies one AI call. Two calls with the same parts return the cached answer. */
export interface CacheKeyParts {
  model: string;
  system: string;
  /** The exact prompt text sent (which contains the input). */
  input: string;
  /** JSON Schema of the expected output. */
  schema: unknown;
}

export interface CacheEntry {
  key: string;
  name: string;
  model: string;
  data: unknown;
  /** What the call cost when it was made. A cache hit costs $0. */
  costUsd: number;
}

export interface AiCache {
  get(key: string): Promise<CacheEntry | null>;
  set(entry: CacheEntry): Promise<void>;
}

/** sha256 of (model, system, input, schema) as hex. */
export function cacheKey(parts: CacheKeyParts): string {
  return sha256Hex(stableStringify(parts));
}

/** Default cache folder: tools/event/.cache (gitignored). */
export const DEFAULT_CACHE_DIR = join(import.meta.dir, '..', '..', '.cache');

/** One JSON file per call at `<dir>/<key[0..2]>/<key>.json`. Writes are atomic (temp file + rename). */
export function createAiCache(dir: string = DEFAULT_CACHE_DIR): AiCache {
  const pathFor = (key: string) => join(dir, key.slice(0, 2), `${key}.json`);
  return {
    async get(key) {
      try {
        const entry = JSON.parse(await readFile(pathFor(key), 'utf8')) as CacheEntry;
        return entry.key === key ? entry : null;
      } catch {
        return null;
      }
    },
    async set(entry) {
      const file = pathFor(entry.key);
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(tmp, JSON.stringify(entry, null, 2));
      await rename(tmp, file);
    },
  };
}

/** A cache that keeps nothing between runs (tests). */
export function createMemoryCache(): AiCache & { size(): number } {
  const map = new Map<string, CacheEntry>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (entry) => void map.set(entry.key, structuredClone(entry)),
    size: () => map.size,
  };
}
