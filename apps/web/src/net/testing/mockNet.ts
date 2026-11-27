// Test harness: fake clock, and a mock game server reached through mock sockets with
// simulated latency, jitter and loss. Used by the net tests (not shipped in the app bundle).
import { WIRE } from '@wobble/shared/constants';
import type { RoomState } from '@wobble/shared/types';
import { createSnapshotWriter, encodePlayerRecord } from '@wobble/shared/protocol/snapshot';
import type { SocketLike } from '../netClient.ts';

export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ev {
  id: number;
  at: number;
  fn: () => void;
}

export function createFakeClock(start = 1_000_000) {
  let t = start;
  let nextId = 1;
  const events: Ev[] = [];
  return {
    now: () => t,
    setTimer(fn: () => void, ms: number): number {
      const id = nextId++;
      events.push({ id, at: t + Math.max(0, ms), fn });
      return id;
    },
    clearTimer(h: unknown) {
      const i = events.findIndex((e) => e.id === h);
      if (i >= 0) events.splice(i, 1);
    },
    /** Advance in steps of `frameMs`, calling `frame` after each step, running due events. */
    run(ms: number, frameMs = 1000 / 60, frame?: () => void) {
      const end = t + ms;
      while (t < end) {
        const stepEnd = Math.min(end, t + frameMs);
        for (;;) {
          let best = -1;
          for (let i = 0; i < events.length; i++) {
            const e = events[i]!;
            if (
              e.at <= stepEnd &&
              (best < 0 || e.at < events[best]!.at || (e.at === events[best]!.at && e.id < events[best]!.id))
            )
              best = i;
          }
          if (best < 0) break;
          const [e] = events.splice(best, 1);
          t = Math.max(t, e!.at);
          e!.fn();
        }
        t = stepEnd;
        frame?.();
      }
    },
  };
}
export type FakeClock = ReturnType<typeof createFakeClock>;

export interface NetPath {
  /** One-way delay in ms for the next message. */
  delay(): number;
  /** True to drop this (droppable) message. */
  lose(): boolean;
}

export function makePath(seed: number, baseMs: number, jitterMs: number, loss: number): NetPath {
  const rand = mulberry32(seed);
  return {
    // queueing jitter: most packets see only a few ms, some up to the full jitterMs
    delay: () => baseMs + (rand() < 0.7 ? rand() * Math.min(5, jitterMs) : rand() * jitterMs),
    lose: () => rand() < loss,
  };
}

/** Constant-speed runner used as the remote player: z = -speed * t (seconds of server time). */
export interface Runner {
  id: number;
  speed: number;
  x: number;
  /** Server time (ms) at which the runner is at z = 600. */
  t0Ms: number;
}

export function runnerZ(r: Runner, serverMs: number): number {
  return 600 - r.speed * ((serverMs - r.t0Ms) / 1000); // inside the int16 range for ~2 minutes
}

class MockSocket implements SocketLike {
  binaryType = 'blob';
  readyState = 0;
  bufferedAmount = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(private readonly srv: MockServer) {}
  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== 1) return;
    const copy =
      typeof data === 'string'
        ? data
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer
          : data.slice(0);
    this.srv.fromClient(this, copy);
  }
  close(): void {
    this.srv.dropSocket(this);
  }
}

export interface MockClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
}

export interface MockServerOptions {
  clock: MockClock;
  up: NetPath;
  down: NetPath;
  /** Server clock = local clock + offset. */
  offsetMs: number;
  runners?: Runner[];
  snapshotHz?: number;
}

export class MockServer {
  readonly sockets = new Set<MockSocket>();
  readonly tokens = new Map<string, number>();
  readonly statesReceived: ArrayBuffer[] = [];
  readonly textReceived: { t: string }[] = [];
  private nextId = 1;
  private lastDown = new Map<MockSocket, number>();
  private lastUp = new Map<MockSocket, number>();
  private snapTimer: unknown = null;
  readonly room: RoomState = {
    id: 'r1',
    code: 'ABCDE',
    phase: 'lobby',
    hostId: 1,
    config: { courseId: 'b:fixture-course', themeId: 'b:fixture-theme' },
    players: [],
  };

