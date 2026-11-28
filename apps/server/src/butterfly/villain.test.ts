import { describe, expect, it } from 'bun:test';
import { BUTTERFLY } from '@wobble/shared/constants';
import { throwIntervalMs } from '@wobble/shared/butterfly/index';
import type { ServerMessage, Vec3 } from '@wobble/shared/types';
import {
  createVillain,
  ROUND_SPEEDUP,
  SCATTER_MAX_M,
  SCATTER_MIN_M,
  STAGGER_MS,
  volleySize,
  VOLLEY_MAX,
  VOLLEY_MIN,
} from './villain.ts';

function setup(opts: { marked?: number[]; storm?: number; players?: number[]; random?: () => number } = {}) {
  const marked = new Set(opts.marked ?? []);
  const ids = opts.players ?? [1, 2, 3];
  const pos = new Map<number, Vec3>(ids.map((id) => [id, [id * 10, 0, -50]]));
  const done = new Set<number>();
  const published: ServerMessage[] = [];
  const sent: { id: number; msg: ServerMessage }[] = [];
  let storm = opts.storm ?? 0;
  const villain = createVillain({
    playerIds: () => ids,
    getPosition: (id, out) => {
      const v = pos.get(id);
      if (!v) return false;
      out[0] = v[0];
      out[1] = v[1];
      out[2] = v[2];
      return true;
    },
    isMarked: (id) => marked.has(id),
    storm: () => storm,
    isTargetable: (id) => !done.has(id),
    send: (id, msg) => sent.push({ id, msg }),
    publish: (msg) => published.push(msg),
    random: opts.random ?? (() => 0.5),
  });
  return {
    villain,
    marked,
    pos,
    done,
    published,
    sent,
    setStorm: (s: number) => (storm = s),
  };
}

const throws = (m: ServerMessage[]) => m.filter((x): x is Extract<ServerMessage, { t: 'throw' }> => x.t === 'throw');

