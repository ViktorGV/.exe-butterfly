import { describe, expect, it } from 'bun:test';
import { fixtureSkinPack, listBuiltins } from '@wobble/shared';
import type { MatchConfig, Pack } from '@wobble/shared';
import { AssetError, createAssetStore } from './index.ts';
import type { PackPersistence } from './index.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const skin = (id: string): Pack => ({ ...fixtureSkinPack, id, name: id }) as Pack;
const defaultSkinId = () => listBuiltins('skin')[0]?.id ?? '';

/** A fake API server: counts calls and tracks the most requests in flight at once. */
function fakeApi(packs: Record<string, unknown>, delayMs = 0) {
  const calls: string[] = [];
  const batches: string[][] = [];
  let active = 0;
  let peak = 0;
  let batchActive = 0;
  let batchPeak = 0;
  const fn = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input), 'http://api.test');
    calls.push(url.pathname + url.search);
    active++;
    peak = Math.max(peak, active);
    try {
      if (delayMs) await sleep(delayMs);
      if (url.pathname === '/api/packs/batch') {
        batchActive++;
        batchPeak = Math.max(batchPeak, batchActive);
        await sleep(delayMs);
        batchActive--;
        const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
        batches.push(ids);
        const found = ids.filter((id) => id in packs).map((id) => packs[id]);
        return json({ packs: found, missing: ids.filter((id) => !(id in packs)) });
      }
      const m = /^\/api\/packs\/(.+)$/.exec(url.pathname);
      const id = m ? decodeURIComponent(m[1] ?? '') : '';
      return id in packs ? json(packs[id]) : json({ error: 'not found' }, 404);
    } finally {
      active--;
    }
  };
  return { fn: fn as unknown as typeof fetch, calls, batches, peak: () => peak, batchPeak: () => batchPeak };
}

function memoryDisk(): PackPersistence & { size: () => number } {
  const m = new Map<string, Pack>();
  return {
    async get(id) {
      return m.get(id) ?? null;
    },
    async put(p) {
      m.set(p.id, p);
    },
    size: () => m.size,
  };
}

const memStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

function match(skinIds: string[], localSkin?: string): MatchConfig {
  const players = skinIds.map((skinId, i) => ({ id: i + 1, slot: i, skinId, name: `p${i}` }));
  if (localSkin !== undefined) players.unshift({ id: 0, slot: 0, skinId: localSkin, name: 'me' });
  return {
    t: 'matchConfig',
    courseId: listBuiltins('course')[0]?.id ?? '',
    themeId: listBuiltins('theme')[0]?.id ?? '',
    qualifyCount: 10,
    players,
  } as unknown as MatchConfig;
}

