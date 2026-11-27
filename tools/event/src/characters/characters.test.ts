import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EventRosterSchema,
  SkinPackSchema,
  fixtureThemeV2,
  normalizeUsername,
  rosterKey,
  sanitizePack,
  skinSignature,
} from '@wobble/shared';
import type { SkinDef } from '@wobble/shared';
import { createEventAi } from '../lib/ai.ts';
import type { MockResponder } from '../lib/ai.ts';
import { createBudgetGuard } from '../lib/budget.ts';
import { createMemoryCache } from '../lib/cache.ts';
import { buildSkin } from './build.ts';
import { contactSheet } from './contact.ts';
import { fixtureThemes, loadRoster, loadSkinPacks, writePools, writeRoster, writeSkinPacks } from './io.ts';
import { characterMockResponder } from './model.ts';
import { pregenerateCharacters, themeSlug } from './pregen.ts';
import type { PregenResult } from './pregen.ts';
import { SAMPLE_PRINCESS, SPECIAL_PROMPTS, sampleSubmissions } from './sample.ts';
import { mockScreen, preScreen } from './screen.ts';

const SECRET = 'test-roster-secret';
const POOL = 150;

function mockAi(responder: MockResponder = characterMockResponder, budgetUsd = 100) {
  return createEventAi({ mock: responder, cache: createMemoryCache(), budget: createBudgetGuard(budgetUsd) });
}

async function run(extra: Partial<Parameters<typeof pregenerateCharacters>[0]> = {}) {
  const { manifest, themes } = fixtureThemes();
  const result = await pregenerateCharacters({
    ai: mockAi(),
    eventId: manifest.eventId,
    secret: SECRET,
    submissions: sampleSubmissions(100),
    themes,
    poolSize: POOL,
    now: '2026-11-28T00:00:00.000Z',
    ...extra,
  });
  return { manifest, themes, result };
}

let cached: Promise<Awaited<ReturnType<typeof run>>> | null = null;
const sampleRun = () => (cached ??= run());

const skinsOf = (r: PregenResult, ids: string[]) => ids.map((id) => r.packs.find((p) => p.id === id)!.data as SkinDef);

describe('screening', () => {
  test('vague, unsafe, empty and IP prompts get the right status', () => {
    for (const p of SPECIAL_PROMPTS.tooVague) expect(mockScreen(p).status).toBe('tooVague');
    for (const p of SPECIAL_PROMPTS.unsafe) expect(mockScreen(p).status).toBe('unsafe');
    for (const p of SPECIAL_PROMPTS.empty) expect(mockScreen(p).status).toBe('empty');
    for (const p of SPECIAL_PROMPTS.ip) {
      const s = mockScreen(p);
      expect(s.status).toBe('ok');
      expect(s.reinterpretedFromIP).toBe(true);
      expect(s.description.toLowerCase()).not.toMatch(/pikachu|batman|taylor|swift/);
    }
  });

  test('the pre-screen catches empty and unsafe prompts without a model call', () => {
    expect(preScreen('  ')?.status).toBe('empty');
    expect(preScreen('a bloody pirate')?.status).toBe('unsafe');
    expect(preScreen(SAMPLE_PRINCESS)).toBeNull();
  });

  test('a pink bubble-gum princess keeps pink, bubbles and a crown', () => {
    const s = mockScreen(SAMPLE_PRINCESS);
    expect(s.status).toBe('ok');
    expect(s.traits.colors).toContain('#ff7ac8');
    expect(s.traits.motifs).toEqual(expect.arrayContaining(['bubbles', 'crown']));
  });
});

