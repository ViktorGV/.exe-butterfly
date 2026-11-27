// bun run eval:packs — 30 skin prompts x N themes x candidate fast models, against the real API. Owned by #22.
// Needs OPENROUTER_API_KEY (or WOBBLE_AI_MOCK=1 for a dry run). Not run in CI.
//
//   bun run eval:packs [--models a/b,c/d] [--themes b:fixture-theme,e:theme-fixture] [--limit 30]
//                      [--budget 0.25] [--concurrency 4] [--out eval-results.json]
import { AiBudgetError, AiInvalidError, AiPaymentError, AiRefusedError, createAiClientFromEnv } from '@wobble/ai';
import { resolveModels } from '@wobble/ai/models';
import { sanitizePack } from '@wobble/shared/assets/index';
import { SkinDefSchema } from '@wobble/shared/schemas/packs';
import { skinSystemPrompt, skinUserPrompt } from '../../../apps/web/api/_lib/llm/skinPrompt.ts';
import { resolveTheme } from '../../../apps/web/api/_lib/llm/themes.ts';
import { EVAL_PROMPTS } from './prompts.ts';
import { summarize, toMarkdown } from './stats.ts';
import type { EvalSample } from './stats.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const models = arg('models', resolveModels().fast).split(',').filter(Boolean);
const themeIds = arg('themes', 'b:fixture-theme,e:theme-fixture').split(',').filter(Boolean);
const limit = Number(arg('limit', String(EVAL_PROMPTS.length)));
const budgetUsd = Number(arg('budget', '0.25'));
const concurrency = Math.max(1, Number(arg('concurrency', '4')));
const out = arg('out', '');

const ai = createAiClientFromEnv(process.env, { appTitle: 'Wobble Rush 3D eval', budgetUsd });
const prompts = EVAL_PROMPTS.slice(0, limit);

const themes = await Promise.all(themeIds.map(async (id) => ({ id, theme: await resolveTheme(id) })));
for (const t of themes) if (!t.theme) throw new Error(`unknown theme ${t.id}`);

const jobs = models.flatMap((model) =>
  themes.flatMap(({ id, theme }) => prompts.map((prompt) => ({ model, themeId: id, theme, prompt }))),
);
console.log(`${jobs.length} skins: ${models.length} model(s) x ${themes.length} theme(s) x ${prompts.length} prompts`);
console.log(`budget $${budgetUsd}${process.env.WOBBLE_AI_MOCK === '1' ? ' (mock mode)' : ''}`);

const samples: EvalSample[] = [];
let stopped = false;

async function run(job: (typeof jobs)[number]): Promise<void> {
  const started = performance.now();
  const sample: EvalSample = {
    model: job.model,
    themeId: job.themeId,
    prompt: job.prompt,
    ok: false,
    outcome: 'error',
    latencyMs: 0,
    costUsd: 0,
  };
  try {
    const res = await ai.object({
      model: job.model,
      schema: SkinDefSchema,
      name: 'skin',
      system: skinSystemPrompt(job.theme),
      prompt: skinUserPrompt(job.prompt),
      maxTokens: 2048,
      temperature: 0.8,
    });
    sample.costUsd = res.usage.costUsd;
    const clean = sanitizePack('skin', res.data);
    sample.ok = clean.ok;
    sample.outcome = clean.ok ? 'valid' : 'unsanitisable';
  } catch (err) {
    if (err instanceof AiRefusedError) sample.outcome = 'refused';
    else if (err instanceof AiInvalidError) sample.outcome = 'invalid';
    else if (err instanceof AiBudgetError || err instanceof AiPaymentError) {
      stopped = true;
      console.error(`stopping: ${(err as Error).message}`);
      return;
    } else console.error(`${job.model} / ${job.themeId}: ${(err as Error).message}`);
  }
  sample.latencyMs = performance.now() - started;
  samples.push(sample);
  process.stdout.write(sample.ok ? '.' : 'x');
}

const queue = [...jobs];
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (queue.length && !stopped) await run(queue.shift()!);
  }),
);

console.log('\n');
console.log(toMarkdown(summarize(samples)));
console.log(`\nspent: $${ai.spent().costUsd.toFixed(4)} over ${ai.spent().calls} calls`);
for (const s of samples.filter((x) => !x.ok)) console.log(`  ${s.outcome}: [${s.model} ${s.themeId}] ${s.prompt}`);
if (out) await Bun.write(out, JSON.stringify({ samples, summary: summarize(samples) }, null, 2));
