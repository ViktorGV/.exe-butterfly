// GET /api/packs/batch?ids=a,b,c -> { packs, missing } (at most 50 ids). Owned by #23.
// Used by the game server and by clients preloading a whole lobby's skins in one request.
import { BATCH_MAX_IDS } from '@wobble/shared/schemas/api';
import { rateLimit } from '../_lib/ratelimit.ts';
import type { RateLimiter } from '../_lib/ratelimit.ts';
import { getPackStore } from '../_lib/store/index.ts';
import type { ApiPackStore } from '../_lib/store/types.ts';
import { cachedJson, IMMUTABLE, invalid, isStored, readGate } from '../_lib/store/http.ts';

export interface BatchDeps {
  store: () => ApiPackStore;
  rateLimit: RateLimiter;
  env?: Record<string, string | undefined>;
}

export function createBatchHandler(deps: BatchDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const blocked = await readGate(request, deps.rateLimit, deps.env ?? process.env);
    if (blocked) return blocked;

    const raw = new URL(request.url).searchParams.get('ids') ?? '';
    const ids = [
      ...new Set(
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (ids.length === 0 || ids.length > BATCH_MAX_IDS) return invalid();

    // Ids that can never be stored (built-in, event, procedural, malformed) are missing, without a store lookup.
    const stored = ids.filter(isStored);
    const found = await deps.store().getMany(stored);
    const missing = ids.filter((id) => !isStored(id) || found.missing.includes(id));

    // A missing id may be written later, so only a complete answer is cached for good.
    const cache = missing.length === 0 ? IMMUTABLE : 'no-store';
    return cachedJson(request, { packs: found.packs, missing }, cache);
  };
}

export const GET = createBatchHandler({ store: getPackStore, rateLimit });
