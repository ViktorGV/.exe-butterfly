import { describe, expect, it } from 'bun:test';
import { LIMITS, fixtureManifest, fixtureThemeV2, listBuiltins, randomThemedSkin } from '@wobble/shared';
import type { MatchConfig, ThemeDefV2 } from '@wobble/shared';
import { createAssetStore } from './index.ts';
import { themeImages } from './images.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function themeData(): ThemeDefV2 {
  const t = structuredClone(fixtureThemeV2);
  t.art.voteCard = { src: 'vote-card.webp', w: 4, h: 4, alpha: false, lowSrc: 'vote-card@0.5x.webp' };
  t.art.reveal = { src: 'reveal.webp', w: 4, h: 4, alpha: false, lowSrc: 'reveal@0.5x.webp' };
  return t;
}

const themePack = (slug: string, data: unknown = themeData()) => ({
  id: `e:${slug}`,
  kind: 'theme',
  name: slug,
  createdAt: '2026-01-01T00:00:00Z',
  data,
});

const skinPack = (slug: string) => ({
  id: `e:${slug}`,
  kind: 'skin',
  name: slug,
  createdAt: '2026-01-01T00:00:00Z',
  data: randomThemedSkin(fixtureThemeV2.costume, 7),
});

/** Static event files: packs by path, any .webp answers 200. Tracks order and requests in flight. */
function fakeEvent(files: Record<string, unknown>, delayMs = 2) {
  const calls: string[] = [];
  let active = 0;
  let peak = 0;
  const fn = async (input: RequestInfo | URL): Promise<Response> => {
    const path = new URL(String(input), 'http://web.test').pathname;
    calls.push(path);
    active++;
    peak = Math.max(peak, active);
    try {
      await sleep(delayMs);
      if (path.endsWith('.webp')) return new Response('img', { status: 200 });
      return path in files ? json(files[path]) : json({ error: 'not found' }, 404);
    } finally {
      active--;
    }
  };
  return { fn: fn as unknown as typeof fetch, calls, peak: () => peak };
}

const opts = (fetch: typeof globalThis.fetch) => ({ fetch, persistence: null, storage: null });

describe('v2 event themes', () => {
  it('accepts a valid v2 theme from an e: id', async () => {
    const ev = fakeEvent({ '/event/packs/theme/neon.json': themePack('neon') });
    const pack = await createAssetStore(opts(ev.fn)).getPack('e:neon', 'theme');
    expect(pack.id).toBe('e:neon');
    expect(pack.kind === 'theme' && pack.data.version).toBe(2);
  });

  it('replaces a v2 theme with extra fields or over the size cap by the default', async () => {
    const extra = { ...themeData(), evil: '<script>' };
    const ev = fakeEvent({
      '/event/packs/theme/extra.json': themePack('extra', extra),
      '/event/packs/theme/broken.json': themePack('broken', { ...themeData(), fog: { color: 'red' } }),
    });
    const store = createAssetStore(opts(ev.fn));
    const fallbackId = listBuiltins('theme')[0]?.id;
    expect((await store.getPack('e:extra', 'theme')).id).toBe(fallbackId);
    expect((await store.getPack('e:broken', 'theme')).id).toBe(fallbackId);
  });

  it('enforces the theme size cap', async () => {
    const big = themeData();
    // 384 prims with long coordinates: valid by schema, but over the JSON cap.
    big.dressing = Array.from({ length: 24 }, (_, i) => ({
      ...structuredClone(fixtureThemeV2.dressing[0]!),
      part: i,
      prims: Array.from({ length: 16 }, () => structuredClone(fixtureThemeV2.dressing[0]!.prims[0]!)),
    }));
    big.decor = Array.from({ length: 8 }, () => structuredClone(fixtureThemeV2.decor[0]!));
    for (const d of big.dressing)
      for (const p of d.prims) p.pos = [1.234567891234567, -2.345678912345678, 3.45678912345678];
    expect(JSON.stringify(big).length).toBeGreaterThan(LIMITS.themePackMaxBytes);
    const ev = fakeEvent({ '/event/packs/theme/big.json': themePack('big', big) });
    const pack = await createAssetStore(opts(ev.fn)).getPack('e:big', 'theme');
    expect(pack.id).toBe(listBuiltins('theme')[0]?.id);
  });
});

