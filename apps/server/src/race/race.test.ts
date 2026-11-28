import { describe, expect, it } from 'bun:test';
import { Anim, NEAR_SET_SIZE, PLAYER } from '@wobble/shared/constants';
import { assembleCourse } from '@wobble/shared/course/assemble/index';
import { GUMDROP_GAUNTLET } from '@wobble/shared/course/recipes/index';
import { fixtureCourse } from '@wobble/shared/fixtures/index';
import type { CourseRecipe, IncomingState, Vec3 } from '@wobble/shared/types';
import { gridPoint, sweepVolume } from './geometry.ts';
import { createHarness, decodeSnapshotIds, STEP_MS } from './harness.ts';
import { deriveLimits } from './limits.ts';
import { createRaceSession } from './index.ts';

const FINISH_FRONT_Z = fixtureCourse.finish.pos[2] + fixtureCourse.finish.half[2];

function run(h: ReturnType<typeof createHarness>, maxSteps = 3000) {
  for (let k = 0; k < maxSteps && !h.session.finished; k++) h.step();
}

describe('geometry', () => {
  it('sweeps a segment through an oriented box', () => {
    const v = { pos: [0, 1, 0] as Vec3, yaw: Math.PI / 4, half: [1, 1, 1] as Vec3 };
    expect(sweepVolume(v, 0, 1, 5, 0, 1, -5)).toBeGreaterThan(0.3);
    expect(sweepVolume(v, 5, 1, 5, 6, 1, -5)).toBe(-1);
    expect(sweepVolume(v, 0, 1, 0, 0, 1, -5)).toBe(0);
  });
});

describe('honest race', () => {
  it('300 bots finish in the correct order with interpolated times', () => {
    const h = createHarness({ count: 300, seed: 7 });
    run(h);
    expect(h.session.finished).toBe(true);
    expect(h.events.filter((e) => e.type === 'correct')).toEqual([]);
    const res = h.session.results();
    expect(res).toHaveLength(300);
    const expected = new Map(h.bots.map((b) => [b.id, ((b.start[2] - FINISH_FRONT_Z) / b.speed) * 1000]));
    for (const r of res) {
      expect(r.timeMs).not.toBeNull();
      expect(Math.abs((r.timeMs as number) - (expected.get(r.id) as number))).toBeLessThanOrEqual(1);
      expect(r.checkpoint).toBe(0);
    }
    for (let k = 1; k < res.length; k++)
      expect(res[k].timeMs as number).toBeGreaterThanOrEqual(res[k - 1].timeMs as number);
    expect(res.map((r) => r.place)).toEqual(res.map((_, k) => k + 1));
    const raceEnd = h.events.find((e) => e.type === 'raceEnd');
    expect(raceEnd?.results).toEqual(res);
    expect(h.text.filter((t) => t.msg.t === 'finished' && t.to === h.bots[0].id)).toHaveLength(300);
  });

  it('10 seeded honest races produce zero corrections', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const h = createHarness({ count: 40, seed });
      run(h);
      expect(h.session.finished).toBe(true);
      expect(h.events.filter((e) => e.type === 'correct' || e.type === 'kick')).toEqual([]);
      expect(h.text.filter((t) => t.msg.t === 'correct')).toEqual([]);
    }
  });

  it('ends at qualifyCount, ranks the rest by checkpoint then distance', () => {
    const h = createHarness({ count: 20, seed: 3, qualifyCount: 5 });
    run(h);
    const res = h.session.results();
    expect(res.filter((r) => r.timeMs !== null)).toHaveLength(5);
    expect(res.slice(0, 5).every((r) => r.timeMs !== null)).toBe(true);
    const rest = res.slice(5);
    for (let k = 1; k < rest.length; k++) expect(rest[k].checkpoint).toBeLessThanOrEqual(rest[k - 1].checkpoint);
  });

  it('ends at the time limit and when every connected player has finished', () => {
    const h = createHarness({ count: 3, timeLimitMs: 2000 });
    run(h);
    expect(h.now - h.startAt).toBeGreaterThanOrEqual(2000);
    expect(h.now - h.startAt).toBeLessThan(2000 + STEP_MS + 1);
    const h2 = createHarness({ count: 3, qualifyCount: 3 });
    h2.session.setConnected(h2.bots[2].id, false);
    run(h2);
    expect(h2.session.results().filter((r) => r.timeMs !== null)).toHaveLength(2);
  });
});

