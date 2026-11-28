import { beforeEach, describe, expect, it } from 'bun:test';
import { skinSwatch, themeSwatch } from '@wobble/shared/assets/index';
import { fixtureSkinPack, fixtureThemePack } from '@wobble/shared/fixtures/index';
import type { Pack } from '@wobble/shared/types';
import { createRateLimiter } from '../_lib/ratelimit.ts';
import { createMemoryPackStore } from '../_lib/store/index.ts';
import { createBatchHandler } from './batch.ts';
import { createDeleteHandler, createGetHandler } from './[id].ts';
import { createListHandler } from './index.ts';
import { createReportHandler, createUnflagHandler } from './[id]/report.ts';

const ENV = { ADMIN_TOKEN: 'admin-secret', WOBBLE_SERVER_TOKEN: 'server-secret' };
const allow = async () => ({ ok: true, retryAfterSec: 0 });
const base = 'http://api.test';

const skin = (id: string, createdAt: string, name = id): Pack => ({ ...fixtureSkinPack, id, name, createdAt });
const theme = (id: string, createdAt: string): Pack => ({ ...fixtureThemePack, id, name: id, createdAt });

let store: ReturnType<typeof createMemoryPackStore>;
beforeEach(async () => {
  store = createMemoryPackStore();
  await store.put(skin('g:aaa', '2026-01-03T00:00:00.000Z'));
  await store.put(skin('g:bbb', '2026-01-02T00:00:00.000Z'));
  await store.put(skin('g:ccc', '2026-01-01T00:00:00.000Z'));
  await store.put(theme('g:ttt', '2026-01-01T00:00:00.000Z'));
});

const deps = () => ({ store: () => store, rateLimit: allow, env: ENV });
const get = (path: string, init?: RequestInit) => new Request(`${base}${path}`, init);
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const post = (path: string, body: unknown) => get(path, { method: 'POST', body: JSON.stringify(body) });

describe('GET /api/packs', () => {
  it('lists newest first with swatches and a cursor', async () => {
    const list = createListHandler(deps());
    const res = await list(get('/api/packs?kind=skin&limit=2'));
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      items: { id: string; kind: string; name: string; swatch: string[] }[];
      nextCursor: string | null;
    };
    expect(page.items.map((i) => i.id)).toEqual(['g:aaa', 'g:bbb']);
    expect(page.items[0]).toEqual({
      id: 'g:aaa',
      kind: 'skin',
      name: 'g:aaa',
      swatch: skinSwatch(fixtureSkinPack.data).colors.slice(0, 6),
    });
    expect(page.nextCursor).not.toBeNull();

    const next = (await (
      await list(get(`/api/packs?kind=skin&limit=2&cursor=${page.nextCursor}`))
    ).json()) as typeof page;
    expect(next.items.map((i) => i.id)).toEqual(['g:ccc']);
    expect(next.nextCursor).toBeNull();
  });

  it('gives theme packs up to six colours', async () => {
    const res = await createListHandler(deps())(get('/api/packs?kind=theme'));
    const page = (await res.json()) as { items: { swatch: string[] }[] };
    expect(page.items).toHaveLength(1);
    const expected = themeSwatch(fixtureThemePack.data);
    expect(page.items[0]?.swatch).toEqual([...expected.sky, ...expected.colors].slice(0, 6));
    expect(page.items[0]?.swatch).toHaveLength(6);
  });

  it('sets short shared cache headers, an ETag and open CORS', async () => {
    const res = await createListHandler(deps())(get('/api/packs?kind=skin'));
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=10, stale-while-revalidate=60');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('etag')).toMatch(/^".+"$/);
  });

  it('answers 304 when the ETag matches', async () => {
    const list = createListHandler(deps());
    const first = await list(get('/api/packs?kind=skin'));
    const again = await list(get('/api/packs?kind=skin', { headers: { 'if-none-match': first.headers.get('etag')! } }));
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
  });

  it('hides flagged packs', async () => {
    await store.flag('g:aaa');
    const page = (await (await createListHandler(deps())(get('/api/packs?kind=skin'))).json()) as {
      items: { id: string }[];
    };
    expect(page.items.map((i) => i.id)).toEqual(['g:bbb', 'g:ccc']);
  });

  it('rejects a missing or unknown kind, and clamps the limit', async () => {
    const list = createListHandler(deps());
    expect((await list(get('/api/packs'))).status).toBe(422);
    expect((await list(get('/api/packs?kind=banana'))).status).toBe(422);
    const huge = (await (await list(get('/api/packs?kind=skin&limit=100000'))).json()) as { items: unknown[] };
    expect(huge.items).toHaveLength(3);
  });
});

