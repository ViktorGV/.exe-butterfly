// Flags of `event:themes` (#59). Mirrors the common flags of #56 but with a smaller default budget.
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { DEFAULT_OUT_DIR } from '../lib/files.ts';
import { PRESETS } from './slots.ts';
import type { PresetName } from './slots.ts';

/** Small on purpose: the whole event shares a few dollars of credit. A lean run is estimated at about $2.50. */
export const DEFAULT_BUDGET_USD = 3;

export const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
export const REAL_EVENT_DIR = join(REPO_ROOT, 'apps', 'web', 'public', 'event');
export const SAMPLE_SELECTION = join(import.meta.dir, '..', '..', 'prompts', 'theme', 'sample-selection.json');

export const USAGE = `bun tools/event/src/themes/cli.ts [flags]

  --mock              offline run with placeholder images (same as WOBBLE_AI_MOCK=1)
  --dry-run           print the plan and the estimated cost; no AI calls, nothing written
  --selection <file>  default tools/event/out/selection.json (mock runs fall back to the sample)
  --out <dir>         event folder; default apps/web/public/event, or tools/event/out/mock/event with --mock
  --only <slug>       rebuild one theme
  --slot <name>       regenerate one slot even if cached: skybox, texture, sprite-2, vote-card, ...
  --fail-slot <name>  force the quality check of a slot to fail (repeatable)
  --preset <name>     ${Object.keys(PRESETS).join(' or ')}; default lean
  --budget-usd <n>    stop spending at this amount; default ${DEFAULT_BUDGET_USD}
  --fresh             ignore the cache (spends again)
  --event-id <id>     eventId written to manifest.json
  --screenshots <dir> course screenshots in <dir>/<slug>/*.png for the readability check
  --concurrency <n>   image generations in flight; default 4
  --help`;

export interface Args {
  mock: boolean;
  dryRun: boolean;
  help: boolean;
  fresh: boolean;
  selection: string;
  /** Whether --selection was passed. */
  selectionGiven: boolean;
  eventDir: string;
  outDir: string;
  only?: string;
  slot?: string;
  failSlots: string[];
  preset: PresetName;
  budgetUsd: number;
  eventId?: string;
  screenshots?: string;
  concurrency: number;
}

function number(raw: string | undefined, name: string, fallback: number, min: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) throw new Error(`--${name} must be a number >= ${min}, got "${raw}"`);
  return value;
}

export function parseThemeArgs(argv: string[], env: Record<string, string | undefined> = process.env): Args {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      mock: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      fresh: { type: 'boolean', default: false },
      selection: { type: 'string' },
      out: { type: 'string' },
      only: { type: 'string' },
      slot: { type: 'string' },
      'fail-slot': { type: 'string', multiple: true },
      preset: { type: 'string', default: 'lean' },
      'budget-usd': { type: 'string' },
      'event-id': { type: 'string' },
      screenshots: { type: 'string' },
      concurrency: { type: 'string' },
    },
  });
  const mock = values.mock || env.WOBBLE_AI_MOCK === '1' || env.WOBBLE_AI_MOCK === 'true';
  const preset = values.preset as string;
  if (!Object.hasOwn(PRESETS, preset)) throw new Error(`--preset must be ${Object.keys(PRESETS).join(' or ')}`);
  // Mock output must never overwrite the real event assets, so it goes to its own folder by default.
  const outDir = mock ? join(DEFAULT_OUT_DIR, 'mock') : DEFAULT_OUT_DIR;
  return {
    mock,
    dryRun: values['dry-run'],
    help: values.help,
    fresh: values.fresh,
    selection: values.selection ? resolve(values.selection) : join(DEFAULT_OUT_DIR, 'selection.json'),
    selectionGiven: values.selection !== undefined,
    eventDir: values.out ? resolve(values.out) : mock ? join(outDir, 'event') : REAL_EVENT_DIR,
    outDir,
    only: values.only,
    slot: values.slot,
    failSlots: values['fail-slot'] ?? [],
    preset: preset as PresetName,
    budgetUsd: number(values['budget-usd'], 'budget-usd', DEFAULT_BUDGET_USD, 0),
    eventId: values['event-id'],
    screenshots: values.screenshots ? resolve(values.screenshots) : undefined,
    concurrency: Math.floor(number(values.concurrency, 'concurrency', 4, 1)),
  };
}

/** KEY=VALUE lines of a .env file. Comments and blank lines are skipped; quotes are removed. */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

/** Load <repo>/.env.local whatever folder the command was started in. Existing variables win. Never logged. */
export async function loadLocalEnv(root: string = REPO_ROOT): Promise<void> {
  const file = Bun.file(join(root, '.env.local'));
  if (!(await file.exists())) return;
  for (const [key, value] of Object.entries(parseEnvFile(await file.text()))) process.env[key] ||= value;
}
