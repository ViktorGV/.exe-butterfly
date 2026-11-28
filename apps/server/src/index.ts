// Game server entry point (#18): HTTP (healthz, room summary, /api, static client) and
// Bun native WebSockets with rooms, lobby and the match lifecycle.
import type { Server } from 'bun';
import { MAX_PLAYERS_PER_ROOM } from '@wobble/shared/constants';
import { fileURLToPath } from 'node:url';
import { createApiHandler, parseAllowedOrigins } from './http/api.ts';
import { createStaticHandler } from './http/static.ts';
import { websocketOptions } from './transport/options.ts';
import type { WebSocketLimits } from './transport/options.ts';
import { createMetrics } from './metrics/index.ts';
import { createStatusHandler } from './http/status.ts';
import { createCourseResolver } from './room/courses.ts';
import type { ResolveCourse } from './room/courses.ts';
import { createRoomRegistry } from './room/registry.ts';
import type { RoomRegistry } from './room/registry.ts';
import { DEFAULT_TIMINGS } from './room/room.ts';
import type { RoomTimings } from './room/room.ts';
import { createIpCounter, originAllowed } from './transport/guards.ts';
import { createSocketHandler } from './transport/socket.ts';
import type { WsData } from './transport/socket.ts';

const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));
const DEFAULT_API_DIR = fileURLToPath(new URL('../../web/api', import.meta.url));

/** Default room size: the 150-player maximum; hosts can configure fewer. */
export const DEFAULT_MAX_PLAYERS = MAX_PLAYERS_PER_ROOM;
export const DRAIN_MS = 60_000;

const json = (body: unknown, status = 200) => Response.json(body, { status });
const envInt = (v: string | undefined, def: number) => (v && Number.isFinite(Number(v)) ? Number(v) : def);

export interface GameServer {
  readonly server: Server<WsData> | null;
  readonly rooms: RoomRegistry;
  /** Starts listening and returns the bound port. */
  listen(): number;
  /** Stops creating rooms, tells players, waits for rooms to empty (at most `ms`), then closes. */
  drain(ms?: number): Promise<void>;
  close(): Promise<void>;
}

export interface GameServerOptions {
  port?: number;
  hostname?: string;
  webDist?: string;
  apiDir?: string;
  apiTimeoutMs?: number;
  allowedOrigins?: string[];
  maxPlayers?: number;
  maxConnectionsPerIp?: number;
  handshakeMs?: number;
  timings?: Partial<RoomTimings>;
  /** Override the hard backpressure limit or idle timeout (tests). */
  wsLimits?: WebSocketLimits;
  resolveCourse?: ResolveCourse;
}

export function createGameServer({
  port = Number(process.env.PORT ?? 8787),
  hostname = '0.0.0.0',
  webDist = process.env.WEB_DIST ?? DEFAULT_WEB_DIST,
  apiDir = DEFAULT_API_DIR,
  apiTimeoutMs,
  allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  maxPlayers = envInt(process.env.MAX_PLAYERS, DEFAULT_MAX_PLAYERS),
  maxConnectionsPerIp = envInt(process.env.MAX_CONNECTIONS_PER_IP, 400),
  handshakeMs,
  timings,
  resolveCourse = createCourseResolver(),
  wsLimits,
}: GameServerOptions = {}): GameServer {
  const api = createApiHandler({ apiDir, timeoutMs: apiTimeoutMs, allowedOrigins });
  const files = createStaticHandler({ root: webDist });
  const ips = createIpCounter(maxConnectionsPerIp);
  let server: Server<WsData> | null = null;

  const metrics = createMetrics();
  const rooms = createRoomRegistry({
    maxPlayers: Math.max(1, Math.min(MAX_PLAYERS_PER_ROOM, maxPlayers)),
    timings: { ...DEFAULT_TIMINGS, ...timings },
    resolveCourse,
    publish: (topic, data) => {
      // one encode, many receivers: count every subscriber's copy
      if (server?.publish(topic, data)) metrics.sent(data.length * server.subscriberCount(topic));
    },
    metrics,
  });
  const status = createStatusHandler({
    startedAt: Date.now(),
    summary: () => rooms.summary(),
    draining: () => rooms.draining,
    metrics,
  });
  const socketHandler = createSocketHandler({ registry: rooms, ips, handshakeMs });
  const websocket: typeof socketHandler = {
    ...socketHandler,
    message(ws, data) {
      metrics.received();
      socketHandler.message?.(ws, data);
    },
  };

  async function close() {
    rooms.dispose();
    await server?.stop(true);
    server = null;
  }

  return {
    get server() {
      return server;
    },
    rooms,
    listen() {
      server = Bun.serve<WsData>({
        port,
        hostname,
        fetch(req, srv) {
          const { pathname } = new URL(req.url);
          const res = status(pathname);
          if (res) return res;
          if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            if (!originAllowed(req.headers.get('origin'), req.headers.get('host'), allowedOrigins)) {
              return json({ error: 'forbidden_origin' }, 403);
            }
            if (rooms.draining) return json({ error: 'draining' }, 503);
            const ip = srv.requestIP(req)?.address ?? 'unknown';
            if (!ips.acquire(ip)) return json({ error: 'too_many_connections' }, 429);
            const data: WsData = { ip, room: null, member: null, peer: null, helloTimer: null };
            if (srv.upgrade(req, { data })) return undefined;
            ips.release(ip);
            return json({ error: 'upgrade_failed' }, 400);
          }
          if (pathname === '/api' || pathname.startsWith('/api/')) return api(req);
          return files(req);
        },
        websocket: { ...websocket, ...websocketOptions(wsLimits) },
      });
      return server.port ?? port;
    },
    async drain(ms = DRAIN_MS) {
      rooms.startDraining();
      for (const r of rooms.rooms()) r.broadcast({ t: 'error', code: 'shutdown', msg: 'server is restarting' });
      const until = Date.now() + ms;
      while (rooms.size > 0 && Date.now() < until) await Bun.sleep(250);
      await close();
    },
    close,
  };
}

if (import.meta.main) {
  const game = createGameServer();
  const port = game.listen();
  console.log(
    `[server] listening on ws://localhost:${port} (web: http://localhost:${port}/, healthz: http://localhost:${port}/healthz)`,
  );
  process.on('SIGINT', () => game.close().then(() => process.exit(0)));
  process.on('SIGTERM', () => game.drain().then(() => process.exit(0)));
}
