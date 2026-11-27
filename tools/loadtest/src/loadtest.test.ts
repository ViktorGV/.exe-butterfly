import { describe, expect, test } from 'bun:test';
import { assembleCourse, fixtureCourse, resolveBuiltin } from '@wobble/shared';
import { PLAYER } from '@wobble/shared/constants';
import { createGameServer } from '../../../apps/server/src/index.ts';
import { parseArgs } from './index.ts';
import { checkThresholds, createCounters, createHistogram, summarize } from './metrics.ts';
import { createPathFollower } from './path.ts';
import type { PathState } from './path.ts';
import { runSwarm } from './swarm.ts';

const builtin = resolveBuiltin('b:fixture-course');
const course = builtin?.kind === 'course' ? assembleCourse(builtin.data) : fixtureCourse;

describe('path follower', () => {
  test('visits every checkpoint in order and ends on the finish', () => {
    const f = createPathFollower(course, 7, { speed: PLAYER.runSpeed * 0.8, lateral: 0 });
    const out: PathState = { pos: [0, 0, 0], yaw: 0, finished: false };
    const seen: number[] = [];
    for (let t = 0; t <= f.length / (PLAYER.runSpeed * 0.8) + 1; t += 0.05) {
      const cp = f.checkpointAt(t);
      if (seen[seen.length - 1] !== cp) seen.push(cp);
    }
    expect(seen.filter((c) => c >= 0)).toEqual(course.checkpoints.map((_, i) => i));
    f.at(1e6, out);
    expect(out.finished).toBe(true);
    expect(out.pos).toEqual(course.finish.pos);
  });

  test('starts on its spawn cell', () => {
    const f = createPathFollower(course, 0, { speed: 5 });
    const out: PathState = { pos: [0, 0, 0], yaw: 0, finished: false };
    f.at(0, out);
    expect(out.finished).toBe(false);
    expect(out.pos[1]).toBe(course.spawn.pos[1]);
  });
});

describe('metrics', () => {
  test('histogram quantiles', () => {
    const h = createHistogram();
    for (let i = 1; i <= 100; i++) h.add(i);
    expect(h.quantile(0.5)).toBe(50);
    expect(h.quantile(0.95)).toBe(95);
    expect(h.quantile(0.99)).toBe(99);
    expect(createHistogram().quantile(0.5)).toBe(0);
  });

  test('summary and thresholds', () => {
    const c = createCounters();
    c.connected = 9;
    c.snapshots = 900;
    c.snapshotBytes = 10 * 1024 * 90;
    c.corrections = 2;
    const gaps = createHistogram();
    gaps.add(66);
    const s = summarize(c, gaps, 10, 10);
    expect(s.connectSuccessRate).toBeCloseTo(0.9);
    expect(s.snapshotsPerSecPerBot).toBeCloseTo(9);
    expect(checkThresholds(s, { minConnectSuccessRate: 0.99, maxCorrections: 0 })).toHaveLength(2);
    expect(checkThresholds(s, { maxGapP95Ms: 100 })).toEqual([]);
    expect(checkThresholds(s, {})).toEqual([]);
  });
});

describe('cli', () => {
  test('parses options and rejects unknown ones', () => {
    expect(parseArgs(['--bots', '120', '--rooms', '3']).rooms).toBe(3);
    expect(() => parseArgs(['--nope', '1'])).toThrow();
    expect(() => parseArgs(['--scenario', 'vote-storm'])).toThrow();
  });
});

describe('swarm against the real server', () => {
  test('20 bots race, and a failing threshold is reported', async () => {
    const game = createGameServer({ port: 0, timings: { countdownMs: 500, loadingMaxMs: 3000 } });
    const url = `ws://localhost:${game.listen()}`;
    try {
      const { summary, violations } = await runSwarm({
        url,
        bots: 20,
        rooms: 2,
        durationSec: 60,
        rampPerSec: 200,
        thresholds: { minConnectSuccessRate: 0.99, maxCorrections: 0, maxDownKBps: 0.001 },
      });
      expect(summary.connectSuccessRate).toBe(1);
      expect(summary.corrections).toBe(0);
      expect(summary.finishedRate).toBeGreaterThan(0.9);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('downKBps');
    } finally {
      await game.close();
    }
  }, 90_000);
});
