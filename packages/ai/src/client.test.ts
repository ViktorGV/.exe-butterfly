import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { EventManifestSchema } from '@wobble/shared/schemas/event';
import { SkinDefSchema, ThemeDefV2Schema } from '@wobble/shared/schemas/packs';
import { createAiClient, createAiClientFromEnv, parseRetryAfter } from './client.ts';
import type { AiClientConfig, AiLogEvent } from './client.ts';
import {
  AiBudgetError,
  AiConfigError,
  AiHttpError,
  AiInvalidError,
  AiPaymentError,
  AiProviderError,
  AiRefusedError,
} from './errors.ts';
import { DEFAULT_MODELS, resolveModels } from './models.ts';
import { toStrictJsonSchema } from './jsonSchema.ts';
import { createRng, gradientPng, sampleRegex } from './mock.ts';

const Answer = z.object({ title: z.string(), score: z.number(), note: z.string().optional() });

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

type Reply = Response | (() => Response) | Error;

/** fetch stub that serves `replies` in order and records every call. */
function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body ?? '{}')) });
    const next = replies.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const chat = (content: unknown, extra: { finish?: string; refusal?: string; cost?: number; model?: string } = {}) =>
  json({
    id: 'gen-1',
    model: extra.model ?? 'google/gemini-2.5-flash-lite',
    choices: [
      {
        finish_reason: extra.finish ?? 'stop',
        message: {
          role: 'assistant',
          content: typeof content === 'string' ? content : JSON.stringify(content),
          refusal: extra.refusal ?? null,
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, cost: extra.cost ?? 0.001 },
  });

function client(replies: Reply[], config: Partial<AiClientConfig> = {}) {
  const f = fakeFetch(replies);
  const waits: number[] = [];
  const events: AiLogEvent[] = [];
  const ai = createAiClient({
    apiKey: 'sk-or-test-key',
    models: { ...DEFAULT_MODELS },
    fetch: f.fn,
    sleep: async (ms) => {
      waits.push(ms);
    },
    log: (e) => events.push(e),
    ...config,
  });
  return { ai, calls: f.calls, waits, events };
}

const ask = { schema: Answer, name: 'answer', system: 'Be brief.', prompt: 'Rate this idea' };

describe('object(): request shape', () => {
  test('POSTs a strict json_schema chat completion with attribution headers', async () => {
    const { ai, calls } = client([chat({ title: 'Hi', score: 3, note: null })], {
      appUrl: 'https://wobble.example',
      appTitle: 'Wobble Rush 3D',
    });
    const res = await ai.object({ ...ask, temperature: 0.4, fallbackModels: ['openai/gpt-5-mini'] });
    expect(res.data).toEqual({ title: 'Hi', score: 3 });
    expect(res.id).toBe('gen-1');
    expect(res.usage).toEqual({ promptTokens: 100, completionTokens: 20, costUsd: 0.001 });

    expect(calls).toHaveLength(1);
    const { url, init, body } = calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-or-test-key');
    expect(headers['HTTP-Referer']).toBe('https://wobble.example');
    expect(headers['X-Title']).toBe('Wobble Rush 3D');
    expect(body.model).toBe(DEFAULT_MODELS.fast);
    expect(body.models).toEqual([DEFAULT_MODELS.fast, 'openai/gpt-5-mini']);
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Rate this idea' },
    ]);
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.temperature).toBe(0.4);
    expect(body.max_tokens).toBe(4096);
    const rf = body.response_format as { type: string; json_schema: Record<string, unknown> };
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.name).toBe('answer');
    expect(rf.json_schema.strict).toBe(true);
    expect(rf.json_schema.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['title', 'score', 'note'],
    });
  });

  test('role picks the model, explicit model wins', async () => {
    const { ai, calls } = client([chat({ title: 'a', score: 1 }), chat({ title: 'a', score: 1 })]);
    await ai.object({ ...ask, role: 'smart' });
    await ai.object({ ...ask, role: 'smart', model: 'x/y' });
    expect(calls[0].body.model).toBe(DEFAULT_MODELS.smart);
    expect(calls[1].body.model).toBe('x/y');
    expect(calls[0].body.models).toBeUndefined();
  });

  test('accepts fenced JSON', async () => {
    const { ai } = client([chat('```json\n{"title":"a","score":2}\n```')]);
    expect((await ai.object(ask)).data).toEqual({ title: 'a', score: 2 });
  });
});

