import { afterEach, describe, expect, test } from 'bun:test';
import { WS_DEFAULTS, overSoftLimit, sendSnapshot, websocketOptions } from './options.ts';

const HANDSHAKE =
  'GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
  'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n';

const servers: { stop(force?: boolean): unknown }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
});

/** A client that completes the handshake and then never reads or answers pings. */
async function mute(port: number) {
  const sock = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: { open: (s) => void s.write(HANDSHAKE), data() {}, close() {}, error() {} },
  });
  sock.pause?.();
  return sock;
}

const until = async (cond: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await Bun.sleep(20);
  return cond();
};

describe('websocket options', () => {
  test('defaults', () => {
    expect(websocketOptions()).toEqual({
      backpressureLimit: 256 * 1024,
      closeOnBackpressureLimit: true,
      idleTimeout: 30,
      sendPings: true,
      perMessageDeflate: false,
    });
    expect(websocketOptions({ idleTimeout: 2 }).idleTimeout).toBe(2);
  });

  test('soft limit decides what is dropped', () => {
    expect(overSoftLimit(WS_DEFAULTS.softLimit)).toBe(false);
    expect(overSoftLimit(WS_DEFAULTS.softLimit + 1)).toBe(true);
    const sent: unknown[] = [];
    const ws = { send: (d: unknown) => sent.push(d), getBufferedAmount: () => 0 };
    expect(sendSnapshot(ws, 'a')).toBe(true);
    expect(sendSnapshot({ ...ws, getBufferedAmount: () => 1e6 }, 'b')).toBe(false);
    expect(sent).toEqual(['a']);
  });
});

describe('against a real server', () => {
  test('a normal client receives every snapshot', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('no', { status: 400 })),
      websocket: {
        ...websocketOptions(),
        open(ws) {
          for (let i = 0; i < 50; i++) sendSnapshot(ws, new Uint8Array(100));
        },
        message() {},
      },
    });
    servers.push(server);
    let got = 0;
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    ws.onmessage = () => got++;
    expect(await until(() => got === 50, 3000)).toBe(true);
    ws.close();
  });

  test('a client that stops reading loses snapshots, and is closed at the hard limit', async () => {
    let dropped = 0;
    let sent = 0;
    let closed = false;
    const frame = new Uint8Array(32 * 1024);
    const server = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('no', { status: 400 })),
      websocket: {
        ...websocketOptions({ backpressureLimit: 128 * 1024 }),
        open(ws) {
          // soft-limited snapshots first: they back off before the hard limit is reached
          for (let i = 0; i < 2000 && !closed; i++) {
            if (sendSnapshot(ws, frame, 64 * 1024)) sent++;
            else dropped++;
          }
          // then unconditional sends, as a stuck room would produce, until Bun closes the socket
          for (let i = 0; i < 2000; i++) ws.send(frame);
        },
        close() {
          closed = true;
        },
        message() {},
      },
    });
    servers.push(server);
    const sock = await mute(server.port!);
    expect(await until(() => closed, 8000)).toBe(true);
    expect(dropped).toBeGreaterThan(0);
    sock.end();
  }, 15_000);

  test('a client that vanishes without closing is removed after the idle timeout', async () => {
    let closed = false;
    const server = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('no', { status: 400 })),
      websocket: {
        ...websocketOptions({ idleTimeout: 2 }),
        close() {
          closed = true;
        },
        message() {},
      },
    });
    servers.push(server);
    const sock = await mute(server.port!);
    expect(closed).toBe(false);
    expect(await until(() => closed, 8000)).toBe(true);
    sock.end();
  }, 15_000);
});
