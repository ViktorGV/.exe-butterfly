// createAiClient: the one OpenRouter client (structured text, images, vision). Owned by #22.
// Plain fetch to https://openrouter.ai/api/v1, no SDK.
import type { z } from 'zod';
import {
  AiBudgetError,
  AiConfigError,
  AiError,
  AiHttpError,
  AiInvalidError,
  AiPaymentError,
  AiProviderError,
  AiRefusedError,
} from './errors.ts';
import { restoreOptionals, strictJsonSchema, zodToJsonSchema } from './jsonSchema.ts';
import { createRng, gradientPng, hashString, mockImageSize, mockValue } from './mock.ts';
import { estimateCostUsd, resolveModels } from './models.ts';
import type { ModelMap, ModelRole } from './models.ts';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface AiLogEvent {
  op: 'object' | 'image' | 'vision';
  model: string;
  /** Hash of the request text; the raw prompt is never logged. */
  promptHash: string;
  attempt: number;
  outcome: 'ok' | 'retry' | 'error';
  latencyMs: number;
  status?: number;
  reason?: string;
  usage?: Usage;
}

export interface AiClientConfig {
  /** OpenRouter key (server-side only: OPENROUTER_API_KEY). Not needed in mock mode. */
  apiKey?: string;
  /** Deterministic offline outputs, no network (WOBBLE_AI_MOCK=1). */
  mock?: boolean;
  /** Attribution headers (HTTP-Referer / X-Title). */
  appUrl?: string;
  appTitle?: string;
  /** Throw AiBudgetError before any call that would push total spend past this. */
  budgetUsd?: number;
  log?: (event: AiLogEvent) => void;
  /** Role -> model overrides. Defaults: resolveModels(process.env). */
  models?: Partial<ModelMap>;
  baseUrl?: string;
  /** Injected for tests. Defaults to globalThis.fetch at call time. */
  fetch?: typeof fetch;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Per HTTP attempt. Default 60 s. */
  timeoutMs?: number;
}

interface ModelChoice {
  role?: ModelRole;
  /** Explicit model id; wins over `role`. */
  model?: string;
  /** Sent as OpenRouter's `models` array after the primary model. */
  fallbackModels?: string[];
  signal?: AbortSignal;
}

export interface ObjectRequest<S extends z.ZodType> extends ModelChoice {
  schema: S;
  /** json_schema name, [a-zA-Z0-9_-]{1,64}. Default "output". */
  name?: string;
  system?: string;
  prompt: string;
  /** Default 4096. Doubled once if the model stops at the limit. */
  maxTokens?: number;
  temperature?: number;
}

export type ImageInput = string | { bytes: Uint8Array; mediaType: string };

export interface VisionRequest<S extends z.ZodType> extends ObjectRequest<S> {
  images: ImageInput[];
}

export interface ImageRequest extends ModelChoice {
  prompt: string;
  /** e.g. "1:1", "16:9". Default "1:1". */
  aspectRatio?: string;
  /** e.g. "1K", "2K". Default "1K". */
  resolution?: string;
}

export interface ObjectResult<T> {
  data: T;
  /** The model that actually answered (may be a fallback). */
  model: string;
  id: string;
  /** Summed over every attempt this call made. */
  usage: Usage;
}

export interface ImageResult {
  bytes: Uint8Array;
  mediaType: string;
  id: string;
  model: string;
  usage: Usage;
}

export interface SpentReport {
  calls: number;
  costUsd: number;
  byModel: Record<string, { calls: number; costUsd: number }>;
}

export interface AiClient {
  object<S extends z.ZodType>(req: ObjectRequest<S>): Promise<ObjectResult<z.output<S>>>;
  image(req: ImageRequest): Promise<ImageResult>;
  vision<S extends z.ZodType>(req: VisionRequest<S>): Promise<ObjectResult<z.output<S>>>;
  spent(): SpentReport;
}

