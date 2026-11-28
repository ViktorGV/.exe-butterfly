import { describe, expect, it } from 'bun:test';
import { WIRE } from '@wobble/shared/constants';
import type { PlayerState } from '@wobble/shared/types';
import { createNetClient } from './netClient.ts';
import { createOfflineSession } from './offline.ts';
import type { NetSession } from './session.ts';
import { MockServer, createFakeClock, makePath, runnerZ } from './testing/mockNet.ts';
import type { FakeClock, Runner } from './testing/mockNet.ts';

const HELLO = { name: 'Tester', clientId: 'client-0001', room: 'quick' as const };
const START = 1_000_000;
const OFFSET = 54_321;
const RUNNER: Runner = { id: 7, speed: 7.5, x: 1, t0Ms: START + OFFSET };

function setup(seed: number, baseMs: number, jitterMs: number, loss: number, offsetMs = OFFSET) {
  const clock = createFakeClock(START);
  const server = new MockServer({
    clock,
    up: makePath(seed, baseMs, jitterMs, loss),
    down: makePath(seed + 1000, baseMs, jitterMs, loss),
    offsetMs,
    runners: [RUNNER],
  });
  let hidden = false;
  const client = createNetClient({
    url: 'ws://mock',
    createSocket: server.createSocket,
    now: clock.now,
    setTimer: (fn, ms) => clock.setTimer(fn, ms),
    clearTimer: clock.clearTimer,
    random: () => 0.5,
    isHidden: () => hidden,
  });
  return {
    clock,
    server,
    client,
    setHidden: (h: boolean) => {
      hidden = h;
    },
  };
}

function playerState(z = 0): PlayerState {
  return { pos: [0, 0, z], vel: [0, 0, 0], yaw: 0, anim: 1, grounded: true, checkpoint: -1, finished: false };
}

// latency 50-250 ms one way, up to 40 ms jitter, 5% loss
const CASES: [number, number][] = [
  [1, 50],
  [2, 100],
  [3, 150],
  [4, 200],
  [5, 250],
];

