// GET /healthz and GET /rooms/summary (counts only, no codes or names).
import { PROTOCOL_VERSION } from '@wobble/shared/constants';
import type { RoomSummary } from '../room/registry.ts';

export function createStatusHandler({
  startedAt,
  summary,
  draining,
}: {
  startedAt: number;
  summary(): RoomSummary;
  draining(): boolean;
}): (pathname: string) => Response | null {
  return (pathname) => {
    if (pathname === '/healthz') {
      return Response.json({
        ok: true,
        protocol: PROTOCOL_VERSION,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        draining: draining(),
      });
    }
    if (pathname === '/rooms/summary') {
      return Response.json(summary(), { headers: { 'Cache-Control': 'no-store' } });
    }
    return null;
  };
}
