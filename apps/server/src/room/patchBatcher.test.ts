import { describe, expect, it } from 'bun:test';
import { ServerMessageSchema } from '@wobble/shared/schemas/protocol';
import type { RoomPlayer, RoomState } from '@wobble/shared/types';
import { createPatchBatcher } from './patchBatcher.ts';
import type { RoomPatch } from './patchBatcher.ts';

// ---- helpers ----------------------------------------------------------------

/** Manual clock: timers only run when the test calls advance(). */
function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    get now() {
      return now;
    },
    get pending() {
      return timers.size;
    },
    setTimer(fn: () => void, ms: number): unknown {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer(handle: unknown): void {
      timers.delete(handle as number);
    },
    /** Moves time forward, running every timer that falls due, in order. */
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | undefined;
        for (const entry of timers) if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry;
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

/** A batcher wired to a fake clock; every published message is schema-checked. */
function setup(intervalMs?: number) {
  const clock = createFakeClock();
  const sent: RoomPatch[] = [];
  const batcher = createPatchBatcher({
    intervalMs,
    publish: (msg) => {
      ServerMessageSchema.parse(msg);
      // deep copy so later batcher activity can't change what we recorded
      sent.push(structuredClone(msg));
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, sent, batcher };
}

function player(id: number, extra: Partial<RoomPlayer> = {}): RoomPlayer {
  return { id, name: `P${id}`, skinId: 'b:pip', ready: false, connected: true, ...extra };
}

function baseState(players: RoomPlayer[] = []): RoomState {
  return {
    id: 'room-1',
    code: 'ABCDE',
    phase: 'lobby',
    hostId: players[0]?.id ?? 0,
    config: { courseId: 'b:course', themeId: 'b:theme' },
    players: players.map((p) => ({ ...p })),
  };
}

/** Reference client: applies a roomPatch to a RoomState (returns a new state). */
function applyPatch(state: RoomState, patch: RoomPatch): RoomState {
  const left = new Set(patch.left ?? []);
  let players = state.players.filter((p) => !left.has(p.id)).map((p) => ({ ...p }));
  for (const j of patch.joined ?? []) players = [...players.filter((p) => p.id !== j.id), { ...j }];
  for (const u of patch.updated ?? []) {
    const p = players.find((q) => q.id === u.id);
    if (p) Object.assign(p, u);
  }
  return {
    ...state,
    phase: patch.phase ?? state.phase,
    hostId: patch.hostId ?? state.hostId,
    config: patch.config ? { ...patch.config } : state.config,
    players,
  };
}

/** Player list order is not part of the contract: compare by id. */
function normalise(state: RoomState): RoomState {
  return { ...state, players: [...state.players].sort((a, b) => a.id - b.id) };
}

/** Small seeded PRNG (mulberry32) so the property test is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- tests --------------------------------------------------------------------

describe('createPatchBatcher', () => {
  it('100 joins within 1 s produce at most 6 roomPatch messages, none lost', () => {
    const { clock, sent, batcher } = setup();
    for (let i = 0; i < 100; i++) {
      batcher.join(player(i + 1));
      clock.advance(10); // 100 joins spread over 1 s
    }
    clock.advance(1000);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThanOrEqual(6);
    const ids = sent.flatMap((m) => m.joined ?? []).map((p) => p.id);
    expect(ids.sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it('100 joins in the same instant produce exactly one message', () => {
    const { clock, sent, batcher } = setup();
    for (let i = 1; i <= 100; i++) batcher.join(player(i));
    clock.advance(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.joined).toHaveLength(100);
  });

  it('waits for the interval and never flushes more often than it', () => {
    const { clock, sent, batcher } = setup(200);
    batcher.join(player(1));
    clock.advance(199);
    expect(sent).toHaveLength(0);
    clock.advance(1);
    expect(sent).toHaveLength(1);
    // a change right after a flush waits a full interval again
    batcher.join(player(2));
    clock.advance(199);
    expect(sent).toHaveLength(1);
    clock.advance(1);
    expect(sent).toHaveLength(2);
  });

  it('respects a custom interval', () => {
    const { clock, sent, batcher } = setup(50);
    batcher.join(player(1));
    clock.advance(50);
    expect(sent).toHaveLength(1);
  });

  it('join + leave in one window produces no entry for that player', () => {
    const { clock, sent, batcher } = setup();
    batcher.join(player(1));
    batcher.join(player(2));
    batcher.update({ id: 2, ready: true });
    batcher.leave(2);
    clock.advance(200);
    expect(sent).toEqual([{ t: 'roomPatch', joined: [player(1)] }]);
  });

  it('never sends an empty patch', () => {
    const { clock, sent, batcher } = setup();
    batcher.join(player(1));
    batcher.leave(1);
    clock.advance(1000);
    batcher.flush();
    expect(sent).toHaveLength(0);
  });

  it('merges several updates to one player into one entry', () => {
    const { clock, sent, batcher } = setup();
    batcher.update({ id: 5, ready: true });
    batcher.update({ id: 5, skinId: 'b:frog' });
    batcher.update({ id: 5, ready: false, connected: false });
    clock.advance(200);
    expect(sent).toEqual([{ t: 'roomPatch', updated: [{ id: 5, ready: false, skinId: 'b:frog', connected: false }] }]);
  });

  it('folds an update for a player who joined in the same window into the joined entry', () => {
    const { clock, sent, batcher } = setup();
    batcher.join(player(3));
    batcher.update({ id: 3, ready: true });
    clock.advance(200);
    expect(sent).toEqual([{ t: 'roomPatch', joined: [player(3, { ready: true })] }]);
  });

  it('drops updates to a player who already left', () => {
    const { clock, sent, batcher } = setup();
    batcher.update({ id: 4, ready: true });
    batcher.leave(4);
    batcher.update({ id: 4, ready: false });
    clock.advance(200);
    expect(sent).toEqual([{ t: 'roomPatch', left: [4] }]);
  });

  it('a known player who leaves and rejoins in one window becomes one full update', () => {
    const { clock, sent, batcher } = setup();
    batcher.leave(7);
    batcher.join(player(7, { skinId: 'b:frog' }));
    batcher.update({ id: 7, ready: true });
    clock.advance(200);
    expect(sent).toEqual([{ t: 'roomPatch', updated: [player(7, { skinId: 'b:frog', ready: true })] }]);
    // applying it gives the same state as applying the leave and the join one by one
    const before = baseState([player(7, { name: 'Old', ready: true })]);
    expect(applyPatch(before, sent[0]!)).toEqual(baseState([player(7, { skinId: 'b:frog', ready: true })]));
  });

  it('leave, rejoin, leave again in one window is just a leave', () => {
    const { clock, sent, batcher } = setup();
    batcher.leave(7);
    batcher.join(player(7));
    batcher.leave(7);
    clock.advance(200);
    expect(sent).toEqual([{ t: 'roomPatch', left: [7] }]);
  });

  it('a partial update never erases fields with undefined', () => {
    const { clock, sent, batcher } = setup();
    batcher.join(player(1, { ready: true }));
    batcher.update({ id: 1, ready: undefined, connected: false });
    clock.advance(200);
    expect(sent[0]?.joined).toEqual([player(1, { ready: true, connected: false })]);
  });

  it('last phase, host and config win', () => {
    const { clock, sent, batcher } = setup();
    batcher.setHost(1);
    batcher.setHost(2);
    batcher.setConfig({ courseId: 'b:a', themeId: 'b:a' });
    batcher.setConfig({ courseId: 'b:b', themeId: 'b:c' });
    batcher.setPhase('results');
    batcher.setPhase('lobby');
    clock.advance(200);
    expect(sent).toEqual([{ t: 'roomPatch', phase: 'lobby', hostId: 2, config: { courseId: 'b:b', themeId: 'b:c' } }]);
  });

  it.each(['loading', 'countdown'] as const)('flushes at once (with pending changes) on phase %s', (phase) => {
    const { clock, sent, batcher } = setup();
    batcher.update({ id: 1, ready: true });
    batcher.setPhase(phase);
    expect(sent).toEqual([{ t: 'roomPatch', updated: [{ id: 1, ready: true }], phase }]);
    // the pending timer was cancelled: nothing more is sent
    expect(clock.pending).toBe(0);
    clock.advance(1000);
    expect(sent).toHaveLength(1);
  });

  it('does not flush at once for the other phases', () => {
    const { clock, sent, batcher } = setup();
    for (const phase of ['lobby', 'race', 'results'] as const) {
      batcher.setPhase(phase);
      expect(sent).toHaveLength(0);
    }
    clock.advance(200);
    expect(sent).toEqual([{ t: 'roomPatch', phase: 'results' }]);
  });

  it('flush() publishes now and cancels the timer', () => {
    const { clock, sent, batcher } = setup();
    batcher.join(player(1));
    batcher.flush();
    expect(sent).toHaveLength(1);
    expect(clock.pending).toBe(0);
  });

  it('does not alias the caller objects', () => {
    const { clock, sent, batcher } = setup();
    const p = player(1);
    batcher.join(p);
    batcher.update({ id: 1, ready: true });
    expect(p.ready).toBe(false);
    clock.advance(200);
    expect(sent[0]?.joined?.[0]?.ready).toBe(true);
  });

  it('dispose() drops pending changes and ignores later calls', () => {
    const { clock, sent, batcher } = setup();
    batcher.join(player(1));
    batcher.dispose();
    expect(clock.pending).toBe(0);
    batcher.join(player(2));
    batcher.setPhase('countdown');
    batcher.flush();
    clock.advance(1000);
    expect(sent).toHaveLength(0);
  });

  it('works with the real setTimeout by default', async () => {
    const sent: RoomPatch[] = [];
    const batcher = createPatchBatcher({ intervalMs: 5, publish: (m) => sent.push(m) });
    batcher.join(player(1));
    batcher.join(player(2));
    await Bun.sleep(20);
    expect(sent).toHaveLength(1);
    batcher.dispose();
  });

  it('property: applying the merged patches equals applying every change one by one', () => {
    const phases = ['lobby', 'loading', 'countdown', 'race', 'results'] as const;
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

      const start = baseState([player(1), player(2), player(3)]);
      let truth = start; // changed one by one, like the room module would
      let client = start; // only sees the batched patches
      let flushes = 0;
      const clock = createFakeClock();
      const batcher = createPatchBatcher({
        publish: (msg) => {
          ServerMessageSchema.parse(msg);
          client = applyPatch(client, msg);
          flushes++;
          // at every flush the client must have caught up with the truth exactly
          expect(normalise(client)).toEqual(normalise(truth));
        },
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      });

      let nextId = 4;
      for (let step = 0; step < 60; step++) {
        const ids = truth.players.map((p) => p.id);
        // reuse an old id sometimes, so leave-then-rejoin happens
        const freeId = rand() < 0.3 ? pick([1, 2, 3, 4, 5]) : nextId++;
        const r = rand();
        if (r < 0.25 && !ids.includes(freeId)) {
          const p = player(freeId, { skinId: pick(['b:pip', 'b:frog']), ready: rand() < 0.5 });
          truth = applyPatch(truth, { t: 'roomPatch', joined: [p] });
          batcher.join(p);
        } else if (r < 0.45 && ids.length > 0) {
          const id = pick(ids);
          truth = applyPatch(truth, { t: 'roomPatch', left: [id] });
          batcher.leave(id);
        } else if (r < 0.75 && ids.length > 0) {
          const change = { id: pick(ids), ...(rand() < 0.5 ? { ready: rand() < 0.5 } : { connected: rand() < 0.5 }) };
          truth = applyPatch(truth, { t: 'roomPatch', updated: [change] });
          batcher.update(change);
        } else if (r < 0.82) {
          const phase = pick(phases);
          truth = applyPatch(truth, { t: 'roomPatch', phase });
          batcher.setPhase(phase);
        } else if (r < 0.9) {
          const hostId = pick([1, 2, 3, 4]);
          truth = applyPatch(truth, { t: 'roomPatch', hostId });
          batcher.setHost(hostId);
        } else {
          const config = { courseId: pick(['b:a', 'b:b']), themeId: pick(['b:a', 'b:b']) };
          truth = applyPatch(truth, { t: 'roomPatch', config });
          batcher.setConfig(config);
        }
        clock.advance(Math.floor(rand() * 120));
      }
      batcher.flush();
      expect(normalise(client)).toEqual(normalise(truth));
      expect(flushes).toBeGreaterThan(0);
    }
  });
});