describe('net client over a lossy, jittery mock socket', () => {
  it.each(CASES)(
    'clock error < 15 ms, motion never backwards, position error < 0.3 m (seed %i, %i ms)',
    (seed, base) => {
      const { clock, server, client } = setup(seed, base, 40, 0.05);
      client.connect(HELLO);
      clock.run(3000);
      expect(client.playerId).toBe(1);

      let lastZ = Infinity;
      let frames = 0;
      let worstPos = 0;
      let worstClock = 0;
      clock.run(20_000, 1000 / 60, () => {
        worstClock = Math.max(worstClock, Math.abs(client.serverNow() - server.serverNow()));
        const r = client.sampleRemote().get(RUNNER.id);
        if (!r) return;
        frames++;
        expect(r.pos[2]).toBeLessThanOrEqual(lastZ + 1e-6); // runner moves toward -Z only
        lastZ = r.pos[2];
        const truth = runnerZ(RUNNER, server.serverNow() - client.stats().renderDelayMs);
        worstPos = Math.max(worstPos, Math.abs(r.pos[2] - truth));
      });
      expect(frames).toBeGreaterThan(1000);
      expect(worstClock).toBeLessThan(15);
      expect(worstPos).toBeLessThan(0.3);
      const s = client.stats();
      expect(s.rttMs).toBeGreaterThanOrEqual(2 * base);
      expect(s.snapshotsPerSec).toBeGreaterThan(10);
    },
  );

  it('sendState is called every frame but transmits at NET_SEND_HZ with the latest state', () => {
    const { clock, server, client } = setup(9, 30, 0, 0);
    client.connect(HELLO);
    clock.run(500);
    server.statesReceived.length = 0;
    let z = 0;
    clock.run(2000, 1000 / 60, () => client.sendState(playerState((z -= 0.1))));
    clock.run(200);
    const n = server.statesReceived.length;
    expect(n).toBeGreaterThanOrEqual(29);
    expect(n).toBeLessThanOrEqual(31);
    const last = new DataView(server.statesReceived[n - 1]!);
    expect(last.byteLength).toBe(WIRE.STATE_BYTES);
    expect(last.getUint8(0)).toBe(WIRE.MSG_STATE);
    // the last transmitted state is one of the final few frames
    expect(last.getInt16(11, true) / 50).toBeLessThan(z + 0.5);
    const seqs = server.statesReceived.map((b) => new DataView(b).getUint16(1, true));
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1]! + 1);
  });

  it('keeps a 1 Hz trickle when the tab is hidden', () => {
    const { clock, server, client, setHidden } = setup(10, 30, 0, 0);
    client.connect(HELLO);
    clock.run(500);
    client.sendState(playerState());
    setHidden(true);
    server.statesReceived.length = 0;
    clock.run(10_000, 1000); // hidden: no frames call sendState
    expect(server.statesReceived.length).toBeGreaterThanOrEqual(9);
    expect(server.statesReceived.length).toBeLessThanOrEqual(11);
  });

  it('reconnects with backoff after a mid-race drop and resumes with the same player id', () => {
    const { clock, server, client } = setup(11, 60, 10, 0);
    const events: string[] = [];
    client.on('disconnect', (e) => events.push(`disconnect:${e.willReconnect}`));
    client.on('reconnect', (e) => events.push(`reconnect:${e.playerId}`));
    client.on('welcome', (e) => events.push(`welcome:${e.playerId}`));
    client.connect(HELLO);
    clock.run(2000);
    server.send({ t: 'countdown', startAt: server.serverNow() + 1000 });
    clock.run(3000);
    expect(client.raceTimeSec()).toBeGreaterThan(1.5);

    server.dropAll();
    clock.run(5000);
    expect(events).toEqual(['welcome:1', 'disconnect:true', 'welcome:1', 'reconnect:1']);
    expect(client.playerId).toBe(1);
    const hellos = server.textReceived.filter((m) => m.t === 'hello') as { token?: string }[];
    expect(hellos[0]!.token).toBeUndefined();
    expect(hellos[1]!.token).toBe('tok-1');
    expect(server.room.players.length).toBe(1);
    // race clock and remote players carry on
    expect(client.raceTimeSec()).toBeGreaterThan(6);
    expect(client.sampleRemote().has(RUNNER.id)).toBe(true);
  });

  it('backs off exponentially while the server stays unreachable, and disconnect() stops it', () => {
    const clock = createFakeClock();
    const opened: number[] = [];
    const client = createNetClient({
      url: 'ws://nowhere',
      now: clock.now,
      setTimer: (fn, ms) => clock.setTimer(fn, ms),
      clearTimer: clock.clearTimer,
      random: () => 0.5,
      isHidden: () => false,
      createSocket: () => {
        opened.push(clock.now());
        const s = {
          binaryType: '',
          readyState: 0,
          send() {},
          close() {},
          onopen: null,
          onclose: null as ((e: unknown) => void) | null,
          onerror: null,
          onmessage: null,
        };
        clock.setTimer(() => s.onclose?.({}), 10);
        return s;
      },
    });
    client.connect(HELLO);
    clock.run(4000);
    const gaps = opened.slice(1).map((t, i) => t - opened[i]! - 10);
    expect(gaps.slice(0, 4)).toEqual([250, 500, 1000, 2000]);
    client.disconnect();
    const n = opened.length;
    clock.run(60_000);
    expect(opened.length).toBe(n);
  });

  it('applies roomPatch deltas and emits room', () => {
    const { clock, server, client } = setup(12, 20, 0, 0);
    const rooms: number[] = [];
    client.on('room', (r) => rooms.push(r.players.length));
    client.connect(HELLO);
    clock.run(500);
    server.send({
      t: 'roomPatch',
      joined: [{ id: 2, name: 'B', skinId: 'b:fixture-skin', ready: false, connected: true }],
      phase: 'loading',
    });
    server.send({ t: 'roomPatch', updated: [{ id: 2, ready: true }], hostId: 2 });
    server.send({ t: 'roomPatch', left: [1] });
    clock.run(500);
    expect(rooms).toEqual([1, 2, 2, 1]);
    expect(client.room!.phase).toBe('loading');
    expect(client.room!.hostId).toBe(2);
    expect(client.room!.players[0]).toMatchObject({ id: 2, ready: true });
  });

  it('ignores malformed text frames and emits server errors', () => {
    const { clock, server, client } = setup(13, 20, 0, 0);
    const errs: string[] = [];
    client.on('error', (e) => errs.push(e.code));
    client.connect(HELLO);
    clock.run(500);
    for (const s of server.sockets) {
      server.toClient(s, '{nope', false);
      server.toClient(s, JSON.stringify({ t: 'bogus' }), false);
    }
    server.send({ t: 'error', code: 'shutdown', msg: 'restarting' });
    clock.run(500);
    expect(errs).toEqual(['shutdown']);
  });
});

// ---- shared interface suite: online client and offline session -----------

interface Harness {
  session: NetSession;
  clock: FakeClock;
  /** Let messages flow. */
  flush(): void;
  /** Make the server send a countdown if this harness needs it after sendLoaded. */
  afterLoaded(): void;
}

function onlineHarness(): Harness {
  const { clock, server, client } = setup(20, 20, 0, 0);
  return {
    session: client,
    clock,
    flush: () => clock.run(300),
    afterLoaded: () => {
      server.send({
        t: 'matchConfig',
        courseId: 'b:fixture-course',
        themeId: 'b:fixture-theme',
        qualifyCount: 1,
        players: [],
      });
      server.send({ t: 'countdown', startAt: server.serverNow() + 3000 });
    },
  };
}

function offlineHarness(): Harness {
  const clock = createFakeClock();
  const q: (() => void)[] = [];
  const session = createOfflineSession({
    courseId: 'b:fixture-course',
    themeId: 'b:fixture-theme',
    skinId: 'b:fixture-skin',
    now: clock.now,
    defer: (fn) => q.push(fn),
  });
  return {
    session,
    clock,
    flush: () => {
      while (q.length) q.shift()!();
      clock.run(300);
    },
    afterLoaded: () => {},
  };
}

