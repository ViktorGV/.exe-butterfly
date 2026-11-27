import { afterEach, describe, expect, it } from 'bun:test';
import { connect, type Socket } from 'node:net';
import type { Server, ServerWebSocket } from 'bun';
import { sendSnapshot, websocketOptions } from './options.ts';

const servers: Server<unknown>[] = [];
const sockets: Socket[] = [];
afterEach(() => {
  for (const s of sockets.splice(0)) s.destroy();
  for (const s of servers.splice(0)) void s.stop(true);
});

describe('websocketOptions', () => {
  it('has the documented defaults', () => {
    expect(websocketOptions()).toEqual({
      backpressureLimit: 256 * 1024,
      closeOnBackpressureLimit: true,
      idleTimeout: 30,
      sendPings: true,
      perMessageDeflate: false,
    });
    expect(websocketOptions({ idleTimeout: 2 }).idleTimeout).toBe(2);
  });
});

describe('sendSnapshot', () => {
  const frame = new Uint8Array(100);
  const fake = (buffered: number) => ({ getBufferedAmount: () => buffered, sendBinary: () => 100 });

  it('sends when the client is keeping up', () => {
    let sent = 0;
    expect(sendSnapshot(fake(0), frame, { onSent: (b) => (sent += b) })).toBe(true);
    expect(sent).toBe(100);
  });

  it('drops and counts when the backlog is above the soft limit', () => {
    let dropped = 0;
    expect(sendSnapshot(fake(65 * 1024), frame, { onDrop: () => dropped++ })).toBe(false);
    expect(dropped).toBe(1);
    expect(sendSnapshot(fake(10), frame, { softLimit: 5, onDrop: () => dropped++ })).toBe(false);
    expect(dropped).toBe(2);
  });
});

/** Minimal WebSocket client over a raw TCP socket, so the test controls when it reads. */
function rawClient(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(port, '127.0.0.1');
    sockets.push(s);
    s.once('error', reject);
    s.once('connect', () => {
      s.write(
        `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    s.once('data', () => resolve(s)); // the 101 response
  });
}

describe('real server', () => {
  it('drops snapshots for a client that stops reading, then closes it at the hard limit', async () => {
    let sent = 0;
    let dropped = 0;
    let closed = false;
    let ws!: ServerWebSocket<unknown>;
    const server = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('no', { status: 400 })),
      websocket: {
        ...websocketOptions({ backpressureLimit: 128 * 1024 }),
        open(w) {
          ws = w;
        },
        message() {},
        close() {
          closed = true;
        },
      },
    });
    servers.push(server);
    const client = await rawClient(server.port ?? 0);
    client.pause();

    // Big frames fill the kernel's loopback buffers fast; after that the backlog stays above the
    // soft limit and every further snapshot is dropped instead of queued.
    const frame = new Uint8Array(128 * 1024);
    const deadline = Date.now() + 10_000;
    for (let i = 0; dropped < 20 && Date.now() < deadline; i++) {
      sendSnapshot(ws, frame, { softLimit: 64 * 1024, onSent: () => sent++, onDrop: () => dropped++ });
      if (i % 8 === 7) await Bun.sleep(1);
    }
    expect(sent).toBeGreaterThan(0);
    expect(dropped).toBeGreaterThanOrEqual(20);
    expect(closed).toBe(false); // dropping keeps the queue under the hard limit
    // A big frame that bypasses sendSnapshot (e.g. a control message) crosses the hard limit: Bun closes the socket.
    for (let i = 0; i < 50 && !closed; i++) {
      ws.sendBinary(new Uint8Array(256 * 1024));
      await Bun.sleep(2);
    }
    expect(closed).toBe(true);
  }, 20_000);

  it('removes a client that vanishes without closing after the idle timeout', async () => {
    let closed = false;
    const server = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('no', { status: 400 })),
      websocket: {
        ...websocketOptions({ idleTimeout: 1 }),
        message() {},
        close() {
          closed = true;
        },
      },
    });
    servers.push(server);
    const client = await rawClient(server.port ?? 0);
    client.pause(); // never answers pings, never closes
    // Bun's idle timer is coarse: idleTimeout 1 closes a silent client after about 8 s.
    const deadline = Date.now() + 15_000;
    while (!closed && Date.now() < deadline) await Bun.sleep(100);
    expect(closed).toBe(true);
  }, 20_000);

  it('delivers every snapshot to a client that keeps up', async () => {
    let dropped = 0;
    let ws!: ServerWebSocket<unknown>;
    const server = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('no', { status: 400 })),
      websocket: {
        ...websocketOptions(),
        open(w) {
          ws = w;
        },
        message() {},
      },
    });
    servers.push(server);
    const got: number[] = [];
    const client = new WebSocket(`ws://127.0.0.1:${server.port}`);
    client.binaryType = 'arraybuffer';
    client.onmessage = (e) => got.push((e.data as ArrayBuffer).byteLength);
    await new Promise((r) => (client.onopen = r));
    await Bun.sleep(20);
    for (let i = 0; i < 100; i++) {
      sendSnapshot(ws, new Uint8Array(200), { onDrop: () => dropped++ });
      await Bun.sleep(1);
    }
    await Bun.sleep(100);
    client.close();
    expect(dropped).toBe(0);
    expect(got.length).toBe(100);
  });
});
