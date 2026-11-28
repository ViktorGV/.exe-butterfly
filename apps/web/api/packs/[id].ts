// GET /api/packs/:id -> Pack (immutable, cached for a year); DELETE /api/packs/:id deletes it (ADMIN_TOKEN). Owned by #23.
// A pack hidden after reports is still served by id, so a running match does not break.
import { rateLimit } from '../_lib/ratelimit.ts';
import type { RateLimiter } from '../_lib/ratelimit.ts';
import { getPackStore } from '../_lib/store/index.ts';
import type { ApiPackStore } from '../_lib/store/types.ts';
import { adminOnly, cachedJson, IMMUTABLE, notFound, packIdOf, readGate } from '../_lib/store/http.ts';

export interface PackDeps {
  store: () => ApiPackStore;
  rateLimit: RateLimiter;
  env?: Record<string, string | undefined>;
}

export function createGetHandler(deps: PackDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const blocked = await readGate(request, deps.rateLimit, deps.env ?? process.env);
    if (blocked) return blocked;
    const id = packIdOf(request);
    if (id instanceof Response) return id;
    const pack = await deps.store().get(id);
    return pack ? cachedJson(request, pack, IMMUTABLE) : notFound();
  };
}

export function createDeleteHandler(deps: PackDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const denied = adminOnly(request, deps.env ?? process.env);
    if (denied) return denied;
    const id = packIdOf(request);
    if (id instanceof Response) return id;
    return (await deps.store().remove(id)) ? new Response(null, { status: 204 }) : notFound();
  };
}

export const GET = createGetHandler({ store: getPackStore, rateLimit });
export const DELETE = createDeleteHandler({ store: getPackStore, rateLimit });