describe('villain', () => {
  it('does nothing until it is activated', () => {
    const s = setup({ marked: [1] });
    for (let t = 0; t < 20_000; t += 50) s.villain.tick(t);
    expect(s.published).toEqual([]);
  });

  it('throws only at marked players, never at anyone else', () => {
    const s = setup({ marked: [2] });
    s.villain.activate(0);
    for (let t = 0; t <= 30_000; t += 50) s.villain.tick(t);
    const list = throws(s.published);
    expect(list.length).toBeGreaterThan(0);
    for (const m of list) expect(m.target).toBe(2);
    // and only the marked player is ever told they were hit
    expect(s.sent.every((x) => x.id === 2)).toBe(true);
  });

  it('shows the circle where the target stands and lands THROW_WARN_MS later', () => {
    const s = setup({ marked: [2] });
    s.villain.activate(1000);
    s.villain.tick(1000 + BUTTERFLY.THROW_WARN_MS);
    const [m] = throws(s.published);
    expect(m!.pos).toEqual([20, -50]);
    expect(m!.landAt).toBe(1000 + 2 * BUTTERFLY.THROW_WARN_MS);
  });

  it('hits a marked player who stays in the circle, knocking them away from the impact', () => {
    const s = setup({ marked: [2] });
    s.villain.activate(0);
    s.villain.tick(BUTTERFLY.THROW_WARN_MS);
    const [m] = throws(s.published);
    s.pos.set(2, [20 + 1, 0, -50]); // 1 m to the right of the impact, inside the circle
    s.villain.tick(m!.landAt);
    expect(s.sent).toHaveLength(1);
    const hit = s.sent[0]!;
    expect(hit.id).toBe(2);
    expect(hit.msg.t).toBe('hit');
    if (hit.msg.t === 'hit') {
      expect(hit.msg.n).toBe(m!.n);
      expect(hit.msg.dir[0]).toBeCloseTo(1, 6);
      expect(hit.msg.dir[1]).toBeCloseTo(0, 6);
    }
  });

  it('misses a player who walked out of the circle', () => {
    const s = setup({ marked: [2] });
    s.villain.activate(0);
    s.villain.tick(BUTTERFLY.THROW_WARN_MS);
    const [m] = throws(s.published);
    s.pos.set(2, [20 + BUTTERFLY.THROW_RADIUS_M + 0.5, 0, -50]);
    s.villain.tick(m!.landAt);
    expect(s.sent).toEqual([]);
  });

  it('knocks straight ahead (-Z) when the player is exactly at the impact point', () => {
    const s = setup({ marked: [2] });
    s.villain.activate(0);
    s.villain.tick(BUTTERFLY.THROW_WARN_MS);
    s.villain.tick(throws(s.published)[0]!.landAt);
    const msg = s.sent[0]!.msg;
    expect(msg.t === 'hit' && msg.dir).toEqual([0, -1]);
  });

  it('a player who is not marked is never hit, even standing under a throw at someone else', () => {
    const s = setup({ marked: [2] });
    s.villain.activate(0);
    s.villain.tick(BUTTERFLY.THROW_WARN_MS);
    const [m] = throws(s.published);
    s.pos.set(1, [m!.pos[0], 0, m!.pos[1]]); // player 1 (not marked) stands on the circle
    s.villain.tick(m!.landAt);
    expect(s.sent.find((x) => x.id === 1)).toBeUndefined();
  });

  it('stops targeting a player who finished, even for a throw already in the air', () => {
    const s = setup({ marked: [2] });
    s.villain.activate(0);
    s.villain.tick(BUTTERFLY.THROW_WARN_MS);
    const [m] = throws(s.published);
    s.done.add(2);
    s.villain.tick(m!.landAt);
    expect(s.sent).toEqual([]);
    const before = throws(s.published).length;
    for (let t = m!.landAt; t < m!.landAt + 20_000; t += 50) s.villain.tick(t);
    expect(throws(s.published).length).toBe(before);
  });

  it('a player marked later starts being thrown at', () => {
    const s = setup({ marked: [] });
    s.villain.activate(0);
    for (let t = 0; t < 8000; t += 50) s.villain.tick(t);
    expect(s.published).toEqual([]);
    s.marked.add(3);
    for (let t = 8000; t < 16_000; t += 50) s.villain.tick(t);
    expect(throws(s.published).every((m) => m.target === 3)).toBe(true);
    expect(throws(s.published).length).toBeGreaterThan(0);
  });

  it('throws faster as the storm rises', () => {
    const count = (storm: number) => {
      const s = setup({ marked: [2], storm });
      s.villain.activate(0);
      for (let t = 0; t <= 60_000; t += 50) s.villain.tick(t);
      return throws(s.published).length;
    };
    expect(throwIntervalMs(BUTTERFLY.STORM_MAX)).toBeLessThan(throwIntervalMs(0));
    expect(count(BUTTERFLY.STORM_MAX)).toBeGreaterThan(count(0) * 2);
  });

  it('numbers throws in order, a volley per marked player per round', () => {
    const s = setup({ marked: [1, 3] });
    s.villain.activate(0);
    s.villain.tick(BUTTERFLY.THROW_WARN_MS);
    const list = throws(s.published);
    expect(list.map((m) => m.n)).toEqual([0, 1, 2, 3]);
    expect(list.map((m) => m.target)).toEqual([1, 1, 3, 3]);
  });
});