describe.each([
  ['online', onlineHarness],
  ['offline', offlineHarness],
])('NetSession interface (%s)', (_name, make) => {
  it('connect emits welcome and room, then start/loaded leads to matchConfig and countdown', () => {
    const h = make();
    const seen: string[] = [];
    for (const e of ['welcome', 'room', 'matchConfig', 'countdown'] as const) h.session.on(e, () => seen.push(e));
    h.session.connect(HELLO);
    h.flush();
    expect(seen.slice(0, 2)).toEqual(['welcome', 'room']);
    expect(h.session.playerId).not.toBeNull();
    expect(h.session.room).not.toBeNull();
    expect(h.session.raceTimeSec()).toBe(0);

    h.session.start();
    h.flush();
    h.session.sendLoaded();
    h.afterLoaded();
    h.flush();
    expect(seen).toContain('matchConfig');
    expect(seen).toContain('countdown');
    const rt = h.session.raceTimeSec();
    expect(rt).toBeLessThan(0);
    expect(rt).toBeGreaterThan(-3.5);
    h.clock.run(5000);
    expect(h.session.raceTimeSec()).toBeGreaterThan(1);
  });

  it('sampleRemote returns the same Map every call and sendState never throws', () => {
    const h = make();
    h.session.connect(HELLO);
    h.flush();
    const a = h.session.sampleRemote();
    h.session.sendState(playerState());
    h.clock.run(500);
    expect(h.session.sampleRemote()).toBe(a);
  });

  it('on() returns an unsubscribe function and disconnect emits disconnect', () => {
    const h = make();
    let welcomes = 0;
    const off = h.session.on('welcome', () => welcomes++);
    off();
    const dis: boolean[] = [];
    h.session.on('disconnect', (e) => dis.push(e.willReconnect));
    h.session.connect(HELLO);
    h.flush();
    expect(welcomes).toBe(0);
    h.session.disconnect();
    h.flush();
    expect(dis).toEqual([false]);
  });

  it('stats() returns numbers', () => {
    const h = make();
    h.session.connect(HELLO);
    h.flush();
    const s = h.session.stats();
    for (const v of Object.values(s)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('offline session', () => {
  it('forwards local checkpoint and finish as server-like events', () => {
    const h = offlineHarness();
    const s = h.session as ReturnType<typeof createOfflineSession>;
    const got: string[] = [];
    s.on('checkpoint', (e) => got.push(`cp${e.index}`));
    s.on('finished', (e) => got.push(`fin${e.place}:${e.timeMs}`));
    s.on('raceEnd', () => got.push('end'));
    s.connect(HELLO);
    s.start();
    s.sendLoaded();
    h.flush();
    h.clock.run(2700); // countdown 3000, 300 already flushed
    s.reportCheckpoint(0);
    h.clock.run(12_000);
    s.reportFinish();
    s.reportFinish();
    expect(got).toEqual(['cp0', 'fin1:12000', 'end']);
    expect(s.sampleRemote().size).toBe(0);
  });
});

describe('offline grab', () => {
  it('forwards grabs on others to onGrab during the race only', () => {
    const got: string[] = [];
    let now = 0;
    const s = createOfflineSession({
      courseId: 'c',
      themeId: 't',
      skinId: 's',
      now: () => now,
      defer: (fn) => fn(),
      onGrab: (id, kind, dir) => got.push(`${id}:${kind}:${dir[0]}`),
    });
    s.connect(HELLO);
    s.grab(3, 'push', [1, 0]); // before the race: ignored
    s.start();
    s.sendLoaded();
    s.grab(3, 'push', [1, 0]);
    s.grab(0, 'push', [1, 0]); // yourself: ignored
    now = 5000;
    s.reportFinish();
    s.grab(3, 'save', [0, 1]); // after finishing: ignored
    expect(got).toEqual(['3:push:1']);
  });
});

describe('allocation behaviour', () => {
  it('sendState and sampleRemote reuse their buffers (no per-frame garbage)', () => {
    const { clock, client } = setup(30, 40, 0, 0);
    client.connect(HELLO);
    clock.run(2000);
    const st = playerState();
    const map = client.sampleRemote();
    const r = map.get(RUNNER.id)!;
    const pos = r.pos;
    clock.run(2000, 1000 / 60, () => {
      st.pos[2] -= 0.1;
      client.sendState(st);
      const m = client.sampleRemote();
      expect(m).toBe(map);
      expect(m.get(RUNNER.id)).toBe(r);
      expect(m.get(RUNNER.id)!.pos).toBe(pos);
    });
    // heap check: 10k frames of sendState + sampleRemote with no socket traffic in between
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 10_000; i++) {
      st.pos[2] -= 0.01;
      client.sendState(st);
      client.sampleRemote();
    }
    const grown = process.memoryUsage().heapUsed - before;
    expect(grown).toBeLessThan(256 * 1024);
  });
});
