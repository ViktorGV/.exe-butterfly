import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createAiClient } from '@wobble/ai';
import { createThemeAi } from './ai.ts';
import { directTheme } from './artDirection.ts';
import { loadPrompts } from './prompts.ts';
import { PRESETS } from './slots.ts';
import { DEFAULT_BUDGET_USD, parseEnvFile, parseThemeArgs, REAL_EVENT_DIR, SAMPLE_SELECTION } from './args.ts';
import { estimateRun } from './estimate.ts';
import { createBudgetGuard } from '../lib/budget.ts';
import { createMemoryCache } from '../lib/cache.ts';
import { readSelection } from './selection.ts';
import { LookDraftSchema } from './draft.ts';
import { proceduralDraft } from './procedural.ts';

const picks = await readSelection(SAMPLE_SELECTION);

describe('event:themes flags', () => {
  test('defaults: real output folder, small budget, lean preset', () => {
    const args = parseThemeArgs([], {});
    expect(args).toMatchObject({ mock: false, preset: 'lean', budgetUsd: DEFAULT_BUDGET_USD, concurrency: 4 });
    expect(args.eventDir).toBe(REAL_EVENT_DIR);
  });

  test('mock runs never write over the real event assets', () => {
    for (const args of [parseThemeArgs(['--mock'], {}), parseThemeArgs([], { WOBBLE_AI_MOCK: '1' })]) {
      expect(args.mock).toBe(true);
      expect(args.eventDir).toContain(join('out', 'mock'));
      expect(args.eventDir).not.toBe(REAL_EVENT_DIR);
    }
  });

  test('repeats --fail-slot and rejects typos and bad numbers', () => {
    expect(parseThemeArgs(['--fail-slot', 'skybox', '--fail-slot', 'reveal'], {}).failSlots).toHaveLength(2);
    expect(() => parseThemeArgs(['--budjet-usd', '1'], {})).toThrow();
    expect(() => parseThemeArgs(['--budget-usd', 'lots'], {})).toThrow('--budget-usd');
    expect(() => parseThemeArgs(['--preset', 'huge'], {})).toThrow('--preset');
  });

  test('reads KEY=VALUE lines from .env.local', () => {
    expect(parseEnvFile('# note\nA=1\n export B="two words" \n\nC=\'x\'\r\nbad line')).toEqual({
      A: '1',
      B: 'two words',
      C: 'x',
    });
  });

  test('a lean run is estimated within the default budget', () => {
    const estimate = estimateRun(picks, 'lean');
    expect(estimate.images).toBe(5 * 13);
    expect(estimate.typicalUsd).toBeGreaterThan(0);
    expect(estimate.typicalUsd).toBeLessThanOrEqual(DEFAULT_BUDGET_USD);
    expect(estimateRun(picks, 'full').images).toBeGreaterThan(estimate.images);
  });

  test('a selection file must have 5 picks', async () => {
    await expect(readSelection('does-not-exist.json')).rejects.toThrow('event:select');
  });
});

describe('real client wiring', () => {
  test('sends a strict schema without limits that providers reject, and records the cost', async () => {
    const bodies: Record<string, unknown>[] = [];
    const answer = proceduralDraft(picks[0]).look;
    const client = createAiClient({
      apiKey: 'test-key',
      fetch: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return Response.json({
          id: '1',
          choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.02 },
        });
      }) as unknown as typeof fetch,
    });
    const ai = createThemeAi({ client, cache: createMemoryCache(), budget: createBudgetGuard(1) });
    const call = { name: 'look', system: 'system', input: { pick: picks[0] }, schema: LookDraftSchema };
    expect((await ai.object(call)).data.title).toBe(answer.title);
    expect((await ai.object(call)).cached).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(ai.stats()).toEqual({ calls: 1, cacheHits: 1, costUsd: 0.02, estimatedCalls: 0 });
    const schema = JSON.stringify(bodies[0].response_format);
    expect(schema).toContain('"strict":true');
    expect(schema).not.toMatch(/maxItems|minItems|maxLength|prefixItems|anyOf/);
  });

  /** A client whose server always answers `body` with `status`. */
  const clientFor = (body: unknown, status = 200) =>
    createAiClient({
      apiKey: 'test-key',
      fetch: (async () => Response.json(body, { status })) as unknown as typeof fetch,
    });

  test('an image without a reported cost still counts against the budget', async () => {
    const client = clientFor({ data: [{ b64_json: Buffer.from('image').toString('base64') }] });
    const budget = createBudgetGuard(0.1);
    const ai = createThemeAi({ client, cache: createMemoryCache(), budget });
    const call = { name: 'skybox', prompt: 'a sky', aspectRatio: '16:9', attempt: 0 };
    await ai.image(call);
    expect(budget.spentUsd()).toBeGreaterThan(0);
    expect(ai.stats().estimatedCalls).toBe(1);
    await ai.image({ ...call, attempt: 1 });
    await expect(ai.image({ ...call, attempt: 2 })).rejects.toThrow('budget');
  });

  test('a rejected API key stops the run instead of publishing procedural themes', async () => {
    const ai = createThemeAi({
      client: clientFor({ error: { message: 'invalid key' } }, 401),
      cache: createMemoryCache(),
      budget: createBudgetGuard(1),
    });
    const options = { ai, prompts: await loadPrompts(), counts: PRESETS.lean };
    await expect(directTheme(picks[0], options)).rejects.toThrow('401');
  });
});