const RETRYABLE_STATUS = new Set([408, 429, 502, 503]);
const RETRYABLE_ERROR_TYPE = /rate.?limit|overload|timeout|unavailable|capacity/i;
const MAX_RETRIES = 3;
const DEFAULT_MAX_TOKENS = 4096;
const MAX_RETRY_WAIT_MS = 30_000;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Retry-After as seconds or an HTTP date -> milliseconds, or null. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Read usage (including `usage.cost`) from an OpenRouter response body. */
export function readUsage(body: unknown): Usage {
  const u = isObj(body) && isObj(body.usage) ? body.usage : {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { promptTokens: num(u.prompt_tokens), completionTokens: num(u.completion_tokens), costUsd: num(u.cost) };
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  promptTokens: a.promptTokens + b.promptTokens,
  completionTokens: a.completionTokens + b.completionTokens,
  costUsd: a.costUsd + b.costUsd,
});
const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };

class RetryableError extends AiError {
  constructor(
    message: string,
    details: AiError['details'],
    readonly retryAfterMs: number | null,
    readonly final: AiError,
  ) {
    super(message, details);
  }
}

export function createAiClient(config: AiClientConfig): AiClient {
  const mock = config.mock ?? false;
  if (!mock && !config.apiKey) throw new AiConfigError('OPENROUTER_API_KEY is not set (or set WOBBLE_AI_MOCK=1)');
  const models: ModelMap = { ...resolveModels(), ...config.models };
  const baseUrl = (config.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/$/, '');
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = config.timeoutMs ?? 60_000;
  const totals: SpentReport = { calls: 0, costUsd: 0, byModel: {} };
  let imagesViaChat = false;
  /** Estimated cost of requests in flight, so concurrent calls cannot overshoot the budget together. */
  let reservedUsd = 0;

  const log = (event: AiLogEvent) => {
    try {
      config.log?.(event);
    } catch {
      // logging must never break a call
    }
  };

  const record = (model: string, usage: Usage) => {
    totals.calls++;
    totals.costUsd += usage.costUsd;
    const entry = (totals.byModel[model] ??= { calls: 0, costUsd: 0 });
    entry.calls++;
    entry.costUsd += usage.costUsd;
  };

  const checkBudget = (estimateUsd: number) => {
    if (config.budgetUsd === undefined) return;
    const committed = totals.costUsd + reservedUsd;
    if (totals.costUsd >= config.budgetUsd || committed + estimateUsd > config.budgetUsd) {
      throw new AiBudgetError(
        `AI budget of $${config.budgetUsd} reached (spent $${totals.costUsd.toFixed(4)}, next call ~$${estimateUsd.toFixed(4)})`,
      );
    }
  };

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (config.appUrl) h['HTTP-Referer'] = config.appUrl;
    if (config.appTitle) h['X-Title'] = config.appTitle;
    return h;
  };

  /** One POST with transport-level retries. Returns the parsed 200 body. */
  async function post(
    path: string,
    body: Json,
    meta: { op: AiLogEvent['op']; model: string; promptHash: string; estimateUsd: number; signal?: AbortSignal },
  ): Promise<Json> {
    for (let attempt = 0; ; attempt++) {
      checkBudget(meta.estimateUsd);
      const started = Date.now();
      const base = { op: meta.op, model: meta.model, promptHash: meta.promptHash, attempt };
      reservedUsd += meta.estimateUsd;
      try {
        const json = await send(path, body, meta.model, meta.signal).finally(() => {
          reservedUsd -= meta.estimateUsd;
        });
        const usage = readUsage(json);
        record(typeof json.model === 'string' ? json.model : meta.model, usage);
        log({ ...base, outcome: 'ok', latencyMs: Date.now() - started, usage });
        return json;
      } catch (err) {
        const latencyMs = Date.now() - started;
        if (err instanceof RetryableError && attempt < MAX_RETRIES) {
          log({ ...base, outcome: 'retry', latencyMs, status: err.details.status, reason: err.message });
          const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
          await abortable(sleep(Math.min(MAX_RETRY_WAIT_MS, err.retryAfterMs ?? backoff)), meta.signal);
          continue;
        }
        const final = err instanceof RetryableError ? err.final : err;
        log({
          ...base,
          outcome: 'error',
          latencyMs,
          status: final instanceof AiError ? final.details.status : undefined,
          reason: final instanceof Error ? final.message : String(final),
        });
        throw final;
      }
    }
  }

  async function send(path: string, body: Json, model: string, signal?: AbortSignal): Promise<Json> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let res: Response;
    let text: string;
    try {
      res = await (config.fetch ?? globalThis.fetch)(`${baseUrl}${path}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      text = await res.text();
    } catch (err) {
      if (signal?.aborted) throw err;
      const final = new AiHttpError(`OpenRouter request failed: ${(err as Error)?.message ?? err}`, {
        model,
        cause: err,
      });
      throw new RetryableError(final.message, { model }, null, final);
    }

    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const errorObj = isObj(json) && isObj(json.error) ? json.error : null;
    const raw = (errorObj?.metadata as { raw?: unknown } | undefined)?.raw;
    const errorMessage =
      (typeof errorObj?.message === 'string' ? errorObj.message : text.slice(0, 200)) +
      (typeof raw === 'string' ? ` (${raw.slice(0, 300)})` : '');

    if (!res.ok) {
      const status = res.status;
      if (status === 402) {
        throw new AiPaymentError(`OpenRouter: out of credits (402). Top up the account. ${errorMessage}`, {
          status,
          model,
        });
      }
      const final = new AiHttpError(`OpenRouter ${status}: ${errorMessage}`, { status, model });
      if (RETRYABLE_STATUS.has(status)) {
        throw new RetryableError(
          final.message,
          { status, model },
          parseRetryAfter(res.headers.get('retry-after')),
          final,
        );
      }
      throw final;
    }

    if (!isObj(json)) throw new AiHttpError('OpenRouter returned a non-JSON body', { status: res.status, model });

    // 200 with an error object (top-level, or on the first choice).
    const choice = Array.isArray(json.choices) && isObj(json.choices[0]) ? json.choices[0] : null;
    const bodyError = errorObj ?? (choice && isObj(choice.error) ? choice.error : null);
    if (bodyError) {
      const metadata = isObj(bodyError.metadata) ? bodyError.metadata : {};
      const errorType = typeof metadata.error_type === 'string' ? metadata.error_type : undefined;
      const code = typeof bodyError.code === 'number' ? bodyError.code : undefined;
      const message = typeof bodyError.message === 'string' ? bodyError.message : 'provider error';
      // Billable even though it failed.
      record(typeof json.model === 'string' ? json.model : model, readUsage(json));
      const final = new AiProviderError(`OpenRouter provider error${errorType ? ` (${errorType})` : ''}: ${message}`, {
        status: code,
        model,
        errorType,
      });
      if ((code !== undefined && RETRYABLE_STATUS.has(code)) || (errorType && RETRYABLE_ERROR_TYPE.test(errorType))) {
        throw new RetryableError(final.message, { status: code, model, errorType }, null, final);
      }
      throw final;
    }
    return json;
  }

  const pickModel = (req: ModelChoice, fallbackRole: ModelRole) => req.model ?? models[req.role ?? fallbackRole];
  const routing = (model: string, req: ModelChoice): Json =>
    req.fallbackModels?.length ? { model, models: [model, ...req.fallbackModels] } : { model };
  const schemaName = (name?: string) => (name ?? 'output').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'output';

  async function structured<S extends z.ZodType>(
    op: 'object' | 'vision',
    req: ObjectRequest<S>,
    userContent: unknown,
    imageRefs: string[],
  ): Promise<ObjectResult<z.output<S>>> {
    const model = pickModel(req, op === 'vision' ? 'vision' : 'fast');
    const original = zodToJsonSchema(req.schema);
    const name = schemaName(req.name);
    const promptHash = hashString(JSON.stringify([op, name, req.system ?? '', req.prompt, imageRefs]));

    if (mock) return mockObject(req.schema, original, model, promptHash);

    const strict = strictJsonSchema(original);
    let maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
    let lengthRetried = false;
    let contentRetried = false;
    let usage = ZERO_USAGE;
    const messages: Json[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: userContent });
    const inputChars = (req.system?.length ?? 0) + req.prompt.length + JSON.stringify(strict).length;

    for (;;) {
      const body: Json = {
        ...routing(model, req),
        messages,
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: strict } },
        provider: { require_parameters: true },
        max_tokens: maxTokens,
        usage: { include: true },
      };
      // Claude 5.x on OpenRouter rejects `temperature` (404 with require_parameters).
      if (req.temperature !== undefined && !model.startsWith('anthropic/')) body.temperature = req.temperature;

      const json = await post('/chat/completions', body, {
        op,
        model,
        promptHash,
        estimateUsd: estimateCostUsd(model, inputChars, maxTokens),
        signal: req.signal,
      });
      usage = addUsage(usage, readUsage(json));
      const choice = Array.isArray(json.choices) && isObj(json.choices[0]) ? json.choices[0] : {};
      const message = isObj(choice.message) ? choice.message : {};
      const finish = choice.finish_reason;
      const served = typeof json.model === 'string' ? json.model : model;
      const id = typeof json.id === 'string' ? json.id : '';

      if (finish === 'length' && !lengthRetried) {
        lengthRetried = true;
        maxTokens *= 2;
        continue;
      }

      const refusal = typeof message.refusal === 'string' && message.refusal.trim() ? message.refusal : null;
      if (refusal || finish === 'content_filter') {
        if (!contentRetried) {
          contentRetried = true;
          continue;
        }
        throw new AiRefusedError(`Model refused: ${refusal ?? 'content filter'}`, { model: served });
      }

      const parsed = parseStructured(message.content, req.schema, original);
      if (parsed.ok) return { data: parsed.data, model: served, id, usage };
      if (!contentRetried) {
        contentRetried = true;
        continue;
      }
      throw new AiInvalidError(`Model output failed validation: ${parsed.issues[0] ?? 'invalid'}`, {
        model: served,
        issues: parsed.issues,
      });
    }
  }

  function mockObject<S extends z.ZodType>(
    schema: S,
    original: Json,
    model: string,
    promptHash: string,
  ): ObjectResult<z.output<S>> {
    const seed = parseInt(promptHash, 16);
    let issues: string[] = [];
    // Refinements are invisible to JSON Schema; try a few seeds before giving up.
    for (let i = 0; i < 8; i++) {
      const value = mockValue(original, createRng(seed + i));
      const result = schema.safeParse(value);
      if (result.success) {
        const usage = { promptTokens: 0, completionTokens: JSON.stringify(value).length >> 2, costUsd: 0 };
        record(model, usage);
        return { data: result.data, model, id: `mock-${promptHash}`, usage };
      }
      issues = result.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`);
    }
    throw new AiInvalidError(`Mock could not satisfy the schema: ${issues[0]}`, { model, issues });
  }

  async function image(req: ImageRequest): Promise<ImageResult> {
    const model = pickModel(req, 'image');
    const aspectRatio = req.aspectRatio ?? '1:1';
    const resolution = req.resolution ?? '1K';
    const promptHash = hashString(JSON.stringify(['image', req.prompt, aspectRatio, resolution]));

    if (mock) {
      const { width, height } = mockImageSize(aspectRatio);
      const usage = { ...ZERO_USAGE };
      record(model, usage);
      return {
        bytes: gradientPng(parseInt(promptHash, 16), width, height),
        mediaType: 'image/png',
        id: `mock-${promptHash}`,
        model,
        usage,
      };
    }

    const meta = {
      op: 'image' as const,
      model,
      promptHash,
      estimateUsd: estimateCostUsd(model, req.prompt.length, 0, 1),
      signal: req.signal,
    };

    if (!imagesViaChat) {
      try {
        const json = await post(
          '/images',
          {
            ...routing(model, req),
            prompt: req.prompt,
            aspect_ratio: aspectRatio,
            resolution,
            response_format: 'b64_json',
          },
          meta,
        );
        const first = Array.isArray(json.data) && isObj(json.data[0]) ? json.data[0] : null;
        if (first && typeof first.b64_json === 'string') {
          const bytes = Uint8Array.from(Buffer.from(first.b64_json, 'base64'));
          return {
            bytes,
            mediaType: typeof first.mime_type === 'string' ? first.mime_type : sniffMediaType(bytes),
            id: typeof json.id === 'string' ? json.id : '',
            model: typeof json.model === 'string' ? json.model : model,
            usage: readUsage(json),
          };
        }
        // Unexpected shape: use chat completions from now on rather than paying twice per image.
        imagesViaChat = true;
      } catch (err) {
        const status = err instanceof AiHttpError ? err.details.status : undefined;
        if (status === 404 || status === 405 || status === 501) imagesViaChat = true;
        else if (status !== 400) throw err;
      }
    }

    const json = await post(
      '/chat/completions',
      {
        ...routing(model, req),
        messages: [{ role: 'user', content: req.prompt }],
        modalities: ['image', 'text'],
        image_config: { aspect_ratio: aspectRatio, image_size: resolution },
        usage: { include: true },
      },
      meta,
    );
    const choice = Array.isArray(json.choices) && isObj(json.choices[0]) ? json.choices[0] : {};
    const message = isObj(choice.message) ? choice.message : {};
    const first = Array.isArray(message.images) && isObj(message.images[0]) ? message.images[0] : null;
    const url = first && isObj(first.image_url) && typeof first.image_url.url === 'string' ? first.image_url.url : null;
    const served = typeof json.model === 'string' ? json.model : model;
    if (!url) {
      const refusal = typeof message.refusal === 'string' ? message.refusal : null;
      if (refusal || choice.finish_reason === 'content_filter') {
        throw new AiRefusedError(`Image refused: ${refusal ?? 'content filter'}`, { model: served });
      }
      throw new AiInvalidError('No image in the response', { model: served });
    }
    const decoded = decodeDataUrl(url);
    if (!decoded) throw new AiInvalidError('Image was not a base64 data URL', { model: served });
    return { ...decoded, id: typeof json.id === 'string' ? json.id : '', model: served, usage: readUsage(json) };
  }

  return {
    object: (req) => structured('object', req, req.prompt, []),
    vision: (req) => {
      const refs = req.images.map(imageRef);
      const content = [
        { type: 'text', text: req.prompt },
        ...req.images.map((img) => ({ type: 'image_url', image_url: { url: imageUrl(img) } })),
      ];
      return structured('vision', { ...req, role: req.role ?? 'vision' }, content, refs);
    },
    image,
    spent: () => ({
      calls: totals.calls,
      costUsd: totals.costUsd,
      byModel: Object.fromEntries(Object.entries(totals.byModel).map(([k, v]) => [k, { ...v }])),
    }),
  };
}

