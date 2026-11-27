// `bun run event:select`: intake -> screen -> score -> pick 5. See docs/EVENT_PIPELINE.md. Owned by #56.
import { AiBudgetError } from '@wobble/ai';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ColumnConfigSchema } from '../intake/columns.ts';
import { intakeCsv } from '../intake/intake.ts';
import { createEventAiFromOptions } from '../lib/ai.ts';
import { parseCommonArgs } from '../lib/args.ts';
import { BudgetExceededError } from '../lib/budget.ts';
import { DEFAULT_OUT_DIR, writeJson, writeText } from '../lib/files.ts';
import { selectMockResponder } from './mock.ts';
import { renderReport } from './report.ts';
import { runSelection } from './run.ts';

const INPUT_DIR = join(import.meta.dir, '..', '..', 'input');

export const USAGE = `bun run event:select [options]
  --input <file>      form export (default tools/event/input/submissions.csv)
  --columns <file>    JSON map of field -> header (default tools/event/input/columns.json, if present)
  --out <dir>         output folder (default tools/event/out)
  --cache-dir <dir>   AI cache (default tools/event/.cache)
  --budget-usd <n>    stop before spending more than this (default 5)
  --fresh             ignore cached AI results
  --seed <text>       seed for shuffles and ties (default "wobble")
  --mock              offline canned AI (same as WOBBLE_AI_MOCK=1)`;

export interface Logger {
  log(line: string): void;
  error(line: string): void;
}

/** Returns the process exit code: 0 ok, 1 error, 2 budget reached. */
export async function runCli(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  io: Logger = console,
): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.log(USAGE);
    return 0;
  }
  try {
    const args = parseCommonArgs(
      argv,
      {
        input: { type: 'string' },
        columns: { type: 'string' },
        out: { type: 'string' },
        'cache-dir': { type: 'string' },
      },
      env,
    );
    const input = resolve(args.input ?? join(INPUT_DIR, 'submissions.csv'));
    const defaultColumns = join(INPUT_DIR, 'columns.json');
    const columnsFile = args.columns ?? (existsSync(defaultColumns) ? defaultColumns : undefined);
    const columns = columnsFile ? ColumnConfigSchema.parse(JSON.parse(await readFile(columnsFile, 'utf8'))) : {};
    const outDir = resolve(args.out ?? DEFAULT_OUT_DIR);
    const selectionFile = join(outDir, 'selection.json');

    const intake = intakeCsv(await readFile(input, 'utf8'), columns);
    await writeJson(join(outDir, 'submissions.json'), intake);
    io.log(`intake: ${intake.submissions.length} submissions, ${intake.dropped.length} rows dropped`);

    // A selection from an earlier run must never survive a failed one: #59 would build from it.
    await rm(selectionFile, { force: true });
    const ai = createEventAiFromOptions({
      budgetUsd: args.budgetUsd,
      fresh: args.fresh,
      mock: args.mock,
      mockResponder: selectMockResponder,
      cacheDir: args['cache-dir'],
    });
    const run = await runSelection(ai, intake, args.seed);
    const stats = ai.stats();
    await writeText(join(outDir, 'report.md'), renderReport(run, stats, args.mock));
    const cost = `${stats.calls} AI calls, ${stats.cacheHits} cache hits, $${stats.costUsd.toFixed(4)}${args.mock ? ' (mock)' : ''}`;
    if (!run.selection) {
      io.error(`no selection: ${run.error}. See ${join(outDir, 'report.md')}. ${cost}`);
      return 1;
    }
    await writeJson(selectionFile, run.selection);
    for (const p of run.selection.picks) io.log(`  ${p.rank}. ${p.titleIdea} [${p.settingTags[0]}] ${p.scores.total}`);
    for (const note of run.selection.relaxed) io.log(`  note: ${note}`);
    io.log(`wrote ${selectionFile} and report.md. ${cost}`);
    return 0;
  } catch (err) {
    if (err instanceof BudgetExceededError || err instanceof AiBudgetError) {
      io.error(`stopped: ${err.message}. Finished calls are cached; rerun with a higher --budget-usd.`);
      return 2;
    }
    io.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runCli(process.argv.slice(2));