describe('getPack', () => {
  it('resolves built-in ids with no network', async () => {
    const api = fakeApi({});
    const store = createAssetStore({ fetch: api.fn, persistence: null });
    const builtin = listBuiltins('skin')[0];
    const pack = await store.getPack(builtin?.id ?? '');
    expect(pack.id).toBe(builtin?.id);
    expect(api.calls).toHaveLength(0);
  });

  it('fetches a generated pack once, then serves it from memory', async () => {
    const api = fakeApi({ 'g:aaa': skin('g:aaa') });
    const store = createAssetStore({ fetch: api.fn, persistence: null });
    expect((await store.getPack('g:aaa')).id).toBe('g:aaa');
    expect((await store.getPack('g:aaa')).id).toBe('g:aaa');
    expect(api.calls).toHaveLength(1);
  });

  it('reads from disk in a new store and never refetches', async () => {
    const disk = memoryDisk();
    const api = fakeApi({ 'g:aaa': skin('g:aaa') });
    await createAssetStore({ fetch: api.fn, persistence: disk }).getPack('g:aaa');
    await sleep(5);
    expect(disk.size()).toBe(1);
    const again = fakeApi({});
    const pack = await createAssetStore({ fetch: again.fn, persistence: disk }).getPack('g:aaa');
    expect(pack.id).toBe('g:aaa');
    expect(again.calls).toHaveLength(0);
  });

  it('shares one fetch between concurrent requests for the same id', async () => {
    const api = fakeApi({ 'g:aaa': skin('g:aaa') }, 10);
    const store = createAssetStore({ fetch: api.fn, persistence: null });
    const all = await Promise.all([store.getPack('g:aaa'), store.getPack('g:aaa'), store.getPack('g:aaa')]);
    expect(all.map((p) => p.id)).toEqual(['g:aaa', 'g:aaa', 'g:aaa']);
    expect(api.calls).toHaveLength(1);
  });

  it('never rejects: every failure becomes the default pack', async () => {
    const wrongId = skin('g:other');
    const cases: Record<string, () => Promise<Response>> = {
      'g:notfound': async () => json({ error: 'nope' }, 404),
      'g:server': async () => json({ error: 'boom' }, 500),
      'g:garbage': async () => new Response('<html>', { status: 200 }),
      'g:schema': async () => json({ id: 'g:schema', kind: 'skin' }),
      'g:wrongid': async () => json(wrongId),
      'g:network': async () => {
        throw new TypeError('offline');
      },
    };
    const fetchFn = (async (input: RequestInfo | URL) => {
      const id = decodeURIComponent(new URL(String(input), 'http://x').pathname.split('/').pop() ?? '');
      const route = cases[id];
      if (!route) throw new Error(`unexpected ${id}`);
      return route();
    }) as unknown as typeof fetch;
    const store = createAssetStore({ fetch: fetchFn, persistence: null });
    for (const id of Object.keys(cases)) {
      const pack = await store.getPack(id);
      expect(pack.id).toBe(defaultSkinId());
    }
  });

  it('falls back on a timeout', async () => {
    const hang = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const store = createAssetStore({ fetch: hang, persistence: null, requestTimeoutMs: 20 });
    expect((await store.getPack('g:slow')).id).toBe(defaultSkinId());
  });

  it('uses the default of the requested kind', async () => {
    const store = createAssetStore({ fetch: fakeApi({}).fn, persistence: null });
    expect((await store.getPack('g:missing', 'theme')).kind).toBe('theme');
  });

  it('sanitises a hostile pack and never passes it through', async () => {
    const evil = skin('g:evil') as unknown as { data: { body: { height: number } }; evil?: string };
    evil.data.body.height = 99999;
    evil.evil = 'x';
    const store = createAssetStore({ fetch: fakeApi({ 'g:evil': evil }).fn, persistence: null });
    const pack = await store.getPack('g:evil');
    expect('evil' in pack).toBe(false);
    expect((pack.data as { body: { height: number } }).body.height).toBeLessThanOrEqual(1.15);
  });
});