/** `wait`, rejected early if the caller's signal aborts. */
function abortable(wait: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return wait;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    wait.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Build a client from env: OPENROUTER_API_KEY, WOBBLE_AI_MOCK, WOBBLE_AI_MODEL_*. */
export function createAiClientFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<AiClientConfig> = {},
): AiClient {
  const mock = env.WOBBLE_AI_MOCK === '1' || env.WOBBLE_AI_MOCK === 'true';
  return createAiClient({ apiKey: env.OPENROUTER_API_KEY, mock, models: resolveModels(env), ...overrides });
}

function parseStructured<S extends z.ZodType>(
  content: unknown,
  schema: S,
  original: Json,
): { ok: true; data: z.output<S> } | { ok: false; issues: string[] } {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content.map((p) => (isObj(p) && typeof p.text === 'string' ? p.text : '')).join('');
  }
  text = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, issues: ['response was not valid JSON'] };
  }
  const result = schema.safeParse(restoreOptionals(value, original));
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, issues: result.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`) };
}

function imageUrl(img: ImageInput): string {
  if (typeof img === 'string') return img;
  return `data:${img.mediaType};base64,${Buffer.from(img.bytes).toString('base64')}`;
}

function imageRef(img: ImageInput): string {
  if (typeof img === 'string') return img.length > 256 ? hashString(img) : img;
  return `${img.mediaType}:${img.bytes.length}:${hashString(Buffer.from(img.bytes).toString('base64'))}`;
}

/** data:<type>;base64,<payload> -> bytes. */
export function decodeDataUrl(url: string): { bytes: Uint8Array; mediaType: string } | null {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s.exec(url);
  if (!match) return null;
  const bytes = Uint8Array.from(Buffer.from(match[2], 'base64'));
  return { bytes, mediaType: match[1] ?? sniffMediaType(bytes) };
}

/** Media type from magic bytes (PNG, JPEG, WebP, GIF). */
export function sniffMediaType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return 'application/octet-stream';
}
