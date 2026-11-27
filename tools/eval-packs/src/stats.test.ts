import { expect, test } from 'bun:test';
import { EVAL_PROMPTS } from './prompts.ts';
import { percentile, summarize, toMarkdown } from './stats.ts';
import type { EvalSample } from './stats.ts';

test('30 distinct prompts', () => {
  expect(EVAL_PROMPTS).toHaveLength(30);
  expect(new Set(EVAL_PROMPTS).size).toBe(30);
});

test('percentile uses nearest rank', () => {
  const v = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
  expect(percentile(v, 50)).toBe(5);
  expect(percentile(v, 95)).toBe(10);
  expect(percentile([], 50)).toBe(0);
});

test('summarize per model', () => {
  const s = (model: string, ok: boolean, latencyMs: number, costUsd: number): EvalSample => ({
    model,
    themeId: 'b:t',
    prompt: 'p',
    ok,
    outcome: ok ? 'valid' : 'refused',
    latencyMs,
    costUsd,
  });
  const [a, b] = summarize([s('a', true, 100, 0.001), s('a', false, 300, 0.001), s('b', true, 50, 0.002)]);
  expect(a).toMatchObject({ model: 'a', samples: 2, validRate: 0.5, refused: 1, failed: 0, p50Ms: 100, p95Ms: 300 });
  expect(a.costPerSkinUsd).toBeCloseTo(0.002);
  expect(b.validRate).toBe(1);
  expect(toMarkdown([a, b])).toContain('| a | 2 | 50.0% |');
});
