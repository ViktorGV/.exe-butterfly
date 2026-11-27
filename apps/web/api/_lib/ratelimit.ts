// SEAM. Seeded by #2 with an allow-all stub; replaced by #23 (Redis-backed limits).
import type { RateLimitResult } from '@wobble/shared/types';

/** @param _action e.g. "generate", "read", "report" */
export async function rateLimit(_action: string, _who: { clientId?: string; ip?: string }): Promise<RateLimitResult> {
  return { ok: true, retryAfterSec: 0 };
}