describe('r: procedural skins', () => {
  it('builds the skin locally from the theme costume, fetching the theme once', async () => {
    const ev = fakeEvent({ '/event/packs/theme/neon.json': themePack('neon') });
    const store = createAssetStore(opts(ev.fn));
    const [a, b] = await Promise.all([store.getPack('r:neon:42'), store.getPack('r:neon:43')]);
    expect(a.id).toBe('r:neon:42');
    expect(a.kind === 'skin' && a.data).toEqual(randomThemedSkin(themeData().costume, 42));
    expect(b.id).toBe('r:neon:43');
    expect(ev.calls.filter((c) => c.endsWith('.json'))).toEqual(['/event/packs/theme/neon.json']);
  });

  it('falls back when the theme is missing or the id is malformed', async () => {
    const store = createAssetStore(opts(fakeEvent({}).fn));
    const def = listBuiltins('skin')[0]?.id;
    expect((await store.getPack('r:nope:1')).id).toBe(def);
    expect((await store.getPack('r:bad')).id).toBe(def);
  });
});

describe('event preload', () => {
  it('300 players of e: and r: skins: blocking never waits for an image, at most 6 in flight', async () => {
    const files: Record<string, unknown> = { '/event/packs/theme/neon.json': themePack('neon') };
    for (let i = 0; i < 40; i++) files[`/event/packs/skin/s${i}.json`] = skinPack(`s${i}`);
    const ev = fakeEvent(files);
    const players = Array.from({ length: 300 }, (_, i) => ({
      id: i,
      slot: i,
      name: `p${i}`,
      skinId: i % 2 ? `e:s${i % 40}` : `r:neon:${i}`,
    }));
    const cfg = {
      t: 'matchConfig',
      courseId: listBuiltins('course')[0]?.id ?? '',
      themeId: 'e:neon',
      qualifyCount: 10,
      players,
    } as unknown as MatchConfig;
    const store = createAssetStore({ ...opts(ev.fn), concurrency: 6 });
    const pre = store.preloadMatch(cfg, { localPlayerId: 0 });
    const blocking = await pre.blocking;
    expect(blocking.fallbacks).toEqual([]);
    expect(blocking.timedOut).toBe(false);
    expect(ev.calls.some((c) => c.endsWith('.webp'))).toBe(false);
    const bg = await pre.background;
    expect(bg.fallbacks).toEqual([]);
    expect(bg.loaded).toBe(bg.requested);
    expect(ev.peak()).toBeLessThanOrEqual(6);
    expect(new Set(ev.calls).size).toBe(ev.calls.length); // every file fetched once
  });
});

describe('event mode lobby', () => {
  function lobby() {
    const files: Record<string, unknown> = { '/event/manifest.json': fixtureManifest };
    for (const t of fixtureManifest.themes)
      files[`/event/packs/theme/${t.id.slice(2)}.json`] = themePack(t.id.slice(2));
    return fakeEvent(files);
  }

  it('loads and validates the manifest, and returns null for a bad one', async () => {
    expect((await createAssetStore(opts(lobby().fn)).eventManifest())?.eventId).toBe('fixture-event');
    const bad = fakeEvent({ '/event/manifest.json': { version: 9 } });
    expect(await createAssetStore(opts(bad.fn)).eventManifest()).toBeNull();
  });

  it('prefetches the vote cards first, then the @0.5x images, then full size on voteResult', async () => {
    const ev = lobby();
    const store = createAssetStore(opts(ev.fn));
    await store.prefetchLobby();
    const images = ev.calls.filter((c) => c.endsWith('.webp'));
    const firstLow = images.findIndex((c) => c.includes('@0.5x'));
    expect(images[0]).toBe('/event/themes/fixture/vote-card.webp');
    expect(firstLow).toBeGreaterThan(0);
    expect(images.slice(firstLow).every((c) => c.includes('@0.5x') || !c.includes('vote-card'))).toBe(true);
    expect(ev.peak()).toBeLessThanOrEqual(6);
    const before = ev.calls.length;
    await store.voteResult('e:theme-fixture-2');
    const after = ev.calls.slice(before);
    expect(after).toContain('/event/themes/theme-fixture-2/reveal.webp');
    expect(after.some((c) => c.includes('@0.5x'))).toBe(false);
    expect(after.some((c) => c.endsWith('.json'))).toBe(false); // theme is cached
  });

  it('never rejects when the event files are missing', async () => {
    const store = createAssetStore(opts(fakeEvent({}).fn));
    await store.prefetchLobby();
    await store.voteResult('e:missing');
    expect(await store.eventManifest()).toBeNull();
  });
});

describe('themeImages', () => {
  it('lists distinct images, preferring @0.5x when asked', () => {
    const t = themeData();
    expect(themeImages(t, true)).toContain('reveal@0.5x.webp');
    expect(themeImages(t, false)).toContain('reveal.webp');
    expect(themeImages(t, false).some((s) => s.includes('@0.5x'))).toBe(false);
  });
});
