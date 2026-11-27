import { describe, expect, it } from 'bun:test';
import { fixtureSkinPack, fixtureThemePack } from '@wobble/shared/fixtures/index';
import { GET } from './health.ts';
import { createMemoryPackStore, getPackStore } from './_lib/store/index.ts';
import { rateLimit } from './_lib/ratelimit.ts';

describe('api seams (stubs seeded by #2)', () => {
  it('/api/health answers', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, protocol: 1 });
  });

  it('getPackStore returns a working singleton store', async () => {
    expect(getPackStore()).toBe(getPackStore());
    const store = createMemoryPackStore();
    await store.put(fixtureSkinPack);
    await store.put(fixtureThemePack);
    expect(await store.get(fixtureSkinPack.id)).toEqual(fixtureSkinPack);
    expect(await store.get('g:missing')).toBeNull();
    expect((await store.list({ kind: 'skin' })).items).toHaveLength(1);
    await store.flag(fixtureSkinPack.id);
    expect((await store.list({ kind: 'skin' })).items).toHaveLength(0);
    expect(await store.findByPromptHash('skin', 'nope')).toBeNull();
  });

  it('rateLimit allows everything', async () => {
    expect(await rateLimit('generate', { clientId: 'c', ip: '1.2.3.4' })).toEqual({ ok: true, retryAfterSec: 0 });
  });
});
