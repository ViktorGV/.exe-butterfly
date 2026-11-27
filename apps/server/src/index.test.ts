import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { ServerMessage } from '@wobble/shared/types';
import { createGameServer } from './index.ts';

describe('game server hello-world', () => {
  const game = createGameServer({ port: 0, hostname: '127.0.0.1' });
  let port = 0;
  beforeAll(() => {
    port = game.listen();
  });
  afterAll(() => game.close());

  it('serves /healthz', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, protocol: 1 });
  });

  it('answers ping with pong and rejects garbage', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: ServerMessage[] = [];
    await new Promise((resolve, reject) => {
      ws.onerror = reject;
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'ping', c: 42 }));
        ws.send('not json');
      };
      ws.onmessage = (event) => {
        messages.push(JSON.parse(String(event.data)));
        if (messages.length === 2) resolve(undefined);
      };
    });
    ws.close();
    expect(messages[0]).toMatchObject({ t: 'pong', c: 42 });
    const pong = messages[0] as Extract<ServerMessage, { t: 'pong' }>;
    expect(typeof pong.s).toBe('number');
    expect(messages[1]).toMatchObject({ t: 'error', code: 'bad_message' });
  });
});
