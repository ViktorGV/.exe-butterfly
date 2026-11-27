// POST /api/packs/generate (skins only): prompt -> validated, sanitised skin pack. Owned by #22.
// Kept as a factory so tests can inject the AI client, store, limiter, theme lookup and clock.
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  AiBudgetError,
  AiError,
  AiInvalidError,
  AiPaymentError,
  AiRefusedError,
  createAiClientFromEnv,
} from '@wobble/ai';
import type { AiClient } from '@wobble/ai';
import { sanitizePack } from '@wobble/shared/assets/index';
import { GenerateRequestSchema } from '@wobble/shared/schemas/api';
import { SkinDefSchema } from '@wobble/shared/schemas/packs';
import type { Pack, PackStore, RateLimitResult, SkinDef, ThemeDef } from '@wobble/shared/types';
import {
  applyCostumeRules,
  normalizePrompt,
  SKIN_PROMPT_VERSION,
  skinSystemPrompt,
  skinUserPrompt,
} from './skinPrompt.ts';

export interface GenerateLog {
  evt: 'generate';
  outcome: 'ok' | 'cached' | 'invalid' | 'refused' | 'rate_limited' | 'capacity' | 'bad_request';
  model: string | null;
  promptHash: string | null;
  themeId: string | null;
  server: boolean;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface GenerateDeps {
  getAi(): AiClient;
  store: () => PackStore;
  rateLimit(action: string, who: { clientId?: string; ip?: string }): Promise<RateLimitResult>;
  resolveTheme(id: string): Promise<ThemeDef | null>;
  env?: Record<string, string | undefined>;
  now?: () => number;
  log?: (entry: GenerateLog) => void;
  /** Overall deadline for the model call. Default 50 s (the request timeout is 60 s). */
  timeoutMs?: number;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Constant-time comparison of a bearer token with the expected secret. */
export function tokenMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const a = createHash('sha256').update(header.slice(7)).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

/** Cache key: (kind, themeId, prompt version, normalised prompt). */
export function skinPromptHash(prompt: string, themeId: string | null): string {
  return sha256(`skin\n${themeId ?? ''}\n${SKIN_PROMPT_VERSION}\n${normalizePrompt(prompt)}`).slice(0, 32);
}

function clientIp(request: Request): string | undefined {
  const h = request.headers;
  return h.get('fly-client-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined;
}

const newPackId = () => `g:${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

export function createGenerateHandler(deps: GenerateDeps): (request: Request) => Promise<Response> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const daily = { day: '', count: 0 };

  const capReached = () => {
    const cap = Number(env.WOBBLE_DAILY_GEN_CAP);
    if (!Number.isFinite(cap) || cap <= 0) return false;
    const day = new Date(now()).toISOString().slice(0, 10);
    if (daily.day !== day) {
      daily.day = day;
      daily.count = 0;
    }
    return daily.count >= cap;
  };

  return async function handle(request: Request): Promise<Response> {
    const started = now();
    const entry: GenerateLog = {
      evt: 'generate',
      outcome: 'bad_request',
      model: null,
      promptHash: null,
      themeId: null,
      server: false,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      latencyMs: 0,
    };
    const finish = (outcome: GenerateLog['outcome'], response: Response) => {
      entry.outcome = outcome;
      entry.latencyMs = now() - started;
      try {
        (deps.log ?? ((e) => console.log(JSON.stringify(e))))(entry);
      } catch {
        // never fail a request because of logging
      }
      return response;
    };

    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });

    const body = await request.json().catch(() => null);
    const parsed = GenerateRequestSchema.safeParse(body);
    if (!parsed.success) return finish('bad_request', json({ error: 'invalid' }, 422));
    const { prompt, clientId } = parsed.data;
    const themeId = parsed.data.themeId ?? null;
    entry.themeId = themeId;

    const server = tokenMatches(request.headers.get('authorization'), env.WOBBLE_SERVER_TOKEN);
    entry.server = server;

    if (!server) {
      const limit = await deps.rateLimit('generate', { clientId, ip: clientIp(request) });
      if (!limit.ok) {
        const retryAfter = String(Math.max(1, Math.ceil(limit.retryAfterSec)));
        return finish('rate_limited', json({ error: 'rate_limited' }, 429, { 'Retry-After': retryAfter }));
      }
    }

    let theme: ThemeDef | null = null;
    if (themeId) {
      theme = await deps.resolveTheme(themeId);
      if (!theme) return finish('bad_request', json({ error: 'invalid' }, 422));
    }

    const promptHash = skinPromptHash(prompt, themeId);
    entry.promptHash = promptHash;
    const store = deps.store();
    const cached = await store.findByPromptHash('skin', promptHash);
    if (cached) return finish('cached', json({ id: cached.id, kind: cached.kind, pack: cached }));

    if (capReached()) return finish('capacity', json({ error: 'capacity' }, 503));
    daily.count++;

    let skin: SkinDef;
    try {
      const ai = deps.getAi();
      const result = await ai.object({
        role: 'fast',
        schema: SkinDefSchema,
        name: 'skin',
        system: skinSystemPrompt(theme),
        prompt: skinUserPrompt(prompt),
        maxTokens: 2048,
        temperature: 0.8,
        signal: AbortSignal.timeout(deps.timeoutMs ?? 50_000),
      });
      entry.model = result.model;
      entry.promptTokens = result.usage.promptTokens;
      entry.completionTokens = result.usage.completionTokens;
      entry.costUsd = result.usage.costUsd;
      skin = result.data;
    } catch (err) {
      if (err instanceof AiRefusedError) return finish('refused', json({ error: 'refused' }, 422));
      if (err instanceof AiInvalidError) return finish('invalid', json({ error: 'invalid' }, 422));
      // Out of credits, over budget, upstream down, timed out or not configured: tell the caller to fall back.
      if (err instanceof AiPaymentError || err instanceof AiBudgetError) console.error('[generate] AI spend stop');
      else if (!(err instanceof AiError)) console.error('[generate] model call failed:', (err as Error)?.name);
      return finish('capacity', json({ error: 'capacity' }, 503));
    }

    const clean = sanitizePack('skin', skin);
    if (!clean.ok) return finish('invalid', json({ error: 'invalid' }, 422));
    const data = applyCostumeRules(clean.data as SkinDef, theme);

    const pack: Pack = {
      id: newPackId(),
      kind: 'skin',
      name: data.name,
      prompt,
      createdAt: new Date(now()).toISOString(),
      data,
    };
    await store.put(pack);
    // The in-memory seam store indexes prompt hashes through a helper; #23's store does it on put.
    const indexer = (store as Partial<{ indexPromptHash(kind: 'skin', hash: string, id: string): Promise<void> }>)
      .indexPromptHash;
    if (indexer) await indexer.call(store, 'skin', promptHash, pack.id);

    return finish('ok', json({ id: pack.id, kind: pack.kind, pack }));
  };
}

let ai: AiClient | null = null;

/** The process-wide AI client (OPENROUTER_API_KEY, WOBBLE_AI_MOCK, WOBBLE_AI_MODEL_*). */
export function getAiClient(): AiClient {
  ai ??= createAiClientFromEnv(process.env, {
    appTitle: 'Wobble Rush 3D',
    appUrl: process.env.WOBBLE_PUBLIC_URL,
    timeoutMs: 45_000,
  });
  return ai;
}
