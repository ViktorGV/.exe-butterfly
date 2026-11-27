// Vite dev plugin: serves apps/web/api/** at /api/* during `bun run dev`. Owned by #2.
//
// Handlers use the Web signature that Vercel runs unchanged:
//   export async function GET(request: Request) { return Response.json({ ok: true }) }
//
// Dynamic segments ([id].ts) are appended to the request URL's query string, which is how
// Vercel exposes them too; handlers read them with `new URL(request.url).searchParams.get('id')`.
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import { matchRoute, routesFromFiles } from './apiRoutes.ts';

type Handler = (request: Request) => Response | Promise<Response>;

function listFiles(dir: string): string[] {
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

export function apiDevPlugin({ apiDir }: { apiDir: string }): Plugin {
  return {
    name: 'wobble-api-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return next();

        const sendJson = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };

        const match = matchRoute(routesFromFiles(listFiles(apiDir)), url.pathname);
        if (!match) return sendJson(404, { error: 'not_found' });

        try {
          const mod = (await server.ssrLoadModule(join(apiDir, match.route.file))) as Record<string, unknown>;
          const method = (req.method ?? 'GET').toUpperCase();
          const handler = (mod[method] ?? (method === 'HEAD' ? mod.GET : undefined)) as Handler | undefined;
          if (typeof handler !== 'function') return sendJson(405, { error: 'method_not_allowed' });

          for (const [k, v] of Object.entries(match.params)) url.searchParams.set(k, v);
          const chunks: Buffer[] = [];
          if (method !== 'GET' && method !== 'HEAD') for await (const chunk of req) chunks.push(chunk as Buffer);
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
          const request = new Request(url, {
            method,
            headers,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          });

          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          server.config.logger.error(`[api] ${url.pathname}: ${(err as Error)?.stack ?? err}`);
          sendJson(500, { error: 'internal' });
        }
      });
    },
  };
}