describe('GET /api/packs/:id', () => {
  const byId = (id: string, init?: RequestInit) => get(`/api/packs/${id}?id=${encodeURIComponent(id)}`, init);

  it('returns the pack as immutable, cacheable JSON with CORS', async () => {
    const res = await createGetHandler(deps())(byId('g:aaa'));
    expect(res.status).toBe(200);
    expect((await res.json()) as Pack).toMatchObject({ id: 'g:aaa', kind: 'skin' });
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('etag')).toBeTruthy();
  });

  it('answers 304 for a matching ETag', async () => {
    const h = createGetHandler(deps());
    const first = await h(byId('g:aaa'));
    const again = await h(byId('g:aaa', { headers: { 'if-none-match': first.headers.get('etag')! } }));
    expect(again.status).toBe(304);
  });

  it('serves a hidden pack by id so running matches keep working', async () => {
    await store.flag('g:aaa');
    expect((await createGetHandler(deps())(byId('g:aaa'))).status).toBe(200);
  });

  it('404s for unknown packs and for built-in, event and procedural ids; 422 for junk', async () => {
    const h = createGetHandler(deps());
    expect((await h(byId('g:nope'))).status).toBe(404);
    expect((await h(byId('b:fixture-skin'))).status).toBe(404);
    expect((await h(byId('e:something'))).status).toBe(404);
    expect((await h(byId('r:forest:42'))).status).toBe(404);
    expect((await h(byId('NOT AN ID'))).status).toBe(422);
    expect((await h(get('/api/packs/x'))).status).toBe(422);
  });
});