describe('object(): HTTP errors and retries', () => {
  for (const status of [400, 401, 403]) {
    test(`${status} is not retried`, async () => {
      const { ai, calls } = client([json({ error: { message: 'nope' } }, status)]);
      const err = await ai.object(ask).catch((e) => e);
      expect(err).toBeInstanceOf(AiHttpError);
      expect(err.details.status).toBe(status);
      expect(calls).toHaveLength(1);
    });
  }

  test('402 fails fast with a clear error', async () => {
    const { ai, calls } = client([json({ error: { message: 'Insufficient credits' } }, 402)]);
    const err = await ai.object(ask).catch((e) => e);
    expect(err).toBeInstanceOf(AiPaymentError);
    expect(err.message).toContain('out of credits');
    expect(calls).toHaveLength(1);
  });

  for (const status of [408, 429, 502, 503]) {
    test(`${status} is retried with backoff`, async () => {
      const { ai, calls, waits } = client([json({}, status), chat({ title: 'ok', score: 1 })]);
      expect((await ai.object(ask)).data.title).toBe('ok');
      expect(calls).toHaveLength(2);
      expect(waits).toHaveLength(1);
      expect(waits[0]).toBeGreaterThanOrEqual(500);
    });
  }

  test('honours Retry-After (seconds)', async () => {
    const { ai, waits } = client([json({}, 429, { 'retry-after': '7' }), chat({ title: 'ok', score: 1 })]);
    await ai.object(ask);
    expect(waits).toEqual([7000]);
  });

  test('parseRetryAfter handles HTTP dates', () => {
    const now = Date.parse('2026-11-28T10:00:00Z');
    expect(parseRetryAfter('Sat, 28 Nov 2026 10:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });

  test('gives up after 3 retries', async () => {
    const { ai, calls, waits } = client([json({}, 503), json({}, 503), json({}, 503), json({}, 503)]);
    const err = await ai.object(ask).catch((e) => e);
    expect(err).toBeInstanceOf(AiHttpError);
    expect(err.details.status).toBe(503);
    expect(calls).toHaveLength(4);
    expect(waits).toHaveLength(3);
  });

  test('network errors are retried', async () => {
    const { ai, calls } = client([new TypeError('socket hang up'), chat({ title: 'ok', score: 1 })]);
    await ai.object(ask);
    expect(calls).toHaveLength(2);
  });

  test('200 with a retryable error body is retried, using error.metadata.error_type', async () => {
    const providerError = json({ error: { code: 200, message: 'busy', metadata: { error_type: 'overloaded' } } });
    const { ai, calls } = client([providerError, chat({ title: 'ok', score: 1 })]);
    await ai.object(ask);
    expect(calls).toHaveLength(2);
  });

  test('200 with a non-retryable error body throws AiProviderError', async () => {
    const providerError = json({ error: { code: 400, message: 'bad', metadata: { error_type: 'invalid_request' } } });
    const { ai, calls } = client([providerError]);
    const err = await ai.object(ask).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.details.errorType).toBe('invalid_request');
    expect(calls).toHaveLength(1);
  });

  test('error on the first choice counts as a 200-with-error', async () => {
    const { ai } = client([json({ choices: [{ finish_reason: 'error', error: { code: 500, message: 'boom' } }] })]);
    expect(await ai.object(ask).catch((e) => e)).toBeInstanceOf(AiProviderError);
  });
});

describe('object(): content retries', () => {
  test("finish_reason 'length' retries once with more tokens", async () => {
    const { ai, calls } = client([chat('{"title":', { finish: 'length' }), chat({ title: 'ok', score: 1 })]);
    await ai.object({ ...ask, maxTokens: 500 });
    expect(calls.map((c) => c.body.max_tokens)).toEqual([500, 1000]);
  });

  test('refusal retries once, then AiRefusedError', async () => {
    const { ai, calls } = client([chat('', { refusal: 'no' }), chat('', { refusal: 'still no' })]);
    expect(await ai.object(ask).catch((e) => e)).toBeInstanceOf(AiRefusedError);
    expect(calls).toHaveLength(2);
  });

  test('content_filter counts as refusal; a good retry succeeds', async () => {
    const { ai } = client([chat('', { finish: 'content_filter' }), chat({ title: 'ok', score: 1 })]);
    expect((await ai.object(ask)).data.title).toBe('ok');
  });

  test('bad JSON retries once, then AiInvalidError', async () => {
    const { ai, calls } = client([chat('not json'), chat('{also not')]);
    expect(await ai.object(ask).catch((e) => e)).toBeInstanceOf(AiInvalidError);
    expect(calls).toHaveLength(2);
  });

  test('Zod failure retries once and can recover', async () => {
    const { ai, calls } = client([chat({ title: 1, score: 'x' }), chat({ title: 'ok', score: 1 })]);
    const res = await ai.object(ask);
    expect(res.data.title).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(res.usage.costUsd).toBeCloseTo(0.002);
  });

  test('Zod failure twice throws AiInvalidError with issues', async () => {
    const { ai } = client([chat({ title: 1 }), chat({ title: 2 })]);
    const err = await ai.object(ask).catch((e) => e);
    expect(err).toBeInstanceOf(AiInvalidError);
    expect(err.issues.length).toBeGreaterThan(0);
  });
});

describe('cost accounting and budget', () => {
  test('spent() sums usage.cost per model', async () => {
    const { ai } = client([
      chat({ title: 'a', score: 1 }, { cost: 0.002 }),
      chat({ title: 'b', score: 1 }, { cost: 0.003, model: 'anthropic/claude-haiku-5.5' }),
    ]);
    await ai.object(ask);
    await ai.object({ ...ask, role: 'smart' });
    const spent = ai.spent();
    expect(spent.calls).toBe(2);
    expect(spent.costUsd).toBeCloseTo(0.005);
    expect(spent.byModel['google/gemini-2.5-flash-lite']).toEqual({ calls: 1, costUsd: 0.002 });
    expect(spent.byModel['anthropic/claude-haiku-5.5'].costUsd).toBeCloseTo(0.003);
  });

  test('throws AiBudgetError before a call once the budget is used up', async () => {
    const { ai, calls } = client([chat({ title: 'a', score: 1 }, { cost: 0.01 })], { budgetUsd: 0.01 });
    await ai.object(ask);
    expect(await ai.object(ask).catch((e) => e)).toBeInstanceOf(AiBudgetError);
    expect(calls).toHaveLength(1);
  });

  test('throws AiBudgetError when the estimate would exceed the budget', async () => {
    const { ai, calls } = client([], { budgetUsd: 0.0001 });
    expect(await ai.object(ask).catch((e) => e)).toBeInstanceOf(AiBudgetError);
    expect(calls).toHaveLength(0);
  });

  test('logs never contain the key or the prompt', async () => {
    const { ai, events } = client([json({}, 503), chat({ title: 'a', score: 1 })]);
    await ai.object(ask);
    expect(events.map((e) => e.outcome)).toEqual(['retry', 'ok']);
    const text = JSON.stringify(events);
    expect(text).not.toContain('sk-or-test-key');
    expect(text).not.toContain('Rate this idea');
  });
});

describe('vision()', () => {
  test('sends text + image parts with the vision model', async () => {
    const { ai, calls } = client([chat({ title: 'pic', score: 5 })]);
    const png = gradientPng(1, 4, 4);
    await ai.vision({ ...ask, images: ['https://img.example/a.png', { bytes: png, mediaType: 'image/png' }] });
    const body = calls[0].body;
    expect(body.model).toBe(DEFAULT_MODELS.vision);
    const content = (body.messages as { content: unknown }[])[1].content as Record<string, unknown>[];
    expect(content[0]).toEqual({ type: 'text', text: 'Rate this idea' });
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'https://img.example/a.png' } });
    expect(String((content[2].image_url as { url: string }).url)).toStartWith('data:image/png;base64,');
  });
});

