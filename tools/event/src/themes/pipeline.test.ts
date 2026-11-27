// The whole pipeline in mock mode, with small images so it stays fast.
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Glob } from 'bun';
import {
  EventManifestSchema,
  LIMITS,
  sanitizePack,
  THEME_IMAGE_LIMITS,
  ThemeDefV2Schema,
  ThemePackSchema,
} from '@wobble/shared';
import type { ThemeDefV2 } from '@wobble/shared';
import { decode, encodePng, createRaw } from '../images/raw.ts';
import { isSeamless } from '../images/seamless.ts';
import { createThemeAi } from './ai.ts';
import type { MockResponders } from './ai.ts';
import { SAMPLE_SELECTION } from './args.ts';
import { createBudgetGuard, createMemoryCache } from './lib.ts';
import type { AiCache } from './lib.ts';
import { mockResponders } from './mock.ts';
import { runThemes } from './pipeline.ts';
import type { PipelineOptions } from './pipeline.ts';
import { loadPrompts } from './prompts.ts';
import { imageNames } from './publish.ts';
import { readSelection } from './selection.ts';

setDefaultTimeout(60_000);

const picks = await readSelection(SAMPLE_SELECTION);
const prompts = await loadPrompts();
const folders: string[] = [];
afterAll(async () => {
  await Promise.all(folders.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wobble-themes-'));
  folders.push(dir);
  return dir;
}

interface Setup extends Partial<PipelineOptions> {
  cache?: AiCache;
  mock?: Partial<MockResponders>;
  budgetUsd?: number;
}

async function run(setup: Setup = {}) {
  const { cache = createMemoryCache(), mock, budgetUsd = 100, ...options } = setup;
  const eventDir = options.eventDir ?? (await tempDir());
  const ai = createThemeAi({
    mock: { ...mockResponders, ...mock },
    cache,
    budget: createBudgetGuard(budgetUsd),
    mockCostUsd: 0.01,
  });
  const report = await runThemes({
    picks,
    ai,
    prompts,
    outDir: await tempDir(),
    preset: 'lean',
    scale: 1 / 8,
    ...options,
    eventDir,
  });
  return { report, ai, cache, eventDir };
}

const json = (file: string) => Bun.file(file).json();

async function readTheme(eventDir: string, slug: string): Promise<ThemeDefV2> {
  const pack = ThemePackSchema.parse(await json(join(eventDir, 'packs', 'theme', `${slug}.json`)));
  expect(pack.id).toBe(`e:theme-${slug}`);
  return ThemeDefV2Schema.parse(pack.data);
}

/** Every output file and its content. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const names = await Array.fromAsync(new Glob('**/*.{json,webp}').scan({ cwd: dir }));
  const entries = await Promise.all(
    names.sort().map(async (name) => {
      const bytes = await Bun.file(join(dir, name)).bytes();
      return [name.replaceAll('\\', '/'), Bun.hash(bytes).toString()] as const;
    }),
  );
  return Object.fromEntries(entries);
}

describe('theme pipeline (mock)', () => {
  test('publishes 5 themes that pass the schemas, the sanitizer and the image budgets', async () => {
    const { report, eventDir } = await run();
    expect(report.themes).toHaveLength(5);
    expect(report.manifestWritten).toBe(true);
    const manifest = EventManifestSchema.parse(await json(join(eventDir, 'manifest.json')));
    expect(manifest.courseId).toBe('b:gumdrop-gauntlet');
    expect(manifest.themes.map((t) => t.id)).toEqual(picks.map((p) => `e:theme-${p.slug}`));

    for (const pick of picks) {
      const theme = await readTheme(eventDir, pick.slug);
      expect(sanitizePack('theme', theme).ok).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(theme))).toBeLessThanOrEqual(LIMITS.themePackMaxBytes);
      expect(theme.sky.image).not.toBeNull();
      expect(Object.values(theme.materials).filter((m) => m.texture).length).toBeGreaterThanOrEqual(4);
      expect(theme.decor.filter((d) => d.type === 'sprite').length).toBeGreaterThanOrEqual(3);
      expect(theme.landmarks.length).toBeGreaterThanOrEqual(2);
      expect(theme.particles.length).toBeGreaterThanOrEqual(1);
      expect(theme.costume.accessories.length).toBeGreaterThanOrEqual(8);
      expect(theme.dressing.length).toBeGreaterThanOrEqual(3);
      expect(theme.signage.length).toBeGreaterThanOrEqual(1);
      expect(theme.cast!.hero.name).not.toBe(theme.cast!.villain.name);
      expect(Object.values(theme.art).every(Boolean)).toBe(true);

      const folder = join(eventDir, 'themes', pick.slug);
      let total = 0;
      for (const name of imageNames(theme)) {
        const file = Bun.file(join(folder, name));
        expect(await file.exists()).toBe(true);
        total += file.size;
      }
      expect(total).toBeLessThanOrEqual(THEME_IMAGE_LIMITS.totalBytes);
      for (const m of Object.values(theme.materials)) {
        if (m.texture) expect(isSeamless(await decode(await Bun.file(join(folder, m.texture.src)).bytes()))).toBe(true);
      }
    }
    expect(await Bun.file(report.sheet).text()).toContain('Candy Volcano');
  });

  test('a cached rerun rewrites identical files and spends nothing', async () => {
    const first = await run();
    const before = await snapshot(first.eventDir);
    expect(first.ai.stats().costUsd).toBeGreaterThan(0);

    const second = await run({ cache: first.cache, eventDir: await tempDir() });
    expect(second.ai.stats()).toMatchObject({ calls: 0, costUsd: 0 });
    expect(await snapshot(second.eventDir)).toEqual(before);
  });

  test('a slot that keeps failing QA ends as null and the run still succeeds', async () => {
    const { report, eventDir } = await run({ failSlots: ['sprite-2', 'skybox'] });
    expect(report.manifestWritten).toBe(true);
    for (const { slots, theme } of report.themes) {
      const failed = slots.filter((s) => !s.ok);
      expect(failed.map((s) => s.id).sort()).toEqual(['skybox', 'sprite-2']);
      expect(failed.every((s) => s.attempts === 3)).toBe(true);
      expect(theme.sky.image).toBeNull();
      expect(theme.decor.filter((d) => d.type === 'sprite')).toHaveLength(2);
    }
    expect(await Bun.file(join(eventDir, 'themes', picks[0].slug, 'sky.webp')).exists()).toBe(false);
  });

  test('QA verdicts decide: unsafe is rejected, and the retry prompt carries the notes', async () => {
    const prompted: string[] = [];
    const { report } = await run({
      only: picks[0].slug,
      mock: {
        vision: (name, input) => {
          const verdict = mockResponders.vision(name, input) as object;
          const unsafe = (input as { slot: string }).slot === 'reveal';
          return unsafe ? { ...verdict, unsafe: true, notes: 'remove the logo' } : verdict;
        },
        image: (call) => {
          if (call.name === 'reveal') prompted.push(call.prompt);
          return mockResponders.image(call);
        },
      },
    });
    expect(report.themes[0].theme.art.reveal).toBeNull();
    expect(prompted).toHaveLength(3);
    expect(prompted[0]).not.toContain('remove the logo');
    expect(prompted[1]).toContain('remove the logo');
  });

  test('a failed vote card is replaced by a local picture in the manifest only', async () => {
    const { eventDir } = await run({ failSlots: ['vote-card'] });
    const manifest = EventManifestSchema.parse(await json(join(eventDir, 'manifest.json')));
    expect(manifest.themes[0].voteCard).toBe(`/event/themes/${picks[0].slug}/vote-card-fallback.webp`);
    expect((await readTheme(eventDir, picks[0].slug)).art.voteCard).toBeNull();
    expect(await Bun.file(join(eventDir, 'themes', picks[0].slug, 'vote-card-fallback.webp')).exists()).toBe(true);
  });

  test('mechanical checks reject an image before any vision call', async () => {
    let verdicts = 0;
    const flat = await encodePng(createRaw(64, 64));
    const { report } = await run({
      only: picks[0].slug,
      mock: {
        vision: (name, input) => {
          if ((input as { slot: string }).slot.startsWith('sprite')) verdicts++;
          return mockResponders.vision(name, input);
        },
        image: (call) => (call.name.startsWith('sprite') ? Promise.resolve(flat) : mockResponders.image(call)),
      },
    });
    expect(verdicts).toBe(0);
    const sprites = report.themes[0].slots.filter((s) => s.id.startsWith('sprite'));
    expect(sprites.every((s) => !s.ok && s.reason!.includes('background'))).toBe(true);
  });

  test('failed art direction and failing image calls still give 5 complete themes', async () => {
    const { report, eventDir } = await run({
      mock: {
        object: () => {
          throw new Error('model unavailable');
        },
        image: () => Promise.reject(new Error('502 bad gateway')),
      },
    });
    expect(report.manifestWritten).toBe(true);
    expect(report.themes.every((t) => t.proceduralParts.length === 2)).toBe(true);
    const theme = await readTheme(eventDir, picks[2].slug);
    expect(theme.sky.image).toBeNull();
    expect(theme.cast).not.toBeNull();
  });

  test('stops spending at the budget and keeps the most important images', async () => {
    // 10 art calls cost $0.10; each image and its check cost $0.02.
    const { report, ai } = await run({ budgetUsd: 0.3, concurrency: 1 });
    expect(ai.stats().costUsd).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(report.manifestWritten).toBe(true);
    expect(report.themes.every((t) => t.theme.art.voteCard)).toBe(true);
    expect(report.themes.every((t) => !t.theme.art.podium)).toBe(true);
    expect(report.themes[0].slots.some((s) => s.reason?.startsWith('budget'))).toBe(true);
  });

  test('--only rebuilds one theme and keeps the others and the character pools', async () => {
    const first = await run();
    const manifestFile = join(first.eventDir, 'manifest.json');
    const id = `e:theme-${picks[0].slug}`;
    const manifest = await json(manifestFile);
    await Bun.write(manifestFile, JSON.stringify({ ...manifest, pools: { [id]: ['e:skin-a'], 'e:theme-old': [] } }));
    const untouched = await snapshot(join(first.eventDir, 'themes', picks[1].slug));

    const second = await run({ cache: first.cache, eventDir: first.eventDir, only: picks[0].slug, slot: 'sprite' });
    expect(second.report.themes.map((t) => t.slug)).toEqual([picks[0].slug]);
    // 3 sprites and their 3 verdicts were regenerated.
    expect(second.ai.stats().calls).toBe(6);
    expect((await json(manifestFile)).pools).toEqual({ [id]: ['e:skin-a'] });
    expect(await snapshot(join(first.eventDir, 'themes', picks[1].slug))).toEqual(untouched);
  });

  test('removes images an earlier run left in the theme folder', async () => {
    const eventDir = await tempDir();
    const stale = join(eventDir, 'themes', picks[0].slug, 'sprite-9.webp');
    await mkdir(join(eventDir, 'themes', picks[0].slug), { recursive: true });
    await Bun.write(stale, 'old');
    await run({ eventDir });
    expect(await Bun.file(stale).exists()).toBe(false);
  });

  test('a readability failure repairs colours once', async () => {
    const { report } = await run({
      only: picks[0].slug,
      screenshots: async () => [await encodePng(createRaw(32, 32))],
      mock: {
        vision: (name, input) =>
          name === 'readability'
            ? { pathReadable: false, hazardsReadable: true, bouncyReadable: true, notes: 'darker ground' }
            : mockResponders.vision(name, input),
        object: (name, input) => {
          if (name !== 'repair-readability') return mockResponders.object(name, input);
          const look = mockResponders.object('look', { pick: picks[0] }) as { ground: object };
          return { ...look, ground: { ...look.ground, color: '#000000' } };
        },
      },
    });
    expect(report.themes[0].theme.ground.color).toBe('#000000');
    expect(report.themes[0].notes.join(' ')).toContain('readability repaired');
  });
});
