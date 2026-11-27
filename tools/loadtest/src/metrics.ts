// Swarm metrics: fixed-size histograms (no per-message allocation) and threshold checks.

export const HIST_MAX_MS = 2000;

export interface Histogram {
  readonly counts: Uint32Array;
  total: number;
  add(ms: number): void;
  /** value (ms) at quantile q in 0..1, or 0 when empty */
  quantile(q: number): number;
}

export function createHistogram(maxMs = HIST_MAX_MS): Histogram {
  const counts = new Uint32Array(maxMs + 1);
  const h: Histogram = {
    counts,
    total: 0,
    add(ms) {
      const i = ms <= 0 ? 0 : ms >= maxMs ? maxMs : Math.round(ms);
      counts[i]++;
      h.total++;
    },
    quantile(q) {
      if (h.total === 0) return 0;
      const target = Math.max(1, Math.ceil(q * h.total));
      let seen = 0;
      for (let i = 0; i < counts.length; i++) {
        seen += counts[i];
        if (seen >= target) return i;
      }
      return maxMs;
    },
  };
  return h;
}

/** Counters one bot (or the whole swarm) accumulates. */
export interface Counters {
  connected: number;
  failed: number;
  disconnects: number;
  joinMs: Histogram;
  snapshots: number;
  snapshotRecords: number;
  snapshotBytes: number;
  stateSent: number;
  stateBytes: number;
  controlIn: number;
  corrections: number;
  finished: number;
  finishMs: Histogram;
  errors: number;
}

export function createCounters(): Counters {
  return {
    connected: 0,
    failed: 0,
    disconnects: 0,
    joinMs: createHistogram(10_000),
    snapshots: 0,
    snapshotRecords: 0,
    snapshotBytes: 0,
    stateSent: 0,
    stateBytes: 0,
    controlIn: 0,
    corrections: 0,
    finished: 0,
    finishMs: createHistogram(HIST_MAX_MS),
    errors: 0,
  };
}

export interface Summary {
  bots: number;
  durationSec: number;
  connectSuccessRate: number;
  disconnects: number;
  joinP95Ms: number;
  /** per bot, KB/s */
  downKBps: number;
  upKBps: number;
  snapshotsPerSecPerBot: number;
  gapP50Ms: number;
  gapP95Ms: number;
  gapP99Ms: number;
  corrections: number;
  finishedRate: number;
  errors: number;
}

export function summarize(c: Counters, gaps: Histogram, bots: number, durationSec: number): Summary {
  const sec = Math.max(0.001, durationSec);
  const n = Math.max(1, bots);
  return {
    bots,
    durationSec,
    connectSuccessRate: bots === 0 ? 0 : c.connected / bots,
    disconnects: c.disconnects,
    joinP95Ms: c.joinMs.quantile(0.95),
    downKBps: c.snapshotBytes / 1024 / sec / n,
    upKBps: c.stateBytes / 1024 / sec / n,
    snapshotsPerSecPerBot: c.snapshots / sec / n,
    gapP50Ms: gaps.quantile(0.5),
    gapP95Ms: gaps.quantile(0.95),
    gapP99Ms: gaps.quantile(0.99),
    corrections: c.corrections,
    finishedRate: c.finished / n,
    errors: c.errors,
  };
}

/** Limits in thresholds.json. Every key is optional; a missing key is not checked. */
export interface Thresholds {
  minConnectSuccessRate?: number;
  maxDisconnects?: number;
  maxJoinP95Ms?: number;
  maxDownKBps?: number;
  minSnapshotsPerSecPerBot?: number;
  maxGapP95Ms?: number;
  maxGapP99Ms?: number;
  maxCorrections?: number;
  minFinishedRate?: number;
  maxErrors?: number;
}

export function checkThresholds(s: Summary, t: Thresholds): string[] {
  const out: string[] = [];
  const min = (name: string, actual: number, limit: number | undefined) => {
    if (limit !== undefined && actual < limit) out.push(`${name} ${fmt(actual)} < ${limit}`);
  };
  const max = (name: string, actual: number, limit: number | undefined) => {
    if (limit !== undefined && actual > limit) out.push(`${name} ${fmt(actual)} > ${limit}`);
  };
  min('connectSuccessRate', s.connectSuccessRate, t.minConnectSuccessRate);
  max('disconnects', s.disconnects, t.maxDisconnects);
  max('joinP95Ms', s.joinP95Ms, t.maxJoinP95Ms);
  max('downKBps', s.downKBps, t.maxDownKBps);
  min('snapshotsPerSecPerBot', s.snapshotsPerSecPerBot, t.minSnapshotsPerSecPerBot);
  max('gapP95Ms', s.gapP95Ms, t.maxGapP95Ms);
  max('gapP99Ms', s.gapP99Ms, t.maxGapP99Ms);
  max('corrections', s.corrections, t.maxCorrections);
  min('finishedRate', s.finishedRate, t.minFinishedRate);
  max('errors', s.errors, t.maxErrors);
  return out;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function markdown(s: Summary, violations: string[]): string {
  const row = (k: string, v: string | number) => `| ${k} | ${typeof v === 'number' ? fmt(v) : v} |`;
  return [
    `## Load test: ${s.bots} bots, ${fmt(s.durationSec)} s`,
    '',
    '| metric | value |',
    '| --- | --- |',
    row('connect success', `${(s.connectSuccessRate * 100).toFixed(1)}%`),
    row('disconnects', s.disconnects),
    row('join p95 (ms)', s.joinP95Ms),
    row('download per bot (KB/s)', s.downKBps),
    row('upload per bot (KB/s)', s.upKBps),
    row('snapshots per bot (/s)', s.snapshotsPerSecPerBot),
    row('snapshot gap p50 / p95 / p99 (ms)', `${s.gapP50Ms} / ${s.gapP95Ms} / ${s.gapP99Ms}`),
    row('corrections (honest bots)', s.corrections),
    row('finished', `${(s.finishedRate * 100).toFixed(1)}%`),
    row('errors', s.errors),
    '',
    violations.length ? `**FAILED**\n${violations.map((v) => `- ${v}`).join('\n')}` : '**PASSED**',
    '',
  ].join('\n');
}
