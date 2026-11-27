// Pure route table for apps/web/api/**, mirroring Vercel's file-based routing.
// Owned by #2. Used by the Vite dev plugin (dev/apiPlugin.ts) and its tests.
//
//   api/health.ts              -> /api/health
//   api/packs/index.ts         -> /api/packs
//   api/packs/[id].ts          -> /api/packs/:id
//   api/packs/[id]/report.ts   -> /api/packs/:id/report
//
// Files and folders starting with "_" or "." and *.test.ts files are not routes.

export interface Route {
  /** path relative to the api directory, e.g. "packs/[id].ts" */
  file: string;
  pattern: RegExp;
  /** dynamic segment names in order */
  keys: string[];
  /** number of dynamic segments (static routes win) */
  dynamic: number;
}

const ROUTE_FILE = /\.(ts|js)$/;
const TEST_FILE = /\.test\.(ts|js)$/;

/** @param files paths relative to the api directory, using "/" separators */
export function routesFromFiles(files: string[]): Route[] {
  const routes: Route[] = [];
  for (const file of files) {
    if (!ROUTE_FILE.test(file) || TEST_FILE.test(file) || file.endsWith('.d.ts')) continue;
    const parts = file.replace(ROUTE_FILE, '').split('/');
    if (parts.some((p) => p.startsWith('_') || p.startsWith('.'))) continue;
    if (parts[parts.length - 1] === 'index') parts.pop();
    const keys: string[] = [];
    const source = parts
      .map((p) => {
        const m = /^\[([A-Za-z0-9_]+)\]$/.exec(p);
        if (m) {
          keys.push(m[1]);
          return '([^/]+)';
        }
        return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    routes.push({ file, pattern: new RegExp(`^/api${source ? `/${source}` : ''}/?$`), keys, dynamic: keys.length });
  }
  return routes.sort((a, b) => a.dynamic - b.dynamic || b.file.length - a.file.length);
}

export function matchRoute(routes: Route[], pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    const m = route.pattern.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { route, params };
  }
  return null;
}
