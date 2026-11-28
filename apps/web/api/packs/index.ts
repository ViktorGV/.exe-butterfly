// GET /api/packs?kind=&cursor=&limit= -> { items: [{ id, kind, name, swatch }], nextCursor }. Owned by #23.
// Newest first, flagged packs hidden. Short shared cache so a busy gallery does not hit the store every time.
import { PackKindSchema } from '@wobble/shared/schemas/packs';
import type { PackStore } from '@wobble/shared/types';
import { rateLimit } from '../_lib/ratelimit.ts';
import type { RateLimiter } from '../_lib/ratelimit.ts';
import { getPackStore } from '../_lib/store/index.ts';
import { cachedJson, invalid, LIST_CACHE, readGate, summarize } from '../_lib/store/http.ts';

export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 100;

export interface ListDeps {
  store: () => PackStore;
  rateLimit: RateLimiter;
  env?: Record<string, string | undefined>;
}

export function createListHandler(deps: ListDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const blocked = await readGate(request, deps.rateLimit, deps.env ?? process.env);
    if (blocked) return blocked;

    const params = new URL(request.url).searchParams;
    const kind = PackKindSchema.safeParse(params.get('kind'));
    if (!kind.success) return invalid();
    const cursor = params.get('cursor');
    if (cursor !== null && cursor.length > 200) return invalid();
    const asked = Number.parseInt(params.get('limit') ?? '', 10);
    const limit = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), MAX_LIMIT) : DEFAULT_LIMIT;

    const page = await deps.store().list({ kind: kind.data, cursor, limit });
    return cachedJson(request, { items: page.items.map(summarize), nextCursor: page.nextCursor }, LIST_CACHE);
  };
}

export const GET = createListHandler({ store: getPackStore, rateLimit });
