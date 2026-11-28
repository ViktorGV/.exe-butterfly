// Rate limits for the pack API (#23). Fixed windows kept in memory: the game server runs as a single Fly Machine,
// so counters do not need to be shared. Every limit is configurable through the environment.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { RateLimitResult } from '@wobble/shared/types';

export interface Rule {
  /** Which part of the caller the counter belongs to. */
  by: 'clientId' | 'ip';
  limit: number;
  windowSec: number;
}

type Env = Record<string, string | undefined>;

const MIN = 60;
const DAY = 24 * 60 * MIN;

/** Reads a positive integer from the environment, or falls back. */
function num(env: Env, name: string, fallback: number): number {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * The rule table. Defaults: generation 5 per 10 minutes and 30 per day per client, 20 per 10 minutes per IP;
 * reads 1200 per minute per IP (a 300-player preload from one event network stays well below it);
 * reports 10 per hour per client and 60 per hour per IP.
 */
export function rulesFromEnv(env: Env = process.env): Record<string, Rule[]> {
  return {
    generate: [
      { by: 'clientId', limit: num(env, 'WOBBLE_GEN_CLIENT_PER_10MIN', 5), windowSec: 10 * MIN },
      { by: 'clientId', limit: num(env, 'WOBBLE_GEN_CLIENT_PER_DAY', 30), windowSec: DAY },
      { by: 'ip', limit: num(env, 'WOBBLE_GEN_IP_PER_10MIN', 20), windowSec: 10 * MIN },
    ],
    read: [{ by: 'ip', limit: num(env, 'WOBBLE_READ_IP_PER_MIN', 1200), windowSec: MIN }],
    report: [
      { by: 'clientId', limit: num(env, 'WOBBLE_REPORT_CLIENT_PER_HOUR', 10), windowSec: 60 * MIN },
      { by: 'ip', limit: num(env, 'WOBBLE_REPORT_IP_PER_HOUR', 60), windowSec: 60 * MIN },
    ],
  };
}

export interface LimiterOptions {
  rules?: Record<string, Rule[]>;
  now?: () => number;
}

export type RateLimiter = (action: string, who: { clientId?: string; ip?: string }) => Promise<RateLimitResult>;

/**
 * Builds a limiter. A request is counted against every rule of its action that has a key for it (a missing clientId
 * or ip skips those rules). It is refused when any counter is already at its limit, and refused requests do not
 * count. Unknown actions are allowed.
 */
export function createRateLimiter({ rules = rulesFromEnv(), now = Date.now }: LimiterOptions = {}): RateLimiter {
  const counters = new Map<string, { windowEnd: number; count: number }>();
  let nextSweep = 0;

  const sweep = (t: number) => {
    if (t < nextSweep) return;
    nextSweep = t + 60_000;
    for (const [key, c] of counters) if (c.windowEnd <= t) counters.delete(key);
  };

  return async (action, who) => {
    const t = now();
    sweep(t);
    const applicable = (rules[action] ?? []).filter((r) => who[r.by]);

    let retryAfterMs = 0;
    const live = applicable.map((r) => {
      const windowMs = r.windowSec * 1000;
      const key = `${action}|${r.by}|${r.windowSec}|${who[r.by]}`;
      let c = counters.get(key);
      if (!c || c.windowEnd <= t) {
        c = { windowEnd: (Math.floor(t / windowMs) + 1) * windowMs, count: 0 };
        counters.set(key, c);
      }
      if (c.count >= r.limit) retryAfterMs = Math.max(retryAfterMs, c.windowEnd - t);
      return c;
    });

    if (retryAfterMs > 0) return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    for (const c of live) c.count++;
    return { ok: true, retryAfterSec: 0 };
  };
}

/** The process-wide limiter used by the API routes. */
export const rateLimit: RateLimiter = createRateLimiter();

/** The caller's IP behind Fly's proxy (or any proxy that sets x-forwarded-for). */
export function clientIp(request: Request): string | undefined {
  const h = request.headers;
  return h.get('fly-client-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined;
}

/** Constant-time check of an `Authorization: Bearer <secret>` header. False when no secret is configured. */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const a = createHash('sha256').update(header.slice(7)).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}
