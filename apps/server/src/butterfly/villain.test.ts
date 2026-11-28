import { describe, expect, it } from 'bun:test';
import { BUTTERFLY } from '@wobble/shared/constants';
import { throwIntervalMs } from '@wobble/shared/butterfly/index';
import type { ServerMessage, Vec3 } from '@wobble/shared/types';
import { createVillain } from './villain.ts';

function setup(opts: { marked?: number[]; storm?: number; players?: number[] } = {}) {
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

  it('numbers throws in order and keeps one throw per marked player per round', () => {
    const s = setup({ marked: [1, 3] });
    s.villain.activate(0);
    s.villain.tick(BUTTERFLY.THROW_WARN_MS);
    const list = throws(s.published);
    expect(list.map((m) => m.n)).toEqual([0, 1]);
    expect(list.map((m) => m.target)).toEqual([1, 3]);
  });
});