describe('GET /api/packs/batch', () => {
  it('returns found packs and the missing ids', async () => {
    const res = await createBatchHandler(deps())(get('/api/packs/batch?ids=g:aaa,g:zzz,b:fixture-skin,g:bbb'));
    const body = (await res.json()) as { packs: Pack[]; missing: string[] };
    expect(body.packs.map((p) => p.id)).toEqual(['g:aaa', 'g:bbb']);
    expect(body.missing).toEqual(['g:zzz', 'b:fixture-skin']);
  });

  it('caches a complete answer for good, but not one with missing ids', async () => {
    const h = createBatchHandler(deps());
    expect((await h(get('/api/packs/batch?ids=g:aaa,g:bbb'))).headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect((await h(get('/api/packs/batch?ids=g:aaa,g:zzz'))).headers.get('cache-control')).toBe('no-store');
    expect((await h(get('/api/packs/batch?ids=g:aaa'))).headers.get('access-control-allow-origin')).toBe('*');
  });

  it('ignores duplicates and blanks, and accepts exactly 50 ids', async () => {
    const h = createBatchHandler(deps());
    const dupes = (await (await h(get('/api/packs/batch?ids=g:aaa,,g:aaa, g:aaa'))).json()) as { packs: Pack[] };
    expect(dupes.packs).toHaveLength(1);
    const fifty = Array.from({ length: 50 }, (_, i) => `g:p${i}`).join(',');
    expect((await h(get(`/api/packs/batch?ids=${fifty}`))).status).toBe(200);
  });

  it('refuses no ids and more than 50 ids', async () => {
    const h = createBatchHandler(deps());
    expect((await h(get('/api/packs/batch'))).status).toBe(422);
    expect((await h(get('/api/packs/batch?ids='))).status).toBe(422);
    const fiftyOne = Array.from({ length: 51 }, (_, i) => `g:p${i}`).join(',');
    expect((await h(get(`/api/packs/batch?ids=${fiftyOne}`))).status).toBe(422);
  });
});

describe('POST /api/packs/:id/report', () => {
  const report = (id: string, clientId: unknown) =>
    post(`/api/packs/${id}/report?id=${encodeURIComponent(id)}`, { clientId });

  it('hides a pack from listings after 3 different clients report it, but not before', async () => {
    const h = createReportHandler(deps());
    expect((await h(report('g:aaa', 'client-0001'))).status).toBe(204);
    expect((await h(report('g:aaa', 'client-0002'))).status).toBe(204);
    expect((await store.list({ kind: 'skin' })).items.map((p) => p.id)).toContain('g:aaa');
    expect((await h(report('g:aaa', 'client-0003'))).status).toBe(204);
    expect((await store.list({ kind: 'skin' })).items.map((p) => p.id)).not.toContain('g:aaa');
    expect(await store.get('g:aaa')).not.toBeNull();
  });

  it('counts one report per client per pack', async () => {
    const h = createReportHandler(deps());
    for (let i = 0; i < 5; i++) expect((await h(report('g:bbb', 'client-0001'))).status).toBe(204);
    expect((await store.list({ kind: 'skin' })).items.map((p) => p.id)).toContain('g:bbb');
  });

  it('404s for unknown packs and 422s for a bad body', async () => {
    const h = createReportHandler(deps());
    expect((await h(report('g:nope', 'client-0001'))).status).toBe(404);
    expect((await h(report('g:aaa', 'short'))).status).toBe(422);
    expect((await h(report('g:aaa', 42))).status).toBe(422);
    expect((await h(get('/api/packs/g:aaa/report?id=g%3Aaaa', { method: 'POST', body: 'not json' }))).status).toBe(422);
  });

  it('answers 429 with Retry-After when the report limit is hit', async () => {
    let t = 0;
    const limited = createRateLimiter({
      rules: { report: [{ by: 'clientId', limit: 1, windowSec: 3600 }] },
      now: () => t,
    });
    const h = createReportHandler({ ...deps(), rateLimit: limited });
    expect((await h(report('g:aaa', 'client-0001'))).status).toBe(204);
    t = 600_000;
    const res = await h(report('g:bbb', 'client-0001'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3000');
  });
});

describe('rate limits on reads', () => {
  const blocked = async () => ({ ok: false, retryAfterSec: 7.2 });

  it('answers 429 with Retry-After on list, by id and batch', async () => {
    const d = { ...deps(), rateLimit: blocked };
    for (const res of [
      await createListHandler(d)(get('/api/packs?kind=skin')),
      await createGetHandler(d)(get('/api/packs/g:aaa?id=g%3Aaaa')),
      await createBatchHandler(d)(get('/api/packs/batch?ids=g:aaa')),
    ]) {
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('8');
    }
  });

  it('lets the game server (server token) read without counting against the limit', async () => {
    const d = { ...deps(), rateLimit: blocked };
    const res = await createGetHandler(d)(get('/api/packs/g:aaa?id=g%3Aaaa', { headers: bearer('server-secret') }));
    expect(res.status).toBe(200);
    const wrong = await createGetHandler(d)(get('/api/packs/g:aaa?id=g%3Aaaa', { headers: bearer('nope') }));
    expect(wrong.status).toBe(429);
  });
});

describe('admin endpoints', () => {
  const del = (id: string, headers?: Record<string, string>) =>
    get(`/api/packs/${id}?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers });
  const unflag = (id: string, headers?: Record<string, string>) =>
    get(`/api/packs/${id}/report?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers });

  it('delete needs ADMIN_TOKEN', async () => {
    const h = createDeleteHandler(deps());
    expect((await h(del('g:aaa'))).status).toBe(401);
    expect((await h(del('g:aaa', bearer('wrong')))).status).toBe(401);
    expect(await store.get('g:aaa')).not.toBeNull();
    expect((await h(del('g:aaa', bearer('admin-secret')))).status).toBe(204);
    expect(await store.get('g:aaa')).toBeNull();
    expect((await h(del('g:aaa', bearer('admin-secret')))).status).toBe(404);
  });

  it('refuses every admin call when ADMIN_TOKEN is not configured', async () => {
    const h = createDeleteHandler({ ...deps(), env: {} });
    expect((await h(del('g:aaa', bearer('')))).status).toBe(401);
    expect((await h(del('g:aaa', bearer('undefined')))).status).toBe(401);
  });

  it('unflag shows a hidden pack again and clears its reports', async () => {
    const report = createReportHandler(deps());
    for (const c of ['client-0001', 'client-0002', 'client-0003']) {
      await report(post('/api/packs/g:aaa/report?id=g%3Aaaa', { clientId: c }));
    }
    expect((await store.list({ kind: 'skin' })).items.map((p) => p.id)).not.toContain('g:aaa');

    const h = createUnflagHandler(deps());
    expect((await h(unflag('g:aaa'))).status).toBe(401);
    expect((await h(unflag('g:aaa', bearer('admin-secret')))).status).toBe(204);
    expect((await store.list({ kind: 'skin' })).items.map((p) => p.id)).toContain('g:aaa');

    // The old reports are gone: two new ones do not hide it again.
    for (const c of ['client-0001', 'client-0002']) {
      await report(post('/api/packs/g:aaa/report?id=g%3Aaaa', { clientId: c }));
    }
    expect((await store.list({ kind: 'skin' })).items.map((p) => p.id)).toContain('g:aaa');
    expect((await h(unflag('g:nope', bearer('admin-secret')))).status).toBe(404);
  });
});