describe('image()', () => {
  const png = gradientPng(42, 8, 8);
  const b64 = Buffer.from(png).toString('base64');

  test('uses POST /images with b64_json', async () => {
    const { ai, calls } = client([json({ id: 'img-1', data: [{ b64_json: b64 }], usage: { cost: 0.03 } })]);
    const res = await ai.image({ prompt: 'a sunny island', aspectRatio: '16:9', resolution: '2K' });
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/images');
    expect(calls[0].body).toEqual({
      model: DEFAULT_MODELS.image,
      prompt: 'a sunny island',
      aspect_ratio: '16:9',
      resolution: '2K',
      response_format: 'b64_json',
    });
    expect(res.bytes).toEqual(png);
    expect(res.mediaType).toBe('image/png');
    expect(res.usage.costUsd).toBe(0.03);
    expect(ai.spent().costUsd).toBe(0.03);
  });

  test('falls back to chat completions with modalities when /images is missing, and remembers it', async () => {
    const chatImage = () =>
      json({
        id: 'gen-img',
        choices: [{ message: { content: '', images: [{ image_url: { url: `data:image/png;base64,${b64}` } }] } }],
        usage: { cost: 0.02 },
      });
    const { ai, calls } = client([json({ error: { message: 'Not Found' } }, 404), chatImage(), chatImage()]);
    const res = await ai.image({ prompt: 'a castle' });
    expect(res.bytes).toEqual(png);
    expect(calls[1].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[1].body.modalities).toEqual(['image', 'text']);
    expect(calls[1].body.image_config).toEqual({ aspect_ratio: '1:1', image_size: '1K' });
    await ai.image({ prompt: 'again' });
    expect(calls).toHaveLength(3); // no second /images attempt
  });

  test('no image in the chat fallback -> AiInvalidError', async () => {
    const { ai } = client([json({}, 404), json({ choices: [{ message: { content: 'sorry' } }] })]);
    expect(await ai.image({ prompt: 'x' }).catch((e) => e)).toBeInstanceOf(AiInvalidError);
  });
});