describe('pregeneration over a 100-row sample (mock)', () => {
  test('every ok submitter has exactly 5 skins; vague, unsafe and empty have none', async () => {
    const { result, themes } = await sampleRun();
    const subs = sampleSubmissions(100);
    const expectedOk = subs.filter((s) => mockScreen(s.characterPrompt).status === 'ok').length;
    expect(result.counts.ok).toBe(expectedOk);
    expect(result.counts.tooVague).toBe(SPECIAL_PROMPTS.tooVague.length);
    expect(result.counts.unsafe).toBe(SPECIAL_PROMPTS.unsafe.length);
    expect(result.counts.empty).toBe(SPECIAL_PROMPTS.empty.length);
    expect(result.counts.reinterpretedFromIP).toBe(SPECIAL_PROMPTS.ip.length);
    for (const sub of subs) {
      const entry = result.roster.entries[await rosterKey(SECRET, sub.username)]!;
      expect(entry).toBeDefined();
      const ok = mockScreen(sub.characterPrompt).status === 'ok';
      expect(Object.keys(entry.skins)).toHaveLength(ok ? 5 : 0);
      expect(entry.characterPrompt === null).toBe(!ok);
      if (ok) for (const t of themes) expect(entry.skins[t.id]).toMatch(new RegExp(`^e:skin-${t.slug}-[0-9a-f]{10}$`));
    }
  });

  test('each theme has a pool of the configured size, plus a hero and a villain', async () => {
    const { result, themes } = await sampleRun();
    for (const t of themes) {
      expect(result.pools[t.id]).toHaveLength(POOL);
      expect(result.pools[t.id]![0]).toBe(`e:pool-${t.slug}-001`);
      expect(result.cast[t.id]).toEqual({ hero: `e:hero-${t.slug}`, villain: `e:villain-${t.slug}` });
    }
    const hero = result.packs.find((p) => p.id === `e:hero-${themes[0]!.slug}`)!;
    expect(hero.data).toMatchObject({ name: fixtureThemeV2.cast!.hero.name });
  });

  test('all skins pass SkinPackSchema and the sanitizer; signatures are unique per theme', async () => {
    const { result, themes } = await sampleRun();
    for (const p of result.packs) {
      expect(SkinPackSchema.safeParse(p).success).toBe(true);
      expect(sanitizePack('skin', p.data).ok).toBe(true);
    }
    for (const t of themes) {
      const ids = [
        ...Object.values(result.roster.entries).flatMap((e) => (e.skins[t.id] ? [e.skins[t.id]!] : [])),
        ...result.pools[t.id]!,
        result.cast[t.id]!.hero,
        result.cast[t.id]!.villain,
      ];
      const sigs = new Set(skinsOf(result, ids).map(skinSignature));
      expect(sigs.size).toBe(ids.length);
    }
    expect(new Set(result.packs.map((p) => p.id)).size).toBe(result.packs.length);
  });

  test("the person's traits survive into every theme", async () => {
    const { result } = await sampleRun();
    const entry = result.roster.entries[await rosterKey(SECRET, 'Racer_015')]!;
    expect(entry.characterPrompt).toBe(SAMPLE_PRINCESS);
    for (const skin of skinsOf(result, Object.values(entry.skins))) {
      expect(skin.body.color).toBe('#ff7ac8');
      // Her motif accessory comes first, in her colour. (The fixture kit has one headTop accessory only,
      // so here it cannot be added next to hers; real #59 kits have 8+ on several anchors.)
      expect(skin.accessories[0]!.prims[0]!.color).toBe('#ff7ac8');
      expect(skin.name.toLowerCase()).not.toContain('racer_015');
    }
  });

  test('roster.json: hash recomputed from a known username finds the entry; no usernames anywhere', async () => {
    const { result } = await sampleRun();
    const key = await rosterKey(SECRET, '  @RACER_015 ');
    expect(result.roster.entries[key]?.characterPrompt).toBe(SAMPLE_PRINCESS);
    expect(EventRosterSchema.safeParse(result.roster).success).toBe(true);
    const everything = JSON.stringify(result.roster) + JSON.stringify(result.packs);
    for (const s of sampleSubmissions(100)) {
      expect(everything.toLowerCase()).not.toContain(normalizeUsername(s.username));
    }
  });
});

