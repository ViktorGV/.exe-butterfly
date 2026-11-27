// Game server entry point. Seeded by #2 as a hello-world; #18 replaces it with rooms and lobby.
// Runs on Bun with native WebSockets (Bun.serve). Today it answers `ping` with `pong`
// (server time) and serves GET /healthz.
import type { Server } from 'bun';
import { PROTOCOL_VERSION, WIRE } from '@wobble/shared/constants';
import { ClientMessageSchema } from '@wobble/shared/schemas/protocol';
import type { ClientMessage, ServerMessage } from '@wobble/shared/types';

const json = (body: unknown, status = 200) => Response.json(body, { status });
const encode = (msg: ServerMessage) => JSON.stringify(msg);

export interface GameServer {
  readonly server: Server<undefined> | null;
  /** Starts listening and returns the bound port. */
  listen(): number;
  close(): Promise<void>;
}

export function createGameServer({
  port = Number(process.env.PORT ?? 8787),
  hostname = '0.0.0.0',
}: { port?: number; hostname?: string } = {}): GameServer {
  const startedAt = Date.now();
  let server: Server<undefined> | null = null;

  return {
    get server() {
      return server;
    },
    listen() {
      server = Bun.serve<undefined>({
        port,
        hostname,
        fetch(req, srv) {
          const { pathname } = new URL(req.url);
          if (pathname === '/healthz') {
            return json({
              ok: true,
              protocol: PROTOCOL_VERSION,
              uptimeSec: Math.round((Date.now() - startedAt) / 1000),
            });
          }
          if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            if (srv.upgrade(req, { data: undefined })) return undefined;
            return json({ error: 'upgrade_failed' }, 400);
          }
          return json({ error: 'not_found' }, 404);
        },
        websocket: {
          maxPayloadLength: WIRE.CONTROL_MAX_BYTES,
          perMessageDeflate: false,
          message(ws, data) {
            if (typeof data !== 'string') return; // binary STATE frames are handled by the race session (#19)
            let msg: ClientMessage;
            try {
              msg = ClientMessageSchema.parse(JSON.parse(data));
            } catch {
              ws.send(encode({ t: 'error', code: 'bad_message', msg: 'unrecognised control message' }));
              return;
            }
            if (msg.t === 'ping') ws.send(encode({ t: 'pong', c: msg.c, s: Date.now() }));
            else ws.send(encode({ t: 'error', code: 'not_implemented', msg: `${msg.t} arrives with #18` }));
          },
        },
      });
      return server.port ?? port;
    },
    async close() {
      await server?.stop(true);
      server = null;
    },
  };
}

if (import.meta.main) {
  const game = createGameServer();
  const port = game.listen();
  console.log(`[server] listening on ws://localhost:${port} (healthz: http://localhost:${port}/healthz)`);
  const shutdown = () => game.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
