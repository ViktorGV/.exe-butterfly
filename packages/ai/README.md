# @wobble/ai

Owned by #22. The one typed OpenRouter client, used by the API functions, the event pipeline tools (#56, #59, #63) and `tools/eval-packs`. Plain `fetch` to `https://openrouter.ai/api/v1`, no SDK. Server and tools only: never import it from `apps/web/src`.

```ts
import { createAiClient, createAiClientFromEnv } from '@wobble/ai';

const ai = createAiClient({ apiKey: process.env.OPENROUTER_API_KEY, budgetUsd: 0.5, appTitle: 'Wobble Rush 3D' });
// or: createAiClientFromEnv() — reads OPENROUTER_API_KEY, WOBBLE_AI_MOCK, WOBBLE_AI_MODEL_*

const { data, usage } = await ai.object({ role: 'fast', schema: SkinDefSchema, name: 'skin', system, prompt });
const { bytes, mediaType } = await ai.image({ prompt, aspectRatio: '16:9', resolution: '1K' });
const { data: verdict } = await ai.vision({ schema: VerdictSchema, prompt, images: [{ bytes, mediaType }] });
ai.spent(); // { calls, costUsd, byModel }
```

- **Structured output**: `response_format: json_schema` with `strict: true` and `provider.require_parameters: true`. The Zod schema is converted by `toStrictJsonSchema` (closed objects, every property required, optional → nullable, tuples → fixed-length arrays); output is always re-validated with Zod.
- **Models** (`src/models.ts`): roles `fast`, `smart`, `image`, `vision`; override with `WOBBLE_AI_MODEL_FAST|SMART|IMAGE|VISION`. `fallbackModels` maps to OpenRouter's `models` array.
- **Images**: `POST /images` (`b64_json`); if that endpoint is missing (404/405/501) or rejects the request (400), falls back to chat completions with `modalities: ['image', 'text']` and remembers it.
- **Errors**: 400/401/403 → `AiHttpError`, no retry · 402 → `AiPaymentError`, fail fast · 408/429/502/503 and network errors → up to 3 retries with backoff, honouring `Retry-After` · 200 with an error body → `AiProviderError` (retried when `error.metadata.error_type` says rate limit/overload/timeout) · `finish_reason: 'length'` → one retry with double `max_tokens` · refusal / bad JSON / Zod failure → one retry, then `AiRefusedError` / `AiInvalidError`.
- **Cost**: `usage.cost` from every response is summed in `spent()`. With `budgetUsd`, `AiBudgetError` is thrown before any call that would exceed it.
- **Mock mode** (`mock: true` or `WOBBLE_AI_MOCK=1`): deterministic, schema-valid outputs chosen by input hash; images are seeded gradient PNGs made locally. No key, no network.
- **Secrets**: the key comes only from `OPENROUTER_API_KEY` on servers and tools. Log events carry a prompt hash, never the key or the raw prompt.
