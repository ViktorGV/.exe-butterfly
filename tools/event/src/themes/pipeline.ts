// The theme pipeline: art direction for every pick, then all images in order of importance, then each theme
// is fitted to its budget, composed, checked and published, and finally the manifest is written (#59).
import { hexToRgb } from '../images/color.ts';
import { pickChroma } from '../images/chroma.ts';
import { fitBudget } from '../images/budget.ts';
import { placeholderImage } from '../images/placeholder.ts';
import { processImage } from '../images/process.ts';
import type { ImageFile } from '../images/process.ts';
import type { ThemeAi } from './ai.ts';
import { directTheme } from './artDirection.ts';
import type { Direction } from './artDirection.ts';
import { composeTheme } from './compose.ts';
import { writeContactSheet } from './contactSheet.ts';
import type { SheetTheme } from './contactSheet.ts';
import { makeImage } from './images.ts';
import type { SlotColors, SlotResult } from './images.ts';
import { mapLimit, seedFrom } from './lib.ts';
import type { Prompts } from './prompts.ts';
import { FALLBACK_VOTE_CARD, manifestEntry, readPack, writeManifest, writeTheme } from './publish.ts';
import { checkReadability } from './readability.ts';
import type { ScreenshotSource } from './readability.ts';
import type { Pick } from './selection.ts';
import { matchesSlot, planSlots, PRESETS } from './slots.ts';
import type { PresetName, Slot } from './slots.ts';