describe('preloadMatch', () => {
  it('blocks only on course, theme and the local skin', async () => {
    const api = fakeApi({ 'g:mee': skin('g:mee'), 'g:aaa': skin('g:aaa') }, 5);
    const store = createAssetStore({ fetch: api.fn, persistence: null });
    const { blocking, background } = store.preloadMatch(match(['g:aaa'], 'g:mee'), { localPlayerId: 0 });
    const report = await blocking;
    expect(report.requested).toBe(3);
    expect(report.loaded).toBe(3);
    expect(report.timedOut).toBe(false);
    expect(api.calls.filter((c) => !c.startsWith('/api/packs/batch')).length).toBeLessThanOrEqual(3);
    expect((await background).loaded).toBe(1);
  });

  it('fetches 300 distinct skins in at most 6 batches of 50 at a time', async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `g:s${i}`);
    const packs = Object.fromEntries(ids.map((id) => [id, skin(id)]));
    packs['g:mee'] = skin('g:mee');
    const api = fakeApi(packs, 10);
    const store = createAssetStore({ fetch: api.fn, persistence: null });
    const { blocking, background } = store.preloadMatch(match(ids, 'g:mee'), { localPlayerId: 0 });
    await blocking;
    const report = await background;
    expect(report.loaded).toBe(300);
    expect(report.fallbacks).toHaveLength(0);
    expect(api.batches).toHaveLength(6);
    expect(Math.max(...api.batches.map((b) => b.length))).toBeLessThanOrEqual(50);
    expect(api.batchPeak()).toBeLessThanOrEqual(6);
  });

  it('keeps at most 6 requests in flight with more than 6 chunks', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `g:s${i}`);
    const api = fakeApi(Object.fromEntries(ids.map((id) => [id, skin(id)])), 10);
    const store = createAssetStore({ fetch: api.fn, persistence: null });
    const { background } = store.preloadMatch(match(ids));
    await background;
    expect(api.batches).toHaveLength(9);
    expect(api.batchPeak()).toBeLessThanOrEqual(6);
  });

  it('de-duplicates: 300 players wearing 20 skins is 20 ids', async () => {
    const distinct = Array.from({ length: 20 }, (_, i) => `g:d${i}`);
    const api = fakeApi(Object.fromEntries(distinct.map((id) => [id, skin(id)])));
    const store = createAssetStore({ fetch: api.fn, persistence: null });
    const all = Array.from({ length: 300 }, (_, i) => distinct[i % 20] ?? '');
    const report = await store.preloadMatch(match(all)).background;
    expect(report.requested).toBe(20);
    expect(api.batches.flat()).toHaveLength(20);
  });

  it('records missing skins as fallbacks and still finishes', async () => {
    const api = fakeApi({ 'g:okk': skin('g:okk') });
    const store = createAssetStore({ fetch: api.fn, persistence: null });
    const report = await store.preloadMatch(match(['g:okk', 'g:gone'])).background;
    expect(report.loaded).toBe(1);
    expect(report.fallbacks).toEqual([{ id: 'g:gone', reason: 'not_found' }]);
    expect(report.packs['g:gone']?.id).toBe(defaultSkinId());
  });

  it('survives a failing batch endpoint', async () => {
    const down = (async () => json({ error: 'down' }, 503)) as unknown as typeof fetch;
    const store = createAssetStore({ fetch: down, persistence: null });
    const report = await store.preloadMatch(match(['g:aaa', 'g:bbb'])).background;
    expect(report.loaded).toBe(0);
    expect(report.fallbacks.map((f) => f.reason)).toEqual(['unavailable', 'unavailable']);
  });

  it('gives up waiting on the local skin after the hard timeout', async () => {
    const hang = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const store = createAssetStore({ fetch: hang, persistence: null, blockingTimeoutMs: 30, requestTimeoutMs: 5000 });
    const report = await store.preloadMatch(match([], 'g:mee'), { localPlayerId: 0 }).blocking;
    expect(report.timedOut).toBe(true);
    expect(report.fallbacks).toEqual([{ id: 'g:mee', reason: 'timeout' }]);
    expect(report.packs['g:mee']?.id).toBe(defaultSkinId());
  });

  it('announces each pack as it arrives', async () => {
    const api = fakeApi({ 'g:aaa': skin('g:aaa'), 'g:bbb': skin('g:bbb') });
    const store = createAssetStore({ fetch: api.fn, persistence: null });
    const seen: string[] = [];
    store.on('pack', (id) => seen.push(id));
    await store.preloadMatch(match(['g:aaa', 'g:bbb'])).background;
    expect(seen.sort()).toEqual(['g:aaa', 'g:bbb']);
  });

  it('shares the batch with a getPack for the same id', async () => {
    const api = fakeApi({ 'g:aaa': skin('g:aaa') }, 10);
    const store = createAssetStore({ fetch: api.fn, persistence: null });
    const bg = store.preloadMatch(match(['g:aaa'])).background;
    const one = await store.getPack('g:aaa');
    await bg;
    expect(one.id).toBe('g:aaa');
    expect(api.calls).toHaveLength(1);
  });
});

