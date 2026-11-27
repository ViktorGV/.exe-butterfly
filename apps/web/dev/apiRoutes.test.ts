import { describe, expect, it } from 'bun:test';
import { matchRoute, routesFromFiles } from './apiRoutes.ts';

const files = [
  'health.ts',
  'packs/index.ts',
  'packs/generate.ts',
  'packs/batch.ts',
  'packs/[id].ts',
  'packs/[id]/report.ts',
  '_lib/store/index.ts',
  '_lib/ratelimit.ts',
  'packs/generate.test.ts',
  'README.md',
];

describe('api routes', () => {
  const routes = routesFromFiles(files);
  const hit = (p: string) => {
    const m = matchRoute(routes, p);
    return m && { file: m.route.file, params: m.params };
  };

  it('maps files to routes like Vercel', () => {
    expect(hit('/api/health')).toEqual({ file: 'health.ts', params: {} });
    expect(hit('/api/packs')).toEqual({ file: 'packs/index.ts', params: {} });
    expect(hit('/api/packs/')).toEqual({ file: 'packs/index.ts', params: {} });
    expect(hit('/api/packs/g:abc')).toEqual({ file: 'packs/[id].ts', params: { id: 'g:abc' } });
    expect(hit('/api/packs/g%3Aabc/report')).toEqual({ file: 'packs/[id]/report.ts', params: { id: 'g:abc' } });
  });

  it('prefers static routes over dynamic ones', () => {
    expect(hit('/api/packs/generate')?.file).toBe('packs/generate.ts');
    expect(hit('/api/packs/batch')?.file).toBe('packs/batch.ts');
  });

  it('does not expose private files, tests or unknown paths', () => {
    expect(routes.map((r) => r.file)).not.toContain('_lib/ratelimit.ts');
    expect(routes.map((r) => r.file)).not.toContain('packs/generate.test.ts');
    expect(hit('/api/_lib/ratelimit')).toBeNull();
    expect(hit('/api/nope')).toBeNull();
    expect(hit('/apis/health')).toBeNull();
  });
});
