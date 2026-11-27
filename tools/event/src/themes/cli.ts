// `event:themes` (#59): turns the 5 picks of selection.json into themes with images. See
// docs/EVENT_PIPELINE.md.
import { join } from 'node:path';
import { createAiClientFromEnv } from '@wobble/ai';
import { createThemeAi } from './ai.ts';
import { loadLocalEnv, parseThemeArgs, SAMPLE_SELECTION, USAGE } from './args.ts';
import type { Args } from './args.ts';
import { estimateRun } from './estimate.ts';
import { createAiCache, createBudgetGuard, writeText } from './lib.ts';
import { mockResponders } from './mock.ts';
import { runThemes } from './pipeline.ts';
import type { RunReport } from './pipeline.ts';
import { loadPrompts } from './prompts.ts';
import { screenshotFolder } from './readability.ts';
import { readSelection } from './selection.ts';
import type { Pick } from './selection.ts';

async function picksFor(args: Args): Promise<Pick[]> {
  const offline = args.mock || args.dryRun;
  if (offline && !args.selectionGiven && !(await Bun.file(args.selection).exists())) {
    console.log('No tools/event/out/selection.json: using the sample selection.');
    return readSelection(SAMPLE_SELECTION);
  }
  return readSelection(args.selection);
}

function dryRun(args: Args, picks: Pick[]): void {
  const chosen = args.only ? picks.filter((p) => p.slug === args.only) : picks;
  const estimate = estimateRun(chosen, args.preset);
  for (const line of estimate.lines) console.log(line);
  console.log(`\nPreset ${args.preset}: ${estimate.images} images.`);
  console.log(
    `Estimated cost about $${estimate.typicalUsd.toFixed(2)}, up to $${estimate.worstUsd.toFixed(2)} if every ` +
      `image needs 3 attempts. The run stops spending at --budget-usd ${args.budgetUsd}.`,
  );
  if (estimate.unpriced.length) console.log(`No price known for: ${estimate.unpriced.join(', ')}`);
  console.log(`Output would go to ${args.eventDir}. Nothing was called or written.`);
}

function summary(report: RunReport): string[] {
  const lines = report.themes.map((t) => {
    const ok = t.slots.filter((s) => s.ok).length;
    const parts = t.proceduralParts.length ? `, PROCEDURAL ${t.proceduralParts.join(' and ')}` : '';
    const size = `${(t.imageBytes / 1024 / 1024).toFixed(2)} MB images, ${t.jsonBytes} B JSON`;
    return `${t.slug}: ${ok}/${t.slots.length} images, ${size}${parts}`;
  });
  for (const t of report.themes) {
    for (const s of t.slots.filter((x) => !x.ok)) lines.push(`  null: ${t.slug}/${s.id}: ${s.reason}`);
    for (const note of t.notes) lines.push(`  note: ${t.slug}: ${note}`);
  }
  if (report.halted) lines.push(`Image generation stopped: ${report.halted}`);
  lines.push(...report.warnings.map((w) => `warning: ${w}`));
  return lines;
}

export async function main(argv: string[]): Promise<number> {
  await loadLocalEnv();
  const args = parseThemeArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const picks = await picksFor(args);
  if (args.dryRun) {
    dryRun(args, picks);
    return 0;
  }
  const ai = createThemeAi({
    mock: args.mock ? mockResponders : undefined,
    client: args.mock
      ? undefined
      : createAiClientFromEnv(process.env, {
          mock: false,
          appTitle: 'Wobble Rush 3D event pipeline',
          budgetUsd: args.budgetUsd,
          timeoutMs: 180_000,
        }),
    cache: createAiCache(),
    budget: createBudgetGuard(args.budgetUsd),
    fresh: args.fresh,
  });
  const started = Date.now();
  const report = await runThemes({
    picks,
    ai,
    prompts: await loadPrompts(),
    eventDir: args.eventDir,
    outDir: args.outDir,
    preset: args.preset,
    only: args.only,
    slot: args.slot,
    failSlots: args.failSlots,
    eventId: args.eventId,
    concurrency: args.concurrency,
    screenshots: args.screenshots ? screenshotFolder(args.screenshots) : undefined,
    log: (line) => console.log(line),
  });
  const stats = ai.stats();
  const spent = `${stats.calls} AI calls, ${stats.cacheHits} cache hits, $${stats.costUsd.toFixed(4)} spent`;
  const lines = [...summary(report), `${spent}, ${Math.round((Date.now() - started) / 1000)} s`];
  console.log(`\n${lines.join('\n')}`);
  console.log(`Themes: ${args.eventDir}\nContact sheet: ${report.sheet}`);
  await writeText(join(args.outDir, 'themes-report.txt'), `${lines.join('\n')}\n`);
  return report.manifestWritten || args.only ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`event:themes failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
