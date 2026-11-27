import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../index.ts';

const apiDir = mkdtempSync(join(tmpdir(), 'wobble-api-'));
const realApi = new URL('../../../web/api', import.meta.url).pathname;

function serve(opts: Parameters<typeof createGameServer>[0]) {
  const game = createGameServer({ port: 0, hostname: '127.0.0.1', webDist: apiDir, ...opts });
  return { game, base: `http://127.0.0.1:${game.listen()}` };
}

describe('api (real handlers)', () => {
  const { game, base } = serve({ apiDir: realApi });
  afterAll(() => game.close());

  it('GET /api/health returns the handler JSON', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: 'wobble-api' });
  });

  it('unknown route is 404 JSON, wrong method is 405', async () => {
    const miss = await fetch(`${base}/api/x`);
    expect(miss.status).toBe(404);
    expect(await miss.json()).toEqual({ error: 'not_found' });
    const wrong = await fetch(`${base}/api/health`, { method: 'POST' });
    expect(wrong.status).toBe(405);
  });
});

describe('api (fixture handlers)', () => {
  let game: ReturnType<typeof serve>['game'];
  let base = '';
  beforeAll(() => {
    mkdirSync(join(apiDir, 'packs'), { recursive: true });
    writeFileSync(
      join(apiDir, 'packs/[id].ts'),
      `export const GET = (r: Request) => Response.json({ id: new URL(r.url).searchParams.get('id') });`,
    );
    writeFileSync(join(apiDir, 'hang.ts'), `export const GET = () => new Promise<Response>(() => {});`);
    writeFileSync(join(apiDir, 'boom.ts'), `export const GET = () => { throw new Error('x'); };`);
    ({ game, base } = serve({ apiDir, apiTimeoutMs: 50, allowedOrigins: ['http://localhost:5173'] }));
  });
  afterAll(async () => {
    await game.close();
    rmSync(apiDir, { recursive: true, force: true });
  });

  it('passes dynamic segments in the query string', async () => {
    expect(await (await fetch(`${base}/api/packs/abc`)).json()).toEqual({ id: 'abc' });
  });

  it('answers 504 when a handler hangs and 500 when it throws', async () => {
    expect((await fetch(`${base}/api/hang`)).status).toBe(504);
    expect((await fetch(`${base}/api/boom`)).status).toBe(500);
  });

  it('CORS: allowed origins only', async () => {
    const ok = await fetch(`${base}/api/packs/a`, { headers: { Origin: 'http://localhost:5173' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const other = await fetch(`${base}/api/packs/a`, { headers: { Origin: 'http://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await fetch(`${base}/api/packs/a`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    expect(pre.status).toBe(204);
    const bad = await fetch(`${base}/api/packs/a`, { method: 'OPTIONS', headers: { Origin: 'http://evil.example' } });
    expect(bad.status).toBe(403);
  });
});