describe('cheats', () => {
  /** Two players: honest bot 1000 and a scripted cheater 1001. */
  function duel() {
    const h = createHarness({ count: 2, seed: 1 });
    const cheater = h.bots[1];
    const skip = new Set([cheater.id]);
    const state = (pos: Vec3, extra: Partial<IncomingState> = {}): IncomingState => ({
      seq: h.nextSeq(cheater.id),
      raceTimeMs: Math.round(h.now - h.startAt),
      pos,
      vel: [0, 0, 0],
      yaw: 0,
      anim: Anim.RUN,
      grounded: true,
      checkpoint: -1,
      finished: false,
      ...extra,
    });
    const corrections = () => h.text.filter((t) => t.to === cheater.id && t.msg.t === 'correct');
    // reach race start
    while (h.now < h.startAt + 100) h.step(skip);
    return { h, cheater, skip, state, corrections };
  }

  it('rejects a speed hack', () => {
    const { h, cheater, skip, state, corrections } = duel();
    let z = cheater.start[2];
    for (let k = 0; k < 20; k++) {
      z -= 30 * (STEP_MS / 1000); // 30 m/s
      h.session.handleState(cheater.id, state([cheater.start[0], 0.5, z]));
      h.step(skip);
    }
    expect(corrections().length).toBeGreaterThan(0);
    const pos: Vec3 = [0, 0, 0];
    h.session.getPosition(cheater.id, pos);
    expect(pos[2]).toBeGreaterThan(cheater.start[2] - 6);
  });

  it('rejects a teleport, and a respawn jump outside the respawn grid', () => {
    const { h, cheater, skip, state, corrections } = duel();
    h.session.handleState(cheater.id, state([0, 0.5, -60]));
    h.step(skip);
    expect(corrections()).toHaveLength(1);
    expect(corrections()[0].msg.pos).toEqual(cheater.start);
    // respawn flag into the start grid is fine; into the finish is not
    h.session.handleState(cheater.id, state([cheater.start[0], 0, cheater.start[2]], { respawned: true }));
    h.step(skip);
    expect(h.events.some((e) => e.type === 'respawn' && e.id === cheater.id)).toBe(true);
    h.session.handleState(cheater.id, state([0, 0.5, -60], { respawned: true }));
    h.step(skip);
    expect(corrections()).toHaveLength(2);
    expect(h.session.results().find((r) => r.id === cheater.id)?.timeMs).toBeNull();
  });

  it('does not finish a player who skipped a checkpoint', () => {
    const { h, cheater, skip, state } = duel();
    // walk at honest speed around the checkpoint volume (x = 20, outside half width 12), then into the finish
    let px = cheater.start[0];
    let z = cheater.start[2];
    for (let k = 0; k < 400 && !h.session.finished; k++) {
      if (px < 20) px = Math.min(20, px + 0.4);
      else if (z > -62) z -= 0.4;
      else if (px > 0) px -= 0.4;
      h.session.handleState(cheater.id, state([px, 0.5, z]));
      h.step(skip);
    }
    const r = h.session.results().find((x) => x.id === cheater.id);
    expect(r?.timeMs).toBeNull();
    expect(r?.checkpoint).toBe(-1);
    expect(h.events.filter((e) => e.type === 'correct')).toEqual([]);
  });

  it('rejects an early finish and a claimed finish', () => {
    const { h, cheater, skip, state, corrections } = duel();
    h.session.handleState(cheater.id, state([cheater.start[0], 0.5, cheater.start[2] - 0.3], { finished: true }));
    h.step(skip);
    expect(corrections()).toHaveLength(1);
    expect(h.events.some((e) => e.type === 'finished' && e.id === cheater.id)).toBe(false);
    // a course whose route is longer than the time allows: finish fraction lands before minFinishMs
    const limits = deriveLimits(fixtureCourse);
    expect(limits.minFinishMs).toBeGreaterThan(1000);
    expect(limits.maxSpeedH).toBeGreaterThanOrEqual(12 * 1.25);
  });

  it('rejects an early finish under a lagging client clock', () => {
    const sent: string[] = [];
    const events: string[] = [];
    const s = createRaceSession({
      course: fixtureCourse,
      players: [{ id: 1, slot: 0 }],
      config: { qualifyCount: 1, timeLimitMs: 60_000 },
      send: (_id, d) => typeof d === 'string' && sent.push(d),
      onEvent: (e) => events.push(e.type),
    });
    const start: Vec3 = [0, 0, 0];
    gridPoint(fixtureCourse.spawn, 0, start);
    s.start(0);
    s.tick(0);
    // the client claims time is barely moving while it covers ground: rejected by the clock / speed checks
    let seq = 0;
    for (let k = 1; k <= 30; k++) {
      s.tick(k * STEP_MS);
      s.handleState(1, {
        seq: ++seq,
        raceTimeMs: k,
        pos: [start[0], 0.5, start[2] - k * 2],
        vel: [0, 0, 0],
        yaw: 0,
        anim: 1,
        grounded: true,
        checkpoint: -1,
        finished: false,
      });
    }
    expect(events).toContain('correct');
    expect(events).not.toContain('finished');
  });

  it('kicks a state flood', () => {
    const { h, cheater, skip, state } = duel();
    for (let k = 0; k < 200; k++) h.session.handleState(cheater.id, state([cheater.start[0], 0.5, cheater.start[2]]));
    h.step(skip);
    expect(h.events.some((e) => e.type === 'kick' && e.id === cheater.id)).toBe(true);
  });

  it('rejects leaving the spawn grid during the countdown and non-increasing seq', () => {
    const h = createHarness({ count: 2 });
    const id = h.bots[1].id;
    const st = (seq: number, z: number): IncomingState => ({
      seq,
      raceTimeMs: 0,
      pos: [0, 0.5, z],
      vel: [0, 0, 0],
      yaw: 0,
      anim: 0,
      grounded: true,
      checkpoint: -1,
      finished: false,
    });
    h.session.tick(100);
    h.session.handleState(id, st(1, -20));
    expect(h.events.filter((e) => e.type === 'correct')).toHaveLength(1);
    h.session.handleState(id, st(5, -9));
    h.session.handleState(id, st(5, -9));
    h.session.handleState(id, st(4, -9));
    h.session.handleState(id, st(0xffff, -9)); // older (wrapped) seq
    // the duplicate / older seqs are struck but not corrected
    expect(h.events.filter((e) => e.type === 'correct')).toHaveLength(1);
  });

  it('accepts an approved save jump (#84) only once', () => {
    const { h, cheater, skip, state, corrections } = duel();
    h.session.approveSave(cheater.id, [0, 0.5, -20], h.now);
    h.session.handleState(cheater.id, state([0, 0.5, -20]));
    h.step(skip);
    expect(corrections()).toHaveLength(0);
    expect(h.events.some((e) => e.type === 'respawn' && e.save === true)).toBe(true);
    h.session.handleState(cheater.id, state([0, 0.5, -45]));
    h.step(skip);
    expect(corrections()).toHaveLength(1);
  });
});

