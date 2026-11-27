// AI calls for the theme pipeline: structured text, images and vision, each cached and budgeted (#59).
// #56's adapter only covers cached text calls, so this one covers all three with the same cache and guard.
import {
  AiConfigError,
  AiHttpError,
  AiPaymentError,
  estimateCostUsd,
  resolveModels,
  zodToJsonSchema,
} from '@wobble/ai';
import type { AiClient, ModelMap } from '@wobble/ai';
import type { z } from 'zod';
import { buildPrompt } from '../lib/ai.ts';
import { BudgetExceededError } from '../lib/budget.ts';
import type { BudgetGuard } from '../lib/budget.ts';
import { cacheKey } from '../lib/cache.ts';
import type { AiCache } from '../lib/cache.ts';
import { sha256Hex } from '../lib/hash.ts';

export interface ObjectCall<S extends z.ZodType> {
  /** Names the task ("art-direction", "repair", "qa"). The json_schema name, and the mock responder's key. */
  name: string;
  system: string;
  /** Data for the model, sent as JSON inside <data> tags. */
  input: unknown;
  schema: S;
  maxTokens?: number;
  /** Which text model to use. Default "smart". Ignored by vision calls. */
  role?: 'smart' | 'fast';
  /** Skip the cache read for this call. */
  fresh?: boolean;
}

export interface VisionCall<S extends z.ZodType> extends ObjectCall<S> {
  images: { bytes: Uint8Array; mediaType: string }[];
}

export interface ImageCall {
  name: string;
  prompt: string;
  aspectRatio: string;
  /** 0 for the first try; part of the cache key, so each retry is its own cached call. */
  attempt: number;
  fresh?: boolean;
}

export interface CallResult<T> {
  data: T;
  cached: boolean;
  /** When the cached answer was first produced; stable across reruns. */
  createdAt: string;
}

export interface AiStats {
  calls: number;
  cacheHits: number;
  costUsd: number;
  /** Calls whose response reported no cost; they are counted at the estimate. */
  estimatedCalls: number;
}

export interface ThemeAi {
  object<S extends z.ZodType>(call: ObjectCall<S>): Promise<CallResult<z.output<S>>>;
  vision<S extends z.ZodType>(call: VisionCall<S>): Promise<CallResult<z.output<S>>>;
  image(call: ImageCall): Promise<CallResult<Uint8Array>>;
  stats(): AiStats;
}

/** Local stand-ins for the three kinds of call (WOBBLE_AI_MOCK=1). */
export interface MockResponders {
  object(name: string, input: unknown): unknown;
  vision(name: string, input: unknown): unknown;
  image(call: ImageCall): Promise<Uint8Array>;
}

export interface ThemeAiConfig {
  /** Required unless `mock` is given. */
  client?: AiClient;
  mock?: MockResponders;
  cache: AiCache;
  budget: BudgetGuard;
  /** Skip every cache read (results are still written). */
  fresh?: boolean;
  models?: ModelMap;
  /** Pretend price of a mock call, so budget behaviour can be tested. Default 0. */
  mockCostUsd?: number;
  now?: () => Date;
}

/** Price assumed for an image when the model is not in MODEL_PRICES. */
const UNKNOWN_IMAGE_USD = 0.05;

/** Errors that no retry or fallback can fix: stop the whole run. */
export const isFatal = (err: unknown): boolean =>
  err instanceof AiConfigError ||
  err instanceof AiPaymentError ||
  (err instanceof AiHttpError && (err.details.status === 401 || err.details.status === 403));

export const isBudgetError = (err: unknown): boolean =>
  err instanceof BudgetExceededError || (err as Error)?.name === 'AiBudgetError';

interface Fresh {
  stored: unknown;
  costUsd: number;
  model: string;
}

