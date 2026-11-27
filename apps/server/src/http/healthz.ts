// GET /healthz body (#73). Keeps ok, protocol and uptimeSec and adds the process metrics.
import { PROTOCOL_VERSION } from '@wobble/shared/constants';
import type { Metrics, MetricsSnapshot } from '../metrics/index.ts';

export interface HealthzBody extends MetricsSnapshot {
  ok: true;
  protocol: number;
  uptimeSec: number;
}

export function buildHealthz(startedAt: number, metrics: Metrics, now = Date.now()): HealthzBody {
  return {
    ok: true,
    protocol: PROTOCOL_VERSION,
    uptimeSec: Math.round((now - startedAt) / 1000),
    ...metrics.snapshot(),
  };
}
