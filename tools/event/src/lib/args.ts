// Tiny CLI argument parsing shared by the event commands. Owned by #56, shared with #59 and #63.
import { parseArgs } from 'node:util';

export interface CommonArgs {
  /** Stop before summed AI spend (usage.cost) would exceed this. Default 5. */
  budgetUsd: number;
  /** Ignore cached AI results (fresh results are still written to the cache). */
  fresh: boolean;
  /** Deterministic outputs with no network, same as WOBBLE_AI_MOCK=1. */
  mock: boolean;
  /** Seed for shuffles and tie-breaks. Default "wobble". */
  seed: string;
}

export const DEFAULT_BUDGET_USD = 5;

type StringOptions = Record<string, { type: 'string'; default?: string }>;

/**
 * Parse the common flags `--budget-usd <n> --fresh --mock --seed <s>` plus a command's own
 * string options (e.g. `{ input: { type: 'string' } }`). Unknown flags throw, so typos fail loudly.
 */
export function parseCommonArgs<O extends StringOptions>(
  argv: string[],
  extra: O,
  env: Record<string, string | undefined> = process.env,
): CommonArgs & { [K in keyof O]: string | undefined } {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      ...extra,
      'budget-usd': { type: 'string' },
      fresh: { type: 'boolean', default: false },
      mock: { type: 'boolean', default: false },
      seed: { type: 'string', default: 'wobble' },
    },
  });
  const raw = values as Record<string, string | boolean | undefined>;
  const rawBudget = raw['budget-usd'] as string | undefined;
  const budgetUsd = rawBudget === undefined ? DEFAULT_BUDGET_USD : Number(rawBudget);
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    throw new Error(`--budget-usd must be a number >= 0, got "${rawBudget}"`);
  }
  const own: Record<string, string | undefined> = {};
  for (const key of Object.keys(extra)) own[key] = raw[key] as string | undefined;
  return {
    ...(own as { [K in keyof O]: string | undefined }),
    budgetUsd,
    fresh: raw.fresh === true,
    mock: raw.mock === true || env.WOBBLE_AI_MOCK === '1' || env.WOBBLE_AI_MOCK === 'true',
    seed: String(raw.seed),
  };
}
