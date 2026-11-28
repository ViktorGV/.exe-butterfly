// POST /api/packs/:id/report { clientId } -> 204. One report per client per pack; after 3 reports the pack is hidden
// from listings (it stays fetchable by id). DELETE (ADMIN_TOKEN) clears the reports and shows it again. Owned by #23.
import { clientIp, rateLimit } from '../../_lib/ratelimit.ts';
import type { RateLimiter } from '../../_lib/ratelimit.ts';
import { getPackStore } from '../../_lib/store/index.ts';
import type { ApiPackStore } from '../../_lib/store/types.ts';
import { adminOnly, invalid, notFound, packIdOf, tooMany } from '../../_lib/store/http.ts';

export interface ReportDeps {
  store: () => ApiPackStore;
  rateLimit: RateLimiter;
  env?: Record<string, string | undefined>;
}

export function createReportHandler(deps: ReportDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const id = packIdOf(request);
    if (id instanceof Response) return id;

    const body = (await request.json().catch(() => null)) as { clientId?: unknown } | null;
    const clientId = body?.clientId;
    if (typeof clientId !== 'string' || clientId.length < 8 || clientId.length > 64) return invalid();

    const limit = await deps.rateLimit('report', { clientId, ip: clientIp(request) });
    if (!limit.ok) return tooMany(limit.retryAfterSec);

    const store = deps.store();
    if (!(await store.get(id))) return notFound();
    await store.report(id, clientId);
    return new Response(null, { status: 204 });
  };
}

export function createUnflagHandler(deps: ReportDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const denied = adminOnly(request, deps.env ?? process.env);
    if (denied) return denied;
    const id = packIdOf(request);
    if (id instanceof Response) return id;
    const store = deps.store();
    if (!(await store.get(id))) return notFound();
    await store.unflag(id);
    return new Response(null, { status: 204 });
  };
}

export const POST = createReportHandler({ store: getPackStore, rateLimit });
export const DELETE = createUnflagHandler({ store: getPackStore, rateLimit });
