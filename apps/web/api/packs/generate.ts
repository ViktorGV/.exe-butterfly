// POST /api/packs/generate: live skin generation (event-day fallback, #68). Owned by #22.
// { kind: 'skin', prompt, clientId, themeId? } -> 200 { id, kind, pack } | 422 { error: 'invalid' | 'refused' }
//                                              | 429 (Retry-After) | 503 { error: 'capacity' }
import { createGenerateHandler, getAiClient } from '../_lib/llm/generate.ts';
import { resolveTheme } from '../_lib/llm/themes.ts';
import { rateLimit } from '../_lib/ratelimit.ts';
import { getPackStore } from '../_lib/store/index.ts';

export const POST = createGenerateHandler({ getAi: getAiClient, store: getPackStore, rateLimit, resolveTheme });