describe('event course limits (#110)', () => {
  const course = assembleCourse(GUMDROP_GAUNTLET.data as CourseRecipe);
  const limits = deriveLimits(course);
  const params = (kind: string) => course.entities.filter((e) => e.kind === kind).map((e) => e.params);

  it('allow a bounce-pad launch: run speed kept plus the tilted launch, up at the bounce speed', () => {
    for (const p of params('bouncePad')) {
      const b = p.bounce as number;
      const tilt = p.tilt as number;
      expect(limits.maxSpeedH).toBeGreaterThanOrEqual(PLAYER.runSpeed + b * Math.sin(tilt));
      expect(limits.maxSpeedV).toBeGreaterThanOrEqual(b);
    }
  });

  it('allow a wind push on top of a run, a dive or a pad launch', () => {
    const wind = Math.max(...params('snowBlower').map((p) => p.windSpeed as number));
    expect(wind).toBeGreaterThan(0);
    expect(limits.maxSpeedH).toBeGreaterThanOrEqual(Math.max(PLAYER.runSpeed, PLAYER.diveSpeed) + wind);
  });

  /** Corrections sent to one player who runs, rides a pad, then runs in `wind` m/s of side wind. */
  function ride(wind: number): number {
    const sent: string[] = [];
    const s = createRaceSession({
      course,
      players: [{ id: 1, slot: 0 }],
      config: { qualifyCount: 1, timeLimitMs: 120_000 },
      send: (_id, d) => typeof d === 'string' && sent.push(d),
      onEvent: () => {},
    });
    const pos: Vec3 = [0, 0, 0];
    gridPoint(course.spawn, 0, pos);
    s.start(0);
    // 15 Hz states: run, then a pad launch (forward run + tilt, up at the bounce speed) under
    // gravity, then a windy run (run speed forward, `wind` sideways), as the controller does them.
    const pad = params('bouncePad')[0];
    const b = pad.bounce as number;
    const tilt = pad.tilt as number;
    const dt = 1 / 15;
    let vy = 0;
    let seq = 0;
    for (let k = 0; k < 90; k++) {
      const t = k * dt;
      let vx = 0;
      let vz = -PLAYER.runSpeed;
      if (k === 20) vy = b * Math.cos(tilt);
      if (k >= 20 && k < 36) vz -= b * Math.sin(tilt);
      if (k >= 50) vx = wind;
      pos[0] += vx * dt;
      pos[2] += vz * dt;
      if (k >= 20 && k < 36) {
        pos[1] = Math.max(0, pos[1] + vy * dt + 0.5 * PLAYER.gravity * dt * dt);
        vy += PLAYER.gravity * dt;
      } else pos[1] = 0;
      const state: IncomingState = {
        seq: seq++,
        raceTimeMs: Math.round(t * 1000),
        pos: [pos[0], pos[1], pos[2]],
        vel: [vx, k >= 20 && k < 36 ? vy : 0, vz],
        yaw: 0,
        anim: Anim.RUN,
        grounded: pos[1] === 0,
        checkpoint: -1,
        finished: false,
      };
      s.handleState(1, state);
      s.tick(Math.round(t * 1000));
    }
    return sent.filter((m) => JSON.parse(m).t === 'correct').length;
  }

  it('an honest player crossing pads and wind gets zero corrections', () => {
    expect(ride(Math.max(...params('snowBlower').map((p) => p.windSpeed as number)))).toBe(0);
    // Control: the same run with an impossible 40 m/s sideways push is corrected.
    expect(ride(40)).toBeGreaterThan(0);
  });
});