describe('generate, list and report', () => {
  it('generates and caches the pack, sending the client id', async () => {
    const sent: unknown[] = [];
    const fetchFn = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return json({ id: 'g:new', kind: 'skin', pack: skin('g:new') });
    }) as unknown as typeof fetch;
    const store = createAssetStore({ fetch: fetchFn, persistence: null, storage: memStorage() });
    const pack = await store.generate('skin', 'a sleepy fox');
    expect(pack.id).toBe('g:new');
    expect(sent[0]).toEqual({ kind: 'skin', prompt: 'a sleepy fox', clientId: store.clientId() });
    // Cached now: no more requests needed.
    expect((await store.getPack('g:new')).id).toBe('g:new');
    expect(sent).toHaveLength(1);
  });

  it('keeps the client id between stores that share storage', () => {
    const storage = memStorage();
    const a = createAssetStore({ persistence: null, storage }).clientId();
    const b = createAssetStore({ persistence: null, storage }).clientId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });

  it('maps 429 with Retry-After, 422, 503 and network failures to typed errors', async () => {
    const answer = (res: () => Promise<Response>) =>
      createAssetStore({ fetch: res as unknown as typeof fetch, persistence: null }).generate('skin', 'x');
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
        return 'no error';
      } catch (e) {
        return e instanceof AssetError ? `${e.code}:${e.retryAfterSec}` : 'other';
      }
    };
    expect(await code(answer(async () => json({ error: 'slow down' }, 429, { 'retry-after': '12' })))).toBe(
      'rate_limited:12',
    );
    expect(await code(answer(async () => json({ error: 'bad prompt' }, 422)))).toBe('invalid:null');
    expect(await code(answer(async () => json({ error: 'busy' }, 503)))).toBe('unavailable:null');
    expect(
      await code(
        answer(async () => {
          throw new TypeError('offline');
        }),
      ),
    ).toBe('network:null');
  });

  it('rejects a generated pack that does not validate', async () => {
    const fetchFn = (async () => json({ id: 'g:bad', kind: 'skin', pack: { id: 'g:bad' } })) as unknown as typeof fetch;
    const store = createAssetStore({ fetch: fetchFn, persistence: null });
    await expect(store.generate('skin', 'x')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('lists a page of packs with the cursor', async () => {
    const urls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return json({ items: [{ id: 'g:aaa', kind: 'skin', name: 'A', swatch: ['#111111'] }], nextCursor: 'c2' });
    }) as unknown as typeof fetch;
    const store = createAssetStore({ fetch: fetchFn, persistence: null, apiBase: 'https://api.test/' });
    const page = await store.list('skin', 'c1');
    expect(page.nextCursor).toBe('c2');
    expect(page.items[0]?.id).toBe('g:aaa');
    expect(urls[0]).toBe('https://api.test/api/packs?kind=skin&cursor=c1');
  });

  it('reports a pack with the client id, and maps a 429', async () => {
    const calls: { url: string; body: unknown }[] = [];
    let status = 204;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return status === 204 ? new Response(null, { status: 204 }) : json({}, status, { 'retry-after': '30' });
    }) as unknown as typeof fetch;
    const store = createAssetStore({ fetch: fetchFn, persistence: null, storage: memStorage() });
    await store.report('g:aaa');
    expect(calls[0]?.body).toEqual({ clientId: store.clientId() });
    expect(calls[0]?.url).toContain('/api/packs/g%3Aaaa/report');
    status = 429;
    await expect(store.report('g:aaa')).rejects.toMatchObject({ code: 'rate_limited', retryAfterSec: 30 });
  });
});

describe('storage that is not available', () => {
  it('works with no disk cache and no storage at all', async () => {
    const api = fakeApi({ 'g:aaa': skin('g:aaa') });
    const store = createAssetStore({ fetch: api.fn, persistence: null, storage: null });
    expect((await store.getPack('g:aaa')).id).toBe('g:aaa');
    expect(store.clientId().length).toBeGreaterThanOrEqual(8);
  });

  it('keeps working when the disk cache throws', async () => {
    const broken: PackPersistence = {
      async get() {
        throw new Error('quota');
      },
      async put() {
        throw new Error('quota');
      },
    };
    const api = fakeApi({ 'g:aaa': skin('g:aaa') });
    const store = createAssetStore({ fetch: api.fn, persistence: broken });
    expect((await store.getPack('g:aaa')).id).toBe('g:aaa');
  });
});
