import { describe, expect, it } from 'bun:test';
import { bearerMatches, clientIp, createRateLimiter, rulesFromEnv } from './ratelimit.ts';

const T0 = 1_700_000_000_000 - (1_700_000_000_000 % 86_400_000); // midnight UTC, a boundary of every window below

function limiter(env: Record<string, string> = {}) {
  let t = T0;
  const check = createRateLimiter({ rules: rulesFromEnv(env), now: () => t });
  return { check, set: (ms: number) => (t = T0 + ms), advance: (ms: number) => (t += ms) };
}

describe('rate limits', () => {
  it('allows 5 generations per 10 minutes per client, then answers with Retry-After', async () => {
    const { check, advance } = limiter();
    for (let i = 0; i < 5; i++) expect((await check('generate', { clientId: 'client-aaaa' })).ok).toBe(true);
    advance(60_000);
    const sixth = await check('generate', { clientId: 'client-aaaa' });
    expect(sixth).toEqual({ ok: false, retryAfterSec: 540 });
  });

  it('opens a new window at the boundary', async () => {
    const { check, set } = limiter();
    for (let i = 0; i < 5; i++) await check('generate', { clientId: 'client-aaaa' });
    set(10 * 60_000 - 1);
    expect((await check('generate', { clientId: 'client-aaaa' })).retryAfterSec).toBe(1);
    set(10 * 60_000);
    expect((await check('generate', { clientId: 'client-aaaa' })).ok).toBe(true);
  });

  it('counts clients separately', async () => {
    const { check } = limiter();
    for (let i = 0; i < 5; i++) await check('generate', { clientId: 'client-aaaa' });
    expect((await check('generate', { clientId: 'client-aaaa' })).ok).toBe(false);
    expect((await check('generate', { clientId: 'client-bbbb' })).ok).toBe(true);
  });

  it('applies the per-IP limit across different clients', async () => {
    const { check } = limiter();
    for (let i = 0; i < 20; i++)
      expect((await check('generate', { clientId: `client-${i}xxxx`, ip: '1.2.3.4' })).ok).toBe(true);
    const over = await check('generate', { clientId: 'client-fresh1', ip: '1.2.3.4' });
    expect(over.ok).toBe(false);
    expect((await check('generate', { clientId: 'client-fresh1', ip: '5.6.7.8' })).ok).toBe(true);
  });

  it('applies the daily limit per client, and reports the longest wait', async () => {
    const { check, set } = limiter({ WOBBLE_GEN_CLIENT_PER_10MIN: '1000', WOBBLE_GEN_CLIENT_PER_DAY: '30' });
    for (let i = 0; i < 30; i++) await check('generate', { clientId: 'client-aaaa' });
    set(5 * 3600_000);
    expect(await check('generate', { clientId: 'client-aaaa' })).toEqual({ ok: false, retryAfterSec: 19 * 3600 });
    set(24 * 3600_000);
    expect((await check('generate', { clientId: 'client-aaaa' })).ok).toBe(true);
  });

  it('does not count refused requests', async () => {
    const { check, set } = limiter({ WOBBLE_GEN_CLIENT_PER_10MIN: '1', WOBBLE_GEN_IP_PER_10MIN: '2' });
    await check('generate', { clientId: 'client-aaaa', ip: '1.1.1.1' });
    for (let i = 0; i < 10; i++)
      expect((await check('generate', { clientId: 'client-aaaa', ip: '1.1.1.1' })).ok).toBe(false);
    // The IP counter only saw the one allowed request, so another client on that IP still fits.
    expect((await check('generate', { clientId: 'client-bbbb', ip: '1.1.1.1' })).ok).toBe(true);
    set(10 * 60_000);
    expect((await check('generate', { clientId: 'client-aaaa', ip: '1.1.1.1' })).ok).toBe(true);
  });

  it('skips rules for a key the caller did not send', async () => {
    const { check } = limiter({ WOBBLE_GEN_CLIENT_PER_10MIN: '1' });
    for (let i = 0; i < 5; i++) expect((await check('generate', { ip: '9.9.9.9' })).ok).toBe(true);
  });

  it('allows unknown actions', async () => {
    const { check } = limiter();
    expect((await check('nothing', { clientId: 'client-aaaa', ip: '1.1.1.1' })).ok).toBe(true);
  });

  it('keeps reads generous: a 300-player preload from one IP passes', async () => {
    const { check } = limiter();
    for (let i = 0; i < 300 * 3; i++) expect((await check('read', { ip: '10.0.0.1' })).ok).toBe(true);
  });

  it('limits reports per client', async () => {
    const { check } = limiter();
    for (let i = 0; i < 10; i++) expect((await check('report', { clientId: 'client-aaaa' })).ok).toBe(true);
    expect((await check('report', { clientId: 'client-aaaa' })).retryAfterSec).toBe(3600);
  });

  it('ignores bad environment values', () => {
    const rules = rulesFromEnv({ WOBBLE_GEN_CLIENT_PER_10MIN: 'abc', WOBBLE_READ_IP_PER_MIN: '-4' });
    expect(rules.generate?.[0]?.limit).toBe(5);
    expect(rules.read?.[0]?.limit).toBe(1200);
  });
});

describe('request helpers', () => {
  it('reads the client IP from Fly, then x-forwarded-for', () => {
    expect(
      clientIp(new Request('http://x', { headers: { 'fly-client-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' } })),
    ).toBe('1.1.1.1');
    expect(clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '2.2.2.2, 3.3.3.3' } }))).toBe('2.2.2.2');
    expect(clientIp(new Request('http://x'))).toBeUndefined();
  });

  it('matches bearer tokens and refuses when no secret is set', () => {
    expect(bearerMatches('Bearer s3cret', 's3cret')).toBe(true);
    expect(bearerMatches('Bearer nope', 's3cret')).toBe(false);
    expect(bearerMatches('s3cret', 's3cret')).toBe(false);
    expect(bearerMatches('Bearer s3cret', undefined)).toBe(false);
    expect(bearerMatches(null, 's3cret')).toBe(false);
  });
});