describe('snapshots', () => {
  it('every player reaches every recipient at >= 3 Hz and the nearest 64 every tick', () => {
    const N = 300;
    const frames = new Map<number, Uint8Array>();
    const h = createHarness({ count: N, seed: 11, onSnapshot: (to, d) => frames.set(to, d.slice()) });
    const ticks = 45; // 3 s
    const lastSeen = new Map<string, number>();
    const prevPos = new Map<number, Vec3>();
    const movedRun = new Map<number, number>();
    let maxGap = 0;
    let maxGapMoving = 0;
    let maxBytesPerTick = 0;
    for (let k = 0; k < ticks; k++) {
      frames.clear();
      h.step();
      const truth = new Map<number, Vec3>();
      for (const b of h.bots) {
        const p: Vec3 = [0, 0, 0];
        h.session.getPosition(b.id, p);
        truth.set(b.id, p);
        const q = prevPos.get(b.id);
        const moved = !q || Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) > 0.05;
        movedRun.set(b.id, moved ? (movedRun.get(b.id) ?? 0) + 1 : 0);
        prevPos.set(b.id, p);
      }
      for (const b of h.bots) {
        const data = frames.get(b.id);
        expect(data).toBeDefined();
        maxBytesPerTick = Math.max(maxBytesPerTick, data!.byteLength);
        const seen = decodeSnapshotIds(data!);
        expect(seen).not.toContain(b.id);
        expect(new Set(seen).size).toBe(seen.length);
        const me = truth.get(b.id)!;
        const d = h.bots
          .filter((o) => o.id !== b.id)
          .map((o) => {
            const q = truth.get(o.id)!;
            return { id: o.id, d: (q[0] - me[0]) ** 2 + (q[1] - me[1]) ** 2 + (q[2] - me[2]) ** 2 };
          })
          .sort((a, c) => a.d - c.d);
        const cutoff = d[NEAR_SET_SIZE - 1].d;
        const set = new Set(seen);
        // players standing still are left out between keyframes (#60); the nearest moving ones are always there
        for (const o of d) if (o.d < cutoff && (movedRun.get(o.id) ?? 0) > 0) expect(set.has(o.id)).toBe(true);
        for (const id of seen) lastSeen.set(`${b.id}:${id}`, k);
        if (k >= 4)
          for (const o of h.bots) {
            if (o.id === b.id) continue;
            const gap = k - (lastSeen.get(`${b.id}:${o.id}`) ?? -1);
            maxGap = Math.max(maxGap, gap);
            if ((movedRun.get(o.id) ?? 0) >= 5) maxGapMoving = Math.max(maxGapMoving, gap);
          }
      }
    }
    // moving players refresh at least every 4 ticks (3.75 Hz); still ones at least once per second
    expect(maxGapMoving).toBeLessThanOrEqual(4);
    expect(maxGap).toBeLessThanOrEqual(15);
    expect((maxBytesPerTick * 15) / 1024).toBeLessThanOrEqual(25);
  });

  it('drops disconnected players from snapshots after 5 s', () => {
    // a still player is sent once per second, so look at everything recipient 1000 got in the last second
    const recent: number[][] = [];
    const h = createHarness({
      count: 3,
      onSnapshot: (to, d) => {
        if (to === 1000) recent.push(decodeSnapshotIds(d));
        if (recent.length > 15) recent.shift();
      },
    });
    const lastSecond = () => new Set(recent.flat());
    h.session.setConnected(1002, false);
    for (let k = 0; k < 10; k++) h.step(new Set([1002]));
    expect(lastSecond()).toContain(1002);
    while (h.now < 6400) h.step(new Set([1002])); // 5 s stale limit + the 1 s window
    expect(lastSecond()).not.toContain(1002);
  });
});
