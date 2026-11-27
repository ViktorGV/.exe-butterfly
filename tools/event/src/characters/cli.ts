// bun run event:characters: every submitter's character in all 5 themes, a themed pool, and the
// hero/villain per theme (#63). See docs/EVENT_PIPELINE.md, "Characters (#63)".
import { createEventAiFromOptions } from '../lib/ai.ts';
import { parseCommonArgs } from '../lib/args.ts';
import { writeText } from '../lib/files.ts';
import { contactSheet } from './contact.ts';
import {
  DEFAULT_PATHS,
  fixtureThemes,
  loadRoster,
  loadSkinPacks,
  loadSubmissions,
  loadThemes,
  writePools,
  writeRoster,
  writeSkinPacks,
} from './io.ts';
import { characterMockResponder } from './model.ts';
import { DEFAULT_POOL_SIZE, pregenerateCharacters } from './pregen.ts';

/** Characters get $1 of the $5 credit by default; themes (#59) take $3. */
export const DEFAULT_CHARACTER_BUDGET_USD = 1;
const MOCK_SECRET = 'wobble-mock-roster-secret';

async function main(argv: string[]) {
  const args = parseCommonArgs(argv, {
    submissions: { type: 'string' },
    'public-dir': { type: 'string' },
    roster: { type: 'string' },
    'pool-size': { type: 'string' },
    limit: { type: 'string' },
    concurrency: { type: 'string' },
    'only-user': { type: 'string' },
    themes: { type: 'string' },
  });
  const budgetUsd = argv.includes('--budget-usd') ? args.budgetUsd : DEFAULT_CHARACTER_BUDGET_USD;
  const publicDir = args['public-dir'] ?? DEFAULT_PATHS.publicEvent;
  const rosterFile = args.roster ?? DEFAULT_PATHS.roster;
  const secret = process.env.EVENT_ROSTER_SECRET ?? (args.mock ? MOCK_SECRET : '');
  if (!secret) throw new Error('EVENT_ROSTER_SECRET is not set (the same secret the game server uses)');

  let submissions = await loadSubmissions(args.submissions ?? DEFAULT_PATHS.submissions);
  if (args.limit) submissions = submissions.slice(0, Number(args.limit));
  // --themes fixture: the 5 fixture themes, for runs before #59 has produced anything.
  const { manifest, themes } = args.themes === 'fixture' ? fixtureThemes() : await loadThemes(publicDir);
  const onlyUser = args['only-user'];

  const ai = createEventAiFromOptions({
    budgetUsd,
    fresh: args.fresh,
    mock: args.mock,
    mockResponder: characterMockResponder,
  });
  const result = await pregenerateCharacters({
    ai,
    eventId: manifest.eventId,
    secret,
    submissions,
    themes,
    poolSize: args['pool-size'] ? Number(args['pool-size']) : DEFAULT_POOL_SIZE,
    concurrency: args.concurrency ? Number(args.concurrency) : 8,
    onlyUser,
    existing: onlyUser ? { roster: await loadRoster(rosterFile), skins: await loadSkinPacks(publicDir) } : undefined,
    log: (line) => console.log(line),
  });

  await writeSkinPacks(publicDir, result.packs, { clean: !onlyUser, remove: result.replaced });
  if (!onlyUser) await writePools(publicDir, manifest, result.pools);
  await writeRoster(rosterFile, result.roster);
  await writeText(DEFAULT_PATHS.contactSheet, contactSheet(result, themes));
  const stats = ai.stats();
  console.log(
    `${result.packs.length} skin packs, ${Object.keys(result.roster.entries).length} roster entries, ` +
      `${result.fallbacks} fallback skins. AI: ${stats.calls} calls, ${stats.cacheHits} cache hits, ` +
      `$${stats.costUsd.toFixed(4)}${args.mock ? ' (mock)' : ''}`,
  );
  console.log(`contact sheet: ${DEFAULT_PATHS.contactSheet}`);
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
