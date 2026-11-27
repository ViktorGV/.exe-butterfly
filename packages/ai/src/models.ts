// Model roles for @wobble/ai. Owned by #22.
// Each role can be overridden per process with an env var (WOBBLE_AI_MODEL_<ROLE>).

export const MODEL_ROLES = ['fast', 'smart', 'image', 'vision'] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];
export type ModelMap = Record<ModelRole, string>;

/**
 * Defaults, all listed on openrouter.ai/models (checked 2026-11-28).
 * - fast: idea screening, live skins, bulk characters. Cheap ($0.10 / $0.40 per 1M tokens), supports json_schema.
 * - smart: idea selection and theme art direction, where quality matters more than cost.
 * - image: theme art and character portraits.
 * - vision: image QA (does the art match the brief, is it safe).
 * Pick final defaults with `bun run eval:packs` and record the numbers in the PR.
 */
export const DEFAULT_MODELS: Readonly<ModelMap> = Object.freeze({
  fast: 'google/gemini-2.5-flash-lite',
  smart: 'anthropic/claude-haiku-5.5',
  image: 'google/gemini-3.1-flash-lite-image',
  vision: 'google/gemini-2.5-flash-lite',
});

export const MODEL_ENV_VARS: Readonly<Record<ModelRole, string>> = Object.freeze({
  fast: 'WOBBLE_AI_MODEL_FAST',
  smart: 'WOBBLE_AI_MODEL_SMART',
  image: 'WOBBLE_AI_MODEL_IMAGE',
  vision: 'WOBBLE_AI_MODEL_VISION',
});

/** Role -> model id, with env overrides applied. */
export function resolveModels(env: Record<string, string | undefined> = process.env): ModelMap {
  const out = { ...DEFAULT_MODELS };
  for (const role of MODEL_ROLES) {
    const value = env[MODEL_ENV_VARS[role]]?.trim();
    if (value) out[role] = value;
  }
  return out;
}

/** Rough USD prices used only to estimate a call's cost for the budget guard. Real cost comes from `usage.cost`. */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Flat estimate per generated image. */
  perImage?: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  'google/gemini-2.5-flash-lite': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'anthropic/claude-haiku-5.5': { inputPerMTok: 1, outputPerMTok: 5 },
  // Conservative guess; the image endpoint reports the real cost.
  'google/gemini-3.1-flash-lite-image': { inputPerMTok: 0.1, outputPerMTok: 0.4, perImage: 0.04 },
});

/** Pessimistic cost estimate for one call, or 0 when the model's price is unknown. */
export function estimateCostUsd(model: string, inputChars: number, maxOutputTokens: number, images = 0): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const inputTokens = Math.ceil(inputChars / 3);
  return (
    (inputTokens * price.inputPerMTok + maxOutputTokens * price.outputPerMTok) / 1e6 + images * (price.perImage ?? 0)
  );
}
