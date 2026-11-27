import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureManifest, fixtureSkin, fixtureThemeV2, fixtureThemeV2Pack } from '@wobble/shared';
import { randomThemedSkin, rosterKey, skinSignature } from '@wobble/shared/event/index';
import type { EventRoster, SkinDef } from '@wobble/shared/types';
import { DEFAULT_SKIN_ID, createEventDirector, type EventDirectorOptions, type GenerateSkin } from './index.ts';
import { createHttpGenerateSkin, loadEventDirector } from './load.ts';

const SECRET = 'test-secret';
const themes = fixtureManifest.themes.map((t) => t.id);
const T1 = themes[0]!;
const T2 = themes[1]!;
const costumes = Object.fromEntries(themes.map((t) => [t, fixtureThemeV2.costume]));
const altSkin: SkinDef = { ...structuredClone(fixtureSkin), body: { ...fixtureSkin.body, color: '#123456' } };

async function makeRoster(): Promise<EventRoster> {
  return {
    version: 1,
    eventId: fixtureManifest.eventId,
    entries: {
      [await rosterKey(SECRET, 'Pip')]: {
        characterPrompt: 'A pink bubble-gum princess',
        skins: Object.fromEntries(themes.map((t) => [t, 'e:pip-' + t.slice(-1)])),
      },
      [await rosterKey(SECRET, 'Late')]: { characterPrompt: 'A late robot', skins: {} },
      [await rosterKey(SECRET, 'Vague')]: { characterPrompt: null, skins: {} },
      [await rosterKey(SECRET, 'Twin')]: { characterPrompt: null, skins: { [T1]: 'e:twin' } },
    },
  };
}
const roster = await makeRoster();
const skins = Object.fromEntries([
  ...themes.map((t) => ['e:pip-' + t.slice(-1), fixtureSkin] as const),
  ['e:twin', fixtureSkin] as const,
  ['e:pool-a', altSkin] as const,
]);

function director(extra: Partial<EventDirectorOptions> = {}) {
  return createEventDirector({ manifest: fixtureManifest, roster, secret: SECRET, costumes, skins, ...extra });
}
const fakeGen =
  (delayMs: number, calls: string[] = []): GenerateSkin =>
  async ({ themeId }) => {
    calls.push(themeId);
    await Bun.sleep(delayMs);
    return { id: 'g:live-' + themeId.slice(-1), skin: { ...structuredClone(fixtureSkin), name: 'Live' } };
  };

describe('event mode off', () => {
  const d = createEventDirector({ manifest: null, roster: null });
  it('matches nobody and gives everyone the default skin', async () => {
    expect(d.enabled).toBe(false);
    expect(await d.identify('Pip')).toMatchObject({ matched: false, previewSkins: null });
    const out = await d.assignSkins([{ id: 1, name: 'a', matched: false }], T1);
    expect([...out.values()]).toEqual([DEFAULT_SKIN_ID]);
    expect(d.voteOptions()).toEqual([]);
  });
  it('is off without WOBBLE_EVENT_ID', async () => {
    const r = await loadEventDirector({ env: {} });
    expect(r.director.enabled).toBe(false);
    expect(r.reason).toBe('WOBBLE_EVENT_ID not set');
  });
});

describe('identify', () => {
  it('matched: previews the personal skin per theme', async () => {
    const d = director();
    expect(d.enabled).toBe(true);
    const id = await d.identify('  @PIP ', 'a');
    expect(id.matched).toBe(true);
    expect(id.previewSkins![T1]).toBe('e:pip-1');
    expect(Object.keys(id.previewSkins!)).toEqual(themes);
  });
  it('unmatched and vague', async () => {
    const d = director();
    expect(await d.identify('nobody')).toMatchObject({ matched: false, previewSkins: null });
    expect(await d.identify('Vague')).toMatchObject({ matched: true, previewSkins: {} });
  });
  it('duplicate login: the second connection plays unmatched, the first keeps it', async () => {
    const d = director();
    expect((await d.identify('Pip', 'a')).matched).toBe(true);
    expect(await d.identify('pip', 'b')).toMatchObject({ matched: false, notice: 'duplicate' });
    expect((await d.identify('Pip', 'a')).matched).toBe(true); // reconnect, same owner
    d.release('Pip', 'a');
    await Bun.sleep(5);
    expect((await d.identify('pip', 'b')).matched).toBe(true);
  });
  it('voteOptions are the manifest themes', () => expect(director().voteOptions()).toEqual(themes));
});