export interface PipelineOptions {
  picks: Pick[];
  ai: ThemeAi;
  prompts: Prompts;
  /** apps/web/public/event, or a scratch folder for mock runs. */
  eventDir: string;
  /** Where themes.html goes. */
  outDir: string;
  preset: PresetName;
  /** Rebuild only this theme; the others are taken from their published packs. */
  only?: string;
  /** Regenerate this slot (and slots starting with "<slot>-") even if cached. */
  slot?: string;
  /** Slots whose QA is forced to fail, to prove the run survives it. */
  failSlots?: string[];
  eventId?: string;
  /** Image generations in flight. Default 4. */
  concurrency?: number;
  /** Output image size multiplier; tests use a small one. */
  scale?: number;
  screenshots?: ScreenshotSource;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface ThemeReport extends SheetTheme {
  packFile: string;
  imageBytes: number;
  jsonBytes: number;
  proceduralParts: string[];
}

export interface RunReport {
  themes: ThemeReport[];
  manifestWritten: boolean;
  /** Set when image generation stopped early (out of credit). */
  halted: string | null;
  warnings: string[];
  sheet: string;
}

export function slotColors(direction: Direction, slot: Slot): SlotColors {
  const { sky, materials, hud, ground } = direction.theme;
  const names = [
    ...new Set([sky.top, sky.horizon, materials.platformA.color, materials.platformB.color, hud.accent, ground.color]),
  ];
  const main = slot.target.type === 'texture' ? materials[slot.target.materials[0]].color : names[0];
  // A texture should stay near its material colour, so gameplay colours keep their meaning.
  const palette = (slot.kind === 'texture' ? [main] : names).map(hexToRgb);
  return { palette, names, main, chroma: pickChroma(names.map(hexToRgb)) };
}

export async function runThemes(opts: PipelineOptions): Promise<RunReport> {
  const log = opts.log ?? (() => {});
  const counts = PRESETS[opts.preset];
  const picks = opts.only ? opts.picks.filter((p) => p.slug === opts.only) : opts.picks;
  if (!picks.length) throw new Error(`--only ${opts.only}: no pick has that slug`);
  const halt = { reason: null as string | null };
  const warnings: string[] = [];

  const directed = await Promise.all(
    picks.map(async (pick) => {
      const direction = await directTheme(pick, { ai: opts.ai, prompts: opts.prompts, counts });
      log(`${pick.slug}: art direction ready`);
      const slots = planSlots(direction.images, direction.fallbackImages, opts.preset);
      return { pick, direction, slots };
    }),
  );

  if (opts.slot && !directed.some((d) => d.slots.some((s) => matchesSlot(s.id, opts.slot!)))) {
    throw new Error(`--slot ${opts.slot}: no theme has that slot`);
  }

  // Most important images first across all themes, so a spent budget drops the least important everywhere.
  const jobs = directed
    .flatMap((theme, index) => theme.slots.map((slot) => ({ theme, slot, index })))
    .sort((a, b) => a.slot.priority - b.slot.priority || a.index - b.index);
  const results = await mapLimit(jobs, opts.concurrency ?? 4, async ({ theme, slot }) => {
    const result = await makeImage(slot, {
      ai: opts.ai,
      prompts: opts.prompts,
      title: theme.direction.theme.title,
      colors: slotColors(theme.direction, slot),
      scale: opts.scale,
      fresh: opts.slot ? matchesSlot(slot.id, opts.slot) : false,
      forceFail: opts.failSlots?.some((wanted) => matchesSlot(slot.id, wanted)),
      halt,
    });
    log(`${theme.pick.slug}/${slot.id}: ${result.image ? 'ok' : `null (${result.reason})`}`);
    return { slug: theme.pick.slug, result };
  });

  const themes: ThemeReport[] = [];
  for (const { pick, direction } of directed) {
    const own = results.filter((r) => r.slug === pick.slug).map((r) => r.result);
    themes.push(await publishTheme(pick, direction, own, opts, warnings));
    log(`${pick.slug}: published`);
  }

  const entries = [];
  for (const pick of opts.picks) {
    const pack = await readPack(opts.eventDir, pick.slug);
    if (pack) entries.push(await manifestEntry(opts.eventDir, pick.slug, pack.data));
  }
  let manifestWritten = false;
  try {
    await writeManifest(opts.eventDir, entries, opts.eventId);
    manifestWritten = true;
  } catch (err) {
    warnings.push(`manifest.json not written: ${(err as Error).message}`);
  }

  const sheet = `${opts.outDir}/themes.html`;
  const stats = opts.ai.stats();
  await writeContactSheet(
    sheet,
    opts.eventDir,
    themes,
    `${stats.calls} AI calls, ${stats.cacheHits} cache hits, $${stats.costUsd.toFixed(4)} spent`,
  );
  return { themes, manifestWritten, halted: halt.reason, warnings, sheet };
}

async function publishTheme(
  pick: Pick,
  direction: Direction,
  results: SlotResult[],
  opts: PipelineOptions,
  warnings: string[],
): Promise<ThemeReport> {
  const made = results.flatMap((r) =>
    r.image ? [{ id: r.slot.id, kind: r.slot.kind, priority: r.slot.priority, image: r.image }] : [],
  );
  const { kept, dropped } = await fitBudget(made);
  if (dropped.length) warnings.push(`${pick.slug}: dropped to fit the image budget: ${dropped.join(', ')}`);

  const readability = await checkReadability(pick.slug, direction.theme, direction.fallback, {
    ai: opts.ai,
    prompts: opts.prompts,
    counts: PRESETS[opts.preset],
    source: opts.screenshots,
  });

  const images = kept.map((k) => ({ slot: results.find((r) => r.slot.id === k.id)!.slot, ref: k.image.ref }));
  const theme = composeTheme(readability.theme, images, pick.credit);
  const files: ImageFile[] = kept.flatMap((k) => k.image.files);

  if (!theme.art.voteCard) {
    // The manifest needs a vote card picture, so draw one locally from the theme colours.
    const fallback = await fallbackVoteCard(pick.slug, theme.sky.top, theme.sky.horizon, theme.hud.accent, opts.scale);
    files.push(...fallback);
  }

  const previous = await readPack(opts.eventDir, pick.slug);
  const createdAt = direction.createdAt ?? previous?.createdAt ?? (opts.now?.() ?? new Date()).toISOString();
  const file = await writeTheme(
    opts.eventDir,
    pick.slug,
    {
      id: `e:theme-${pick.slug}`,
      kind: 'theme',
      name: theme.title,
      prompt: pick.themePrompt.slice(0, 200),
      createdAt,
      data: theme,
    },
    files,
  );

  const notes = [...direction.notes];
  if (readability.status !== 'skipped') notes.push(`readability ${readability.status}: ${readability.notes}`);
  return {
    slug: pick.slug,
    theme,
    packFile: file,
    imageBytes: files.reduce((n, f) => n + f.bytes.length, 0),
    jsonBytes: Buffer.byteLength(JSON.stringify(theme)),
    proceduralParts: direction.proceduralParts,
    slots: results.map((r) => {
      const wasDropped = dropped.includes(r.slot.id);
      return {
        id: r.slot.id,
        ok: Boolean(r.image) && !wasDropped,
        attempts: r.attempts,
        reason: wasDropped ? 'over the image budget' : r.reason,
      };
    }),
    notes,
    screenshots: readability.screenshots,
  };
}

async function fallbackVoteCard(
  slug: string,
  top: string,
  bottom: string,
  accent: string,
  scale?: number,
): Promise<ImageFile[]> {
  const palette = [top, bottom, accent];
  const bytes = await placeholderImage({ kind: 'card', palette, seed: seedFrom(slug) });
  const processed = await processImage(bytes, {
    base: FALLBACK_VOTE_CARD,
    kind: 'card',
    palette: palette.map(hexToRgb),
    chroma: 'magenta',
    scale,
  });
  if (!processed.ok) throw new Error(`could not draw the fallback vote card: ${processed.reason}`);
  return processed.image.files;
}
