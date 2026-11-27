// GET /healthz and GET /rooms/summary (counts only, no codes or names).
import { PROTOCOL_VERSION } from '@wobble/shared/constants';
import type { ServerMetrics } from '../metrics/index.ts';
import type { RoomSummary } from '../room/registry.ts';

export function createStatusHandler({
  startedAt,
  summary,
  draining,
  metrics,
}: {
  startedAt: number;
  summary(): RoomSummary;
  draining(): boolean;
  metrics?: ServerMetrics;
}): (pathname: string) => Response | null {
  return (pathname) => {
    if (pathname === '/healthz') {
      const rooms = summary();
      return Response.json({
        ok: true,
        protocol: PROTOCOL_VERSION,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        draining: draining(),
        rooms: rooms.rooms,
        players: rooms.players,
        ...metrics?.snapshot(),
      });
    }
    if (pathname === '/rooms/summary') {
      return Response.json(summary(), { headers: { 'Cache-Control': 'no-store' } });
    }
    return null;
  };
}