describe('assignSkins', () => {
  it('personal skin for matched, pool/procedural for the rest, all distinct', async () => {
    const d = director({ manifest: { ...fixtureManifest, pools: { [T1]: ['e:pool-a'] } } });
    const out = await d.assignSkins(
      [
        { id: 1, name: 'Pip', matched: true },
        { id: 2, name: 'stranger', matched: false },
        { id: 3, name: 'other', matched: false },
        { id: 4, name: 'Vague', matched: true },
      ],
      T1,
    );
    expect(out.get(1)).toBe('e:pip-1');
    expect(out.get(2)).toBe('e:pool-a');
    expect(out.get(3)).toMatch(/^r:theme-fixture-1:\d+$/);
    expect(out.get(4)).toMatch(/^r:/);
  });
  it('look-alike personal skins: the later one falls back', async () => {
    const out = await director().assignSkins(
      [
        { id: 1, name: 'Pip', matched: true },
        { id: 2, name: 'Twin', matched: true },
      ],
      T1,
    );
    expect(out.get(1)).toBe('e:pip-1');
    expect(out.get(2)).toMatch(/^[br]:/);
  });
  it('ignores a claimed match flag for unknown names', async () => {
    const out = await director().assignSkins([{ id: 1, name: 'liar', matched: true }], T1);
    expect(out.get(1)).toMatch(/^[br]:/);
  });
  it('missing theme skin with live success: generated on join for every theme, used at assignment', async () => {
    const calls: string[] = [];
    const d = director({ generateSkin: fakeGen(20, calls) });
    await d.identify('Late', 'x');
    expect(calls.sort()).toEqual([...themes].sort());
    const out = await d.assignSkins([{ id: 1, name: 'Late', matched: true }], T2);
    expect(out.get(1)).toBe('g:live-2');
    expect((await d.identify('Late', 'x')).previewSkins![T2]).toBe('g:live-2');
  });
  it('vague prompt never calls live generation', async () => {
    const calls: string[] = [];
    const d = director({ generateSkin: fakeGen(1, calls) });
    await d.identify('Vague');
    await d.assignSkins([{ id: 1, name: 'Vague', matched: true }], T1);
    expect(calls).toEqual([]);
  });
  it('live timeout falls through to the pool/procedural skin, and caches the late result', async () => {
    const d = director({ generateSkin: fakeGen(80, []), liveTimeoutMs: 30 });
    await d.identify('Late');
    const t0 = performance.now();
    const out = await d.assignSkins([{ id: 1, name: 'Late', matched: true }], T1);
    expect(performance.now() - t0).toBeLessThan(75);
    expect(out.get(1)).toMatch(/^[br]:/);
    await Bun.sleep(80);
    expect((await d.assignSkins([{ id: 1, name: 'Late', matched: true }], T1)).get(1)).toBe('g:live-1');
  });
  it('live failure falls back', async () => {
    const d = director({ generateSkin: async () => Promise.reject(new Error('down')) });
    const out = await d.assignSkins([{ id: 1, name: 'Late', matched: true }], T1);
    expect(out.get(1)).toMatch(/^[br]:/);
  });
  it('pool exhaustion moves on to procedural skins; pool picks are stable per username', async () => {
    const d = director({ manifest: { ...fixtureManifest, pools: { [T1]: ['b:fixture-skin', 'e:pool-a'] } } });
    const players = [1, 2, 3, 4].map((id) => ({ id, name: 'p' + id, matched: false }));
    const out = await d.assignSkins(players, T1);
    const vals = [...out.values()];
    expect(vals.filter((v) => v.startsWith('r:'))).toHaveLength(2);
    expect(new Set(vals).size).toBe(4);
    expect(await d.assignSkins(players, T1)).toEqual(out);
  });
  it('300 players in every theme: 300 distinct signatures, under 50 ms', async () => {
    const d = director();
    const players = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, name: 'player' + (i % 150), matched: false }));
    players[0] = { id: 1, name: 'Pip', matched: true };
    for (const t of themes) {
      const t0 = performance.now();
      const out = await d.assignSkins(players, t);
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(50);
      const sigs = new Set(
        [...out.values()].map((id) => {
          const m = /^r:[^:]+:(\d+)$/.exec(id);
          return skinSignature(m ? randomThemedSkin(fixtureThemeV2.costume, Number(m[1])) : (skins[id] ?? fixtureSkin));
        }),
      );
      expect(sigs.size).toBe(300);
    }
  });
  it('unknown theme gives the default skin', async () => {
    const out = await director().assignSkins([{ id: 1, name: 'a', matched: false }], 'e:nope');
    expect(out.get(1)).toBe(DEFAULT_SKIN_ID);
  });
});