describe('uniqueness', () => {
  test('a duplicate skin is regenerated with a variation hint', async () => {
    const { themes } = fixtureThemes();
    const variations: number[] = [];
    const same = buildSkin({
      seed: 'x',
      traits: mockScreen(SAMPLE_PRINCESS).traits,
      costume: fixtureThemeV2.costume,
      themeWord: 'S',
    });
    const responder: MockResponder = (name, input) => {
      const v = Number((input as { variation: number }).variation);
      if (name === 'character_fuse') {
        variations.push(v);
        return v === 0 ? same : characterMockResponder(name, input);
      }
      return characterMockResponder(name, input);
    };
    const result = await pregenerateCharacters({
      ai: mockAi(responder),
      eventId: 'e',
      secret: SECRET,
      submissions: [
        { username: 'a', characterPrompt: SAMPLE_PRINCESS },
        { username: 'b', characterPrompt: SAMPLE_PRINCESS },
      ],
      themes: themes.slice(0, 1),
      poolSize: 0,
    });
    expect(variations).toContain(1);
    const t = themes[0]!;
    const ids = Object.values(result.roster.entries).map((e) => e.skins[t.id]!);
    expect(new Set(skinsOf(result, ids).map(skinSignature)).size).toBe(2);
    expect(result.fallbacks).toBe(0);
  });

  test('invalid model output falls back to the local builder, so nobody misses a skin', async () => {
    const { themes } = fixtureThemes();
    const responder: MockResponder = (name, input) =>
      name === 'character_fuse' ? { version: 1, name: '' } : characterMockResponder(name, input);
    const result = await pregenerateCharacters({
      ai: mockAi(responder),
      eventId: 'e',
      secret: SECRET,
      submissions: [{ username: 'a', characterPrompt: SAMPLE_PRINCESS }],
      themes,
      poolSize: 3,
    });
    expect(result.fallbacks).toBe(5);
    expect(Object.keys(Object.values(result.roster.entries)[0]!.skins)).toHaveLength(5);
  });

  test('the budget guard stops the run', async () => {
    const { themes } = fixtureThemes();
    await expect(
      pregenerateCharacters({
        ai: mockAi(characterMockResponder, 0.005),
        eventId: 'e',
        secret: SECRET,
        submissions: sampleSubmissions(20),
        themes,
        poolSize: 10,
      }),
    ).rejects.toThrow(/budget/);
  });
});

describe('outputs', () => {
  test('writes packs, pools and roster, and --only-user regenerates one person', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wobble-chars-'));
    const rosterFile = join(dir, 'server', 'roster.json');
    const { manifest, themes, result } = await run({ submissions: sampleSubmissions(12), poolSize: 10 });
    await writeSkinPacks(dir, result.packs, { clean: true });
    const written = await writePools(dir, manifest, result.pools);
    await writeRoster(rosterFile, result.roster);
    expect(written.pools[themes[0]!.id]).toHaveLength(10);
    const onDisk = await loadSkinPacks(dir);
    expect(onDisk).toHaveLength(result.packs.length);

    const subs = sampleSubmissions(12).map((s) =>
      s.username === 'Racer_015'
        ? s
        : s.username === 'Racer_011'
          ? { ...s, characterPrompt: 'a green dragon with wings' }
          : s,
    );
    const again = await pregenerateCharacters({
      ai: mockAi(),
      eventId: manifest.eventId,
      secret: SECRET,
      submissions: subs,
      themes,
      onlyUser: 'racer_011',
      existing: { roster: await loadRoster(rosterFile), skins: onDisk },
    });
    expect(again.packs).toHaveLength(5);
    expect(Object.keys(again.roster.entries)).toHaveLength(Object.keys(result.roster.entries).length);
    const key = await rosterKey(SECRET, 'Racer_011');
    expect(again.roster.entries[key]!.characterPrompt).toBe('a green dragon with wings');
    expect(Object.keys(again.roster.entries[key]!.skins)).toHaveLength(5);
    expect(contactSheet(result, themes)).toContain('Pool (10)');
  });

  test('theme slugs fit the pack id pattern', () => {
    expect(themeSlug('e:theme-sherbet-sky')).toBe('sherbet-sky');
    expect(themeSlug(`e:theme-${'x'.repeat(60)}`).length).toBeLessThanOrEqual(40);
  });
});