describe('volleys', () => {
  it('grow with the storm, between VOLLEY_MIN and VOLLEY_MAX', () => {
    expect(volleySize(0)).toBe(VOLLEY_MIN);
    expect(volleySize(6)).toBe(VOLLEY_MIN);
    expect(volleySize(7)).toBe(VOLLEY_MIN + 1);
    expect(volleySize(14)).toBe(VOLLEY_MAX);
    expect(volleySize(BUTTERFLY.STORM_MAX)).toBe(VOLLEY_MAX);
    expect(volleySize(999)).toBe(VOLLEY_MAX);
    expect(volleySize(-5)).toBe(VOLLEY_MIN);
    expect(VOLLEY_MIN).toBeGreaterThanOrEqual(2); // never a single ball
  });

  it('throws more than one ball at a marked player each round', () => {
    for (const storm of [0, 10, 20]) {
      const s = setup({ marked: [2], storm });
      s.villain.activate(0);
      s.villain.tick(BUTTERFLY.THROW_WARN_MS);
      expect(throws(s.published)).toHaveLength(volleySize(storm));
      expect(throws(s.published).every((m) => m.target === 2)).toBe(true);
    }
  });

  it('puts the first ball where the player stands and the others around them, a safe gap apart', () => {
    let k = 0;
    const s = setup({ marked: [2], storm: 20, random: () => [0.0, 0.0, 0.25, 0.5, 0.5, 0.75][k++ % 6]! });
    s.villain.activate(0);
    s.villain.tick(BUTTERFLY.THROW_WARN_MS);
    const [first, ...rest] = throws(s.published);
    expect(first!.pos).toEqual([20, -50]);
    expect(rest).toHaveLength(VOLLEY_MAX - 1);
    for (const m of rest) {
      const d = Math.hypot(m.pos[0] - 20, m.pos[1] + 50);
      expect(d).toBeGreaterThanOrEqual(SCATTER_MIN_M - 1e-9);
      expect(d).toBeLessThanOrEqual(SCATTER_MAX_M + 1e-9);
      expect(d).toBeGreaterThan(BUTTERFLY.THROW_RADIUS_M); // a scattered ball alone never covers the player
    }
  });

  it('lands the balls of a volley a beat apart, the first THROW_WARN_MS after the throw', () => {
    const s = setup({ marked: [2], storm: 20 });
    s.villain.activate(0);
    const t0 = BUTTERFLY.THROW_WARN_MS;
    s.villain.tick(t0);
    const lands = throws(s.published).map((m) => m.landAt);
    expect(lands[0]).toBe(t0 + BUTTERFLY.THROW_WARN_MS);
    for (let i = 1; i < lands.length; i++) expect(lands[i]! - lands[i - 1]!).toBe(STAGGER_MS);
  });

  it('aims one ball ahead of a runner, where they will be when it lands', () => {
    const s = setup({ marked: [2] });
    s.villain.activate(0);
    // the player runs toward -Z at 6 m/s for a second before the first round (t = 1000 ms)
    for (let t = 0; t <= 1000; t += 50) {
      s.pos.set(2, [20, 0, -50 - 6 * (t / 1000)]);
      s.villain.tick(t);
    }
    const [first, led] = throws(s.published);
    const now = s.pos.get(2)!;
    expect(first!.pos[1]).toBeCloseTo(now[2], 6); // one where they are
    // the second is ahead (further along -Z) by roughly speed x warning x lead
    expect(led!.pos[1]).toBeLessThan(first!.pos[1] - 3);
    expect(led!.pos[1]).toBeGreaterThan(first!.pos[1] - 8);
    expect(Math.abs(led!.pos[0] - first!.pos[0])).toBeLessThan(1);
  });

  it('does not lead a player who is standing still', () => {
    const s = setup({ marked: [2] });
    s.villain.activate(0);
    for (let t = 0; t <= 1000; t += 50) s.villain.tick(t);
    const [first, second] = throws(s.published);
    // the second ball is scattered (random stub 0.5 -> r mid-range at angle pi), not ahead along the path
    const d = Math.hypot(second!.pos[0] - first!.pos[0], second!.pos[1] - first!.pos[1]);
    expect(d).toBeGreaterThanOrEqual(SCATTER_MIN_M - 1e-9);
  });

  it('comes round faster than before: the next volley after 6 s x ROUND_SPEEDUP when calm', () => {
    const s = setup({ marked: [2] });
    s.villain.activate(0);
    s.villain.tick(1000);
    const first = throws(s.published).length;
    s.villain.tick(1000 + 6000 * ROUND_SPEEDUP - 50);
    expect(throws(s.published).length).toBe(first); // not yet
    s.villain.tick(1000 + 6000 * ROUND_SPEEDUP);
    expect(throws(s.published).length).toBe(first * 2);
    expect(ROUND_SPEEDUP).toBeLessThan(1);
  });

  it('does not hit a player again while they are still down or getting up', () => {
    // random 0 puts every scattered ball 2.6 m along +X from the first ball (at x = 20)
    const s = setup({ marked: [2], random: () => 0 });
    s.villain.activate(0);
    s.villain.tick(BUTTERFLY.THROW_WARN_MS);
    const list = throws(s.published);
    expect(list).toHaveLength(2);
    // the player stands between the two circles, inside both
    s.pos.set(2, [21.3, 0, -50]);
    s.villain.tick(list[0]!.landAt);
    expect(s.sent).toHaveLength(1); // hit by the first
    s.villain.tick(list[1]!.landAt);
    expect(s.sent).toHaveLength(1); // the second lands while they are down: no second hit
  });

  it('can be hit again once they are back on their feet, but never twice within the knock-down', () => {
    const s = setup({ marked: [2], random: () => 0 });
    s.villain.activate(0);
    const hitTimes: number[] = [];
    let seen = 0;
    for (let t = 0; t <= 12_000; t += 50) {
      s.villain.tick(t); // the player stands still at (20, -50), so every round's first ball is on them
      while (seen < s.sent.length) {
        hitTimes.push(t);
        seen++;
      }
    }
    expect(hitTimes.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < hitTimes.length; i++) {
      expect(hitTimes[i]! - hitTimes[i - 1]!).toBeGreaterThanOrEqual(BUTTERFLY.KNOCKED_MS + BUTTERFLY.GETUP_MS);
    }
  });
});