describe('loadEventDirector', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wobble-event-'));
  const pub = join(dir, 'public');
  mkdirSync(join(pub, 'event/packs/theme'), { recursive: true });
  mkdirSync(join(pub, 'event/packs/skin'), { recursive: true });
  writeFileSync(join(pub, 'event/manifest.json'), JSON.stringify(fixtureManifest));
  for (const t of themes)
    writeFileSync(join(pub, `event/packs/theme/${t.slice(2)}.json`), JSON.stringify({ ...fixtureThemeV2Pack, id: t }));
  const rosterPath = join(dir, 'roster.json');
  writeFileSync(rosterPath, JSON.stringify(roster));
  const env = { WOBBLE_EVENT_ID: fixtureManifest.eventId, EVENT_ROSTER_SECRET: SECRET };
  const log = () => {};

  it('turns event mode on from disk', async () => {
    const r = await loadEventDirector({ env, rosterPath, publicDir: pub, log });
    expect(r.reason).toBeNull();
    expect(r.director.enabled).toBe(true);
    expect((await r.director.identify('Pip')).matched).toBe(true);
  });
  it('stays off without the secret, with a wrong event id, or a missing roster', async () => {
    for (const o of [
      { env: { WOBBLE_EVENT_ID: 'fixture-event' }, rosterPath },
      { env: { ...env, WOBBLE_EVENT_ID: 'other' }, rosterPath },
      { env, rosterPath: join(dir, 'missing.json') },
    ]) {
      const r = await loadEventDirector({ ...o, publicDir: pub, log });
      expect(r.director.enabled).toBe(false);
      expect(r.reason).toBeString();
    }
  });
});

describe('createHttpGenerateSkin', () => {
  it('posts the skin request with the server token', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const gen = createHttpGenerateSkin({
      baseUrl: 'http://api.test',
      token: 'tok',
      fetch: async (url, init) => {
        seen = { url, init };
        return Response.json({
          id: 'g:abc',
          kind: 'skin',
          pack: { ...fixtureThemeV2Pack, kind: 'skin', id: 'g:abc', data: fixtureSkin },
        });
      },
    });
    const r = await gen({ prompt: 'a robot', themeId: T1, clientId: 'srv-0123456789' });
    expect(r.id).toBe('g:abc');
    expect(seen!.url).toBe('http://api.test/api/packs/generate');
    expect((seen!.init!.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(seen!.init!.body as string)).toEqual({
      kind: 'skin',
      prompt: 'a robot',
      themeId: T1,
      clientId: 'srv-0123456789',
    });
  });
});
