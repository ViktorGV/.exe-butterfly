import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../index.ts';

describe('static files', () => {
  const dist = mkdtempSync(join(tmpdir(), 'wobble-dist-'));
  const game = createGameServer({ port: 0, hostname: '127.0.0.1', webDist: dist });
  let base = '';
  beforeAll(() => {
    mkdirSync(join(dist, 'assets'));
    mkdirSync(join(dist, 'event/packs'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>home</title>');
    writeFileSync(join(dist, 'assets/app-abc123.js'), 'console.log(1)');
    writeFileSync(join(dist, 'event/manifest.json'), '{}');
    writeFileSync(join(dist, 'event/packs/p1.json'), '{}');
    writeFileSync(join(dist, '..', 'wobble-secret.txt'), 'secret');
    base = `http://127.0.0.1:${game.listen()}`;
  });
  afterAll(async () => {
    await game.close();
    rmSync(dist, { recursive: true, force: true });
    rmSync(join(dist, '..', 'wobble-secret.txt'), { force: true });
  });

  it('serves index.html at / with security headers', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>home</title>');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(`wss://${new URL(base).host}`);
  });

  it('marks hashed assets and event packs immutable', async () => {
    const asset = await fetch(`${base}/assets/app-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const pack = await fetch(`${base}/event/packs/p1.json`);
    expect(pack.headers.get('cache-control')).toContain('immutable');
    const manifest = await fetch(`${base}/event/manifest.json`);
    expect(manifest.headers.get('cache-control')).toBe('no-cache');
  });

  it('falls back to index.html for unknown paths', async () => {
    const res = await fetch(`${base}/some/client/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>home</title>');
  });

  it('rejects path traversal', async () => {
    // Encoded separators survive URL normalisation and must be refused.
    for (const path of ['/..%2fwobble-secret.txt', '/assets/..%2f..%2fwobble-secret.txt', '/%5c..%5cx', '/a%00b']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(404);
    }
    // Dot segments are collapsed by the URL parser; they must never expose files outside dist.
    for (const path of ['/%2e%2e/wobble-secret.txt', '/../wobble-secret.txt', '/assets/../../wobble-secret.txt']) {
      expect(await (await fetch(`${base}${path}`)).text()).not.toContain('secret');
    }
  });

  it('serves /healthz and WebSocket as before', async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    const ws = new WebSocket(base.replace('http', 'ws'));
    const reply = await new Promise<string>((resolve, reject) => {
      ws.onerror = reject;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'ping', c: 1 }));
      ws.onmessage = (e) => resolve(String(e.data));
    });
    ws.close();
    expect(JSON.parse(reply)).toMatchObject({ t: 'pong', c: 1 });
  });
});
