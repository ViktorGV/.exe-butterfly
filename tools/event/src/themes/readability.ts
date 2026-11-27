// Step 6: judge screenshots of the course in the new theme, and repair colours and fog once if needed.
// Taking the screenshots needs the #64 renderer demo (or the #33 harness), so the source is pluggable:
// today it reads PNGs from a folder (--screenshots <dir>/<slug>/*.png) (#59).
import { join } from 'node:path';
import { Glob } from 'bun';
import { z } from 'zod';
import { isFatal } from './ai.ts';
import type { ThemeAi } from './ai.ts';
import { clampLook } from './clamp.ts';
import type { ThemeLook } from './clamp.ts';
import { LookDraftSchema } from './draft.ts';
import { autoFix } from './legibility.ts';
import { fill } from './prompts.ts';
import type { Prompts } from './prompts.ts';
import type { ImageCounts } from './slots.ts';

export type ScreenshotSource = (slug: string) => Promise<Uint8Array[]>;

export const screenshotFolder =
  (dir: string): ScreenshotSource =>
  async (slug) => {
    const folder = join(dir, slug);
    const names = await Array.fromAsync(new Glob('*.png').scan({ cwd: folder })).catch(() => []);
    return Promise.all(names.sort().map((name) => Bun.file(join(folder, name)).bytes()));
  };

export const ReadabilitySchema = z.object({
  pathReadable: z.boolean(),
  hazardsReadable: z.boolean(),
  bouncyReadable: z.boolean(),
  notes: z.string(),
});

export interface ReadabilityResult {
  status: 'skipped' | 'ok' | 'repaired' | 'failed';
  theme: ThemeLook;
  screenshots: Uint8Array[];
  notes: string;
}

export interface ReadabilityOptions {
  ai: ThemeAi;
  prompts: Prompts;
  counts: ImageCounts;
  source?: ScreenshotSource;
}

export async function checkReadability(
  slug: string,
  theme: ThemeLook,
  fallback: ThemeLook,
  opts: ReadabilityOptions,
): Promise<ReadabilityResult> {
  const screenshots = (await opts.source?.(slug)) ?? [];
  const result = (status: ReadabilityResult['status'], look: ThemeLook, notes: string) => ({
    status,
    theme: look,
    screenshots,
    notes,
  });
  if (!screenshots.length) return result('skipped', theme, 'no screenshots');
  try {
    const verdict = await opts.ai.vision({
      name: 'readability',
      system: opts.prompts.readability,
      input: { theme: theme.title },
      images: screenshots.map((bytes) => ({ bytes, mediaType: 'image/png' })),
      schema: ReadabilitySchema,
      maxTokens: 500,
    });
    const { pathReadable, hazardsReadable, bouncyReadable, notes } = verdict.data;
    if (pathReadable && hazardsReadable && bouncyReadable) return result('ok', theme, notes);
    const repair = await opts.ai.object({
      name: 'repair-readability',
      system: fill(opts.prompts.look, { ...opts.counts }),
      input: { currentTheme: theme, fixTheseProblems: [notes] },
      schema: LookDraftSchema,
      maxTokens: 6000,
    });
    // Only colours, light and fog change; names, cast, music and images stay as they were.
    const next = clampLook(repair.data);
    const { sky, fog, light, materials, ground } = next;
    return result('repaired', autoFix({ ...theme, sky, fog, light, materials, ground }, fallback), notes);
  } catch (err) {
    if (isFatal(err)) throw err;
    return result('failed', theme, (err as Error).message);
  }
}
