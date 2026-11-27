// Static file serving for the built client (apps/web/dist). Owned by FLY-1 (#86).
// Files are streamed with Bun.file, never read into memory.
import { join, resolve, sep } from 'node:path';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

export interface StaticOptions {
  /** Absolute or cwd-relative folder with the built client. */
  root: string;
}

function cacheControl(pathname: string): string {
  if (pathname.startsWith('/assets/')) return IMMUTABLE;
  if (pathname.startsWith('/event/packs/') || pathname.startsWith('/event/themes/')) return IMMUTABLE;
  return NO_CACHE; // index.html, /event/manifest.json and anything else
}

function htmlHeaders(host: string): Record<string, string> {
  return {
    // Same origin only, plus same-origin WebSocket (Safari does not match ws(s) with 'self').
    // Inline styles are allowed because index.html carries a <style> block.
    'Content-Security-Policy': [
      "default-src 'self'",
      `connect-src 'self' wss://${host}`,
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

/** Returns the absolute file path for a URL pathname, or null when it escapes root. */
export function safeResolve(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded.split('/').some((seg) => seg === '..')) return null;
  const base = resolve(root);
  const full = resolve(join(base, decoded));
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export function createStaticHandler({ root }: StaticOptions): (req: Request) => Promise<Response> {
  const base = resolve(root);
  const notFound = () => new Response('Not found', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' } });

  return async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const url = new URL(req.url);
    const full = safeResolve(base, url.pathname);
    if (!full) return notFound();

    let pathname = url.pathname;
    let file = Bun.file(full);
    // Directories and unknown paths fall back to the SPA entry.
    if (full === base || !(await file.exists())) {
      file = Bun.file(join(base, 'index.html'));
      pathname = '/index.html';
      if (!(await file.exists())) return notFound();
    }

    const headers: Record<string, string> = {
      'Content-Type': file.type,
      'Content-Length': String(file.size),
      'Cache-Control': cacheControl(pathname),
    };
    if (file.type.startsWith('text/html')) Object.assign(headers, htmlHeaders(url.host));
    else headers['X-Content-Type-Options'] = 'nosniff';
    return new Response(req.method === 'HEAD' ? null : file, { headers });
  };
}
