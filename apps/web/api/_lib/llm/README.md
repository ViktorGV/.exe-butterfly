# api/\_lib/llm

Owned by #22. Live skin generation behind `POST /api/packs/generate` (`../../packs/generate.ts`).

- `skinPrompt.ts`: versioned system and user prompts (`SKIN_PROMPT_VERSION` is part of the cache key). Player text is passed as delimited data, never as instructions.
- `themes.ts`: `resolveTheme(id)` for `themeId` (`b:` via `resolveBuiltin`, `e:` from `apps/web/public/event/packs/theme/<slug>.json`).
- `generate.ts`: `createGenerateHandler(deps)`: validate → rate limit (skipped for `Authorization: Bearer $WOBBLE_SERVER_TOKEN`) → cache by `(skin, themeId, prompt hash)` → daily cap (`WOBBLE_DAILY_GEN_CAP`, 503) → `ai.object({ role: 'fast', schema: SkinDefSchema })` → `sanitizePack` → store → respond. One JSON log line per request (model, prompt hash, tokens, cost, latency, outcome; never the prompt or IP).

Env: `OPENROUTER_API_KEY` (server only), `WOBBLE_AI_MOCK=1` for no-key dev and CI, `WOBBLE_AI_MODEL_FAST`, `WOBBLE_SERVER_TOKEN`, `WOBBLE_DAILY_GEN_CAP`, `WOBBLE_PUBLIC_URL`.