describe('mock mode', () => {
  const mock = () => createAiClient({ mock: true, fetch: (() => Promise.reject(new Error('network!'))) as never });

  test('needs no key and no network; same input -> same output', async () => {
    const a = await mock().object({ schema: SkinDefSchema, name: 'skin', prompt: 'a brave toaster' });
    const b = await mock().object({ schema: SkinDefSchema, name: 'skin', prompt: 'a brave toaster' });
    const c = await mock().object({ schema: SkinDefSchema, name: 'skin', prompt: 'a sleepy cloud' });
    expect(SkinDefSchema.safeParse(a.data).success).toBe(true);
    expect(a.data).toEqual(b.data);
    expect(a.id).toBe(b.id);
    expect(c.data).not.toEqual(a.data);
    expect(a.usage.costUsd).toBe(0);
  });

  test('mock vision is valid and deterministic', async () => {
    const req = { schema: Answer, prompt: 'judge', images: ['https://x/y.png'] };
    expect((await mock().vision(req)).data).toEqual((await mock().vision(req)).data);
  });

  test('placeholder images are deterministic PNGs sized by aspect ratio', async () => {
    const a = await mock().image({ prompt: 'island', aspectRatio: '16:9' });
    const b = await mock().image({ prompt: 'island', aspectRatio: '16:9' });
    expect(a.mediaType).toBe('image/png');
    expect([...a.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(a.bytes).toEqual(b.bytes);
    const view = new DataView(a.bytes.buffer, a.bytes.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([256, 144]);
    expect(a.bytes.length).toBeGreaterThan(50);
  });

  test('createAiClientFromEnv reads WOBBLE_AI_MOCK and model overrides', async () => {
    const ai = createAiClientFromEnv({ WOBBLE_AI_MOCK: '1', WOBBLE_AI_MODEL_FAST: 'test/fast' });
    expect((await ai.object(ask)).model).toBe('test/fast');
    expect(() => createAiClientFromEnv({})).toThrow(AiConfigError);
  });
});

test('resolveModels applies env overrides', () => {
  expect(resolveModels({})).toEqual({ ...DEFAULT_MODELS });
  expect(resolveModels({ WOBBLE_AI_MODEL_IMAGE: ' a/b ' }).image).toBe('a/b');
});

describe('concurrency and cancellation', () => {
  test('in-flight calls count against the budget', async () => {
    const small = { ...ask, maxTokens: 1000 }; // estimated well above $0.0004
    const { ai, calls } = client([chat({ title: 'a', score: 1 }, { cost: 0.0001 })], { budgetUsd: 0.0008 });
    const results = await Promise.allSettled([ai.object(small), ai.object(small)]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(AiBudgetError);
    expect(calls).toHaveLength(1);
  });

  test('aborting during a Retry-After wait stops at once', async () => {
    const controller = new AbortController();
    const { ai, calls } = client([json({}, 429, { 'retry-after': '30' })], {
      sleep: () => {
        queueMicrotask(() => controller.abort(new Error('deadline')));
        return new Promise<void>(() => {});
      },
    });
    const err = await ai.object({ ...ask, signal: controller.signal }).catch((e) => e);
    expect(err.message).toBe('deadline');
    expect(calls).toHaveLength(1);
  });
});

describe('mock mode with the event schemas', () => {
  test('satisfies patterns, integers and nullable parts', async () => {
    const ai = createAiClient({ mock: true });
    for (const prompt of ['one', 'two', 'three', 'four']) {
      const theme = await ai.object({ schema: ThemeDefV2Schema, prompt });
      expect(ThemeDefV2Schema.safeParse(theme.data).success).toBe(true);
      const manifest = await ai.object({ schema: EventManifestSchema, prompt });
      expect(manifest.data.themes).toHaveLength(5);
    }
  });

  test('the theme schema converts to strict mode; records are rejected', () => {
    expect(toStrictJsonSchema(ThemeDefV2Schema).additionalProperties).toBe(false);
    expect(() => toStrictJsonSchema(z.object({ m: z.record(z.string(), z.number()) }))).toThrow('z.record');
  });

  test('sampleRegex handles the shared id patterns', () => {
    const rng = createRng(7);
    const patterns = [
      '^#[0-9a-fA-F]{6}$',
      '^[0-9a-f]{32}$',
      '^(?:[bge]:[a-z0-9][a-z0-9-]{0,63}|r:x:[0-9]{1,10})$',
      '^[a-z0-9-]+(@0\\.5x)?\\.webp$',
    ];
    for (const p of patterns) {
      for (let n = 0; n < 20; n++) expect(sampleRegex(p, rng)).toMatch(new RegExp(p));
    }
    expect(sampleRegex('^[^a]+$', rng)).toBeNull();
  });
});
