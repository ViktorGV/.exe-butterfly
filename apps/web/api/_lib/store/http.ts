// Shared HTTP helpers for the pack routes (#23): cache headers, ETags, CORS, summaries and the read limit.
import { createHash } from 'node:crypto';
import { skinSwatch, themeSwatch } from '@wobble/shared/assets/index';
import { PackIdSchema } from '@wobble/shared/schemas/common';
import type { Pack, SkinDef, ThemeDef } from '@wobble/shared/types';
import { bearerMatches, clientIp } from '../ratelimit.ts';
import type { RateLimiter } from '../ratelimit.ts';

export const CORS_GET = { 'Access-Control-Allow-Origin': '*' };
/** Packs are immutable once written, so clients and CDNs may keep them for good. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const LIST_CACHE = 'public, s-maxage=10, stale-while-revalidate=60';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

export const notFound = () => json({ error: 'not_found' }, 404, { 'Cache-Control': 'no-store', ...CORS_GET });
export const invalid = () => json({ error: 'invalid' }, 422, CORS_GET);

export function tooMany(retryAfterSec: number): Response {
  const wait = String(Math.max(1, Math.ceil(retryAfterSec)));
  return json({ error: 'rate_limited' }, 429, { 'Retry-After': wait, 'Cache-Control': 'no-store', ...CORS_GET });
}

/** A strong ETag of the response body. */
export const etagOf = (text: string) => `"${createHash('sha1').update(text).digest('base64url').slice(0, 27)}"`;

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((v) => {
    const t = v.trim();
    return t === '*' || t.replace(/^W\//, '') === etag;
  });
}

/** 200 with Cache-Control and ETag, or an empty 304 when the caller already has this body. */
export function cachedJson(request: Request, body: unknown, cacheControl: string): Response {
  const text = JSON.stringify(body);
  const etag = etagOf(text);
  const headers = { ...CORS_GET, 'Cache-Control': cacheControl, ETag: etag };
  if (etagMatches(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers });
  return new Response(text, {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Up to six colours for a gallery card. Courses have none. */
export function swatchOf(pack: Pack): string[] {
  if (pack.kind === 'skin') return skinSwatch(pack.data as SkinDef).colors.slice(0, 6);
  if (pack.kind === 'theme') {
    const s = themeSwatch(pack.data as ThemeDef);
    return [...s.sky, ...s.colors].slice(0, 6);
  }
  return [];
}

export const summarize = (pack: Pack) => ({ id: pack.id, kind: pack.kind, name: pack.name, swatch: swatchOf(pack) });

/** Only generated packs (g:) live in the store. Built-in, event and procedural ids resolve in the client. */
export const isStored = (id: string) => id.startsWith('g:');

/** The `:id` the router put in the query string, or a response to send instead (422 malformed, 404 not stored here). */
export function packIdOf(request: Request): string | Response {
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !PackIdSchema.safeParse(id).success) return invalid();
  return isStored(id) ? id : notFound();
}

/**
 * The read limit. The game server (WOBBLE_SERVER_TOKEN) is exempt: it fetches packs on behalf of a whole room.
 * Returns a 429 response to send, or null to carry on.
 */
export async function readGate(
  request: Request,
  limiter: RateLimiter,
  env: Record<string, string | undefined>,
): Promise<Response | null> {
  if (bearerMatches(request.headers.get('authorization'), env.WOBBLE_SERVER_TOKEN)) return null;
  const limit = await limiter('read', { ip: clientIp(request) });
  return limit.ok ? null : tooMany(limit.retryAfterSec);
}

/** Admin calls carry `Authorization: Bearer <ADMIN_TOKEN>`. Without ADMIN_TOKEN set they are always refused. */
export function adminOnly(request: Request, env: Record<string, string | undefined>): Response | null {
  return bearerMatches(request.headers.get('authorization'), env.ADMIN_TOKEN)
    ? null
    : json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
}
