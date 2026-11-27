// Runs apps/web/api/** handlers inside the game server. Owned by FLY-1 (#86).
// Same route table and conventions as the Vite dev plugin (apps/web/dev/apiPlugin.ts).
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { matchRoute, routesFromFiles } from '../../../web/dev/apiRoutes.ts';

type Handler = (request: Request) => Response | Promise<Response>;

export interface ApiOptions {
  /** Folder with the handlers (apps/web/api). */
  apiDir: string;
  /** Per-request limit; replaces Vercel's maxDuration. */
  timeoutMs?: number;
  /** Extra CORS origins besides the request's own origin. */
  allowedOrigins?: string[];
}

export const API_TIMEOUT_MS = 60_000;

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

const json = (body: unknown, status: number, headers?: HeadersInit) => Response.json(body, { status, headers });

export function createApiHandler({
  apiDir,
  timeoutMs = API_TIMEOUT_MS,
  allowedOrigins = [],
}: ApiOptions): (req: Request) => Promise<Response> {
  const routes = routesFromFiles(listFiles(apiDir)); // built once at startup
  const allowed = new Set(allowedOrigins);

  return async (req) => {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const cors: Record<string, string> = {};
    if (origin) {
      cors.Vary = 'Origin';
      if (allowed.has(origin)) cors['Access-Control-Allow-Origin'] = origin;
      else if (origin !== url.origin && req.method === 'OPTIONS') return json({ error: 'forbidden' }, 403, cors);
    }
    if (req.method === 'OPTIONS' && cors['Access-Control-Allow-Origin']) {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': req.headers.get('access-control-request-headers') ?? 'content-type',
          'Access-Control-Max-Age': '600',
        },
      });
    }

    const match = matchRoute(routes, url.pathname);
    if (!match) return json({ error: 'not_found' }, 404, cors);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const mod = (await import(join(apiDir, match.route.file))) as Record<string, unknown>;
      const handler = (mod[req.method] ?? (req.method === 'HEAD' ? mod.GET : undefined)) as Handler | undefined;
      if (typeof handler !== 'function') return json({ error: 'method_not_allowed' }, 405, cors);

      for (const [k, v] of Object.entries(match.params)) url.searchParams.set(k, v);
      const request = new Request(url, req);
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      });
      const result = await Promise.race([Promise.resolve(handler(request)), timeout]);
      if (result === 'timeout') return json({ error: 'gateway_timeout' }, 504, cors);

      const res = new Response(req.method === 'HEAD' ? null : result.body, result);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      console.error(`[api] ${url.pathname}:`, err);
      return json({ error: 'internal' }, 500, cors);
    } finally {
      clearTimeout(timer);
    }
  };
}