  constructor(readonly o: MockServerOptions) {}

  serverNow(): number {
    return this.o.clock.now() + this.o.offsetMs;
  }

  createSocket = (_url: string): SocketLike => {
    const s = new MockSocket(this);
    this.sockets.add(s);
    this.o.clock.setTimer(() => {
      if (!this.sockets.has(s)) return;
      s.readyState = 1;
      s.onopen?.({});
    }, this.o.up.delay());
    return s;
  };

  /** Deliver to the server, keeping per-socket FIFO order like TCP. */
  fromClient(s: MockSocket, data: string | ArrayBuffer): void {
    const droppable = typeof data !== 'string' || data.includes('"ping"');
    if (droppable && this.o.up.lose()) return;
    const at = Math.max(this.lastUp.get(s) ?? 0, this.o.clock.now() + this.o.up.delay());
    this.lastUp.set(s, at);
    this.o.clock.setTimer(() => this.handle(s, data), at - this.o.clock.now());
  }

  toClient(s: MockSocket, data: string | ArrayBuffer, droppable: boolean): void {
    if (droppable && this.o.down.lose()) return;
    const at = Math.max(this.lastDown.get(s) ?? 0, this.o.clock.now() + this.o.down.delay());
    this.lastDown.set(s, at);
    this.o.clock.setTimer(() => {
      if (this.sockets.has(s) && s.readyState === 1) s.onmessage?.({ data });
    }, at - this.o.clock.now());
  }

  private handle(s: MockSocket, data: string | ArrayBuffer): void {
    if (!this.sockets.has(s)) return;
    if (typeof data !== 'string') {
      if (new DataView(data).getUint8(0) === WIRE.MSG_STATE) this.statesReceived.push(data);
      return;
    }
    const m = JSON.parse(data) as { t: string; c?: number; token?: string; name?: string };
    this.textReceived.push(m);
    if (m.t === 'ping') {
      this.toClient(s, JSON.stringify({ t: 'pong', c: m.c, s: this.serverNow() }), true);
    } else if (m.t === 'hello') {
      let id = m.token ? this.tokens.get(m.token) : undefined;
      if (id === undefined) {
        id = this.nextId++;
        this.tokens.set(`tok-${id}`, id);
        this.room.players.push({ id, name: m.name ?? 'p', skinId: 'b:fixture-skin', ready: false, connected: true });
      }
      this.toClient(s, JSON.stringify({ t: 'welcome', playerId: id, token: `tok-${id}`, room: this.room }), false);
      this.startSnapshots();
    }
  }

  send(obj: object): void {
    for (const s of this.sockets) this.toClient(s, JSON.stringify(obj), false);
  }

  private startSnapshots(): void {
    if (this.snapTimer !== null || !this.o.runners?.length) return;
    const every = 1000 / (this.o.snapshotHz ?? 15);
    const tick = () => {
      this.snapTimer = this.o.clock.setTimer(tick, every);
      const t = this.serverNow();
      const runners = this.o.runners!;
      const records = new Uint8Array(runners.length * WIRE.SNAPSHOT_RECORD_BYTES);
      const writer = createSnapshotWriter({ maxRecords: runners.length });
      writer.begin(t);
      runners.forEach((r, i) => {
        const st = {
          pos: [r.x, 0, runnerZ(r, t)] as [number, number, number],
          yaw: 0,
          anim: 1 as const,
          grounded: false,
          finished: false,
        };
        encodePlayerRecord(r.id, st, records, i * WIRE.SNAPSHOT_RECORD_BYTES);
        writer.copyRecord(records, i);
      });
      const frame = writer.finish().slice().buffer;
      for (const s of this.sockets) this.toClient(s, frame, true);
    };
    tick();
  }

  /** Simulate the connection dropping (server side). */
  dropSocket(s: MockSocket): void {
    if (!this.sockets.delete(s)) return;
    s.readyState = 3;
    this.o.clock.setTimer(() => s.onclose?.({}), 0);
  }

  dropAll(): void {
    for (const s of [...this.sockets]) this.dropSocket(s);
  }
}