export function createThemeAi(config: ThemeAiConfig): ThemeAi {
  const { cache, budget, mock, client } = config;
  if (!mock && !client) throw new Error('createThemeAi needs a client or mock responders');
  const models: ModelMap = mock
    ? { fast: 'mock/fast', smart: 'mock/smart', image: 'mock/image', vision: 'mock/vision' }
    : (config.models ?? resolveModels(process.env));
  const now = config.now ?? (() => new Date());
  const stats: AiStats = { calls: 0, cacheHits: 0, costUsd: 0, estimatedCalls: 0 };

  async function cached<T>(
    meta: { key: string; name: string; fresh?: boolean; estimateUsd: number },
    read: (stored: unknown) => T | null,
    run: () => Promise<Fresh>,
  ): Promise<CallResult<T>> {
    if (!config.fresh && !meta.fresh) {
      const hit = (await cache.get(meta.key))?.data as { value: unknown; createdAt: string } | undefined;
      const value = hit ? read(hit.value) : null;
      if (value !== null) {
        stats.cacheHits++;
        return { data: value, cached: true, createdAt: hit!.createdAt };
      }
    }
    const estimate = mock ? (config.mockCostUsd ?? 0) : meta.estimateUsd;
    // Reserving keeps parallel calls from overshooting the budget together.
    const settle = budget.reserve(estimate);
    let spent = 0;
    try {
      const res = await run();
      // A response without a cost must still count, or the budget would never be reached.
      const unpriced = !mock && res.costUsd <= 0;
      if (unpriced) stats.estimatedCalls++;
      spent = unpriced ? estimate : res.costUsd;
      stats.calls++;
      stats.costUsd += spent;
      const value = read(res.stored);
      if (value === null) throw new Error(`${meta.name}: the answer does not match the schema`);
      const createdAt = now().toISOString();
      await cache.set({
        key: meta.key,
        name: meta.name,
        model: res.model,
        data: { value: res.stored, createdAt },
        costUsd: spent,
      });
      return { data: value, cached: false, createdAt };
    } finally {
      settle(spent);
    }
  }

  function structured<S extends z.ZodType>(call: ObjectCall<S>, images: VisionCall<S>['images'] | null) {
    const model = images ? models.vision : models[call.role ?? 'smart'];
    const prompt = buildPrompt(call.input);
    const maxTokens = call.maxTokens ?? 4096;
    const key = cacheKey({
      model,
      system: call.system,
      input: [prompt, ...(images ?? []).map((i) => sha256Hex(Buffer.from(i.bytes).toString('base64')))].join('\n'),
      schema: zodToJsonSchema(call.schema),
    });
    // Image tokens are not in the text length; add a flat amount for each one.
    const estimateUsd = estimateCostUsd(
      model,
      call.system.length + prompt.length + (images?.length ?? 0) * 3000,
      maxTokens,
    );
    return cached<z.output<S>>(
      { key, name: call.name, fresh: call.fresh, estimateUsd },
      (stored) => {
        const parsed = call.schema.safeParse(stored);
        return parsed.success ? parsed.data : null;
      },
      async () => {
        if (mock) {
          const answer = images ? mock.vision(call.name, call.input) : mock.object(call.name, call.input);
          return { stored: answer, costUsd: config.mockCostUsd ?? 0, model };
        }
        const request = {
          model,
          name: call.name,
          system: call.system,
          prompt,
          schema: call.schema,
          maxTokens,
        };
        const res = images ? await client!.vision({ ...request, images }) : await client!.object(request);
        return { stored: res.data, costUsd: res.usage.costUsd, model: res.model };
      },
    );
  }

  return {
    object: (call) => structured(call, null),
    vision: (call) => structured(call, call.images),
    image(call) {
      const model = models.image;
      const key = cacheKey({
        model,
        system: 'image',
        input: call.prompt,
        schema: { aspectRatio: call.aspectRatio, attempt: call.attempt },
      });
      // An image model without a known price still reserves something, so the budget stays meaningful.
      const estimateUsd = estimateCostUsd(model, call.prompt.length, 0, 1) || UNKNOWN_IMAGE_USD;
      return cached<Uint8Array>(
        { key, name: call.name, fresh: call.fresh, estimateUsd },
        (stored) => (typeof stored === 'string' && stored ? new Uint8Array(Buffer.from(stored, 'base64')) : null),
        async () => {
          const res = mock
            ? { bytes: await mock.image(call), usage: { costUsd: config.mockCostUsd ?? 0 }, model }
            : await client!.image({ model, prompt: call.prompt, aspectRatio: call.aspectRatio, resolution: '1K' });
          return {
            stored: Buffer.from(res.bytes).toString('base64'),
            costUsd: res.usage.costUsd,
            model: res.model,
          };
        },
      );
    },
    stats: () => ({ ...stats }),
  };
}
