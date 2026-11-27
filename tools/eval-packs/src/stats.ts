// Pure summary helpers for the eval report. Owned by #22.

export interface EvalSample {
  model: string;
  themeId: string;
  prompt: string;
  ok: boolean;
  outcome: 'valid' | 'unsanitisable' | 'refused' | 'invalid' | 'error';
  latencyMs: number;
  costUsd: number;
}

export interface ModelSummary {
  model: string;
  samples: number;
  validRate: number;
  refused: number;
  failed: number;
  p50Ms: number;
  p95Ms: number;
  costPerSkinUsd: number;
  totalCostUsd: number;
}

/** Nearest-rank percentile of `values` (p in 0..100). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarize(samples: EvalSample[]): ModelSummary[] {
  const byModel = new Map<string, EvalSample[]>();
  for (const s of samples) byModel.set(s.model, [...(byModel.get(s.model) ?? []), s]);
  return [...byModel].map(([model, list]) => {
    const valid = list.filter((s) => s.ok).length;
    const totalCostUsd = list.reduce((n, s) => n + s.costUsd, 0);
    const latencies = list.map((s) => s.latencyMs);
    return {
      model,
      samples: list.length,
      validRate: list.length ? valid / list.length : 0,
      refused: list.filter((s) => s.outcome === 'refused').length,
      failed: list.filter((s) => !s.ok && s.outcome !== 'refused').length,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      costPerSkinUsd: valid ? totalCostUsd / valid : 0,
      totalCostUsd,
    };
  });
}

/** Markdown table for the PR description. */
export function toMarkdown(rows: ModelSummary[]): string {
  const lines = [
    '| model | skins | valid after sanitise | refused | failed | p50 | p95 | cost / skin | total |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.model} | ${r.samples} | ${(r.validRate * 100).toFixed(1)}% | ${r.refused} | ${r.failed} | ` +
        `${(r.p50Ms / 1000).toFixed(2)} s | ${(r.p95Ms / 1000).toFixed(2)} s | ` +
        `$${r.costPerSkinUsd.toFixed(5)} | $${r.totalCostUsd.toFixed(4)} |`,
    );
  }
  return lines.join('\n');
}
