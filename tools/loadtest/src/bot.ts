// One headless player speaking the real wire protocol: hello -> ready -> loaded -> race -> done.
import { assembleCourse, fixtureCourse, resolveBuiltin } from '@wobble/shared';
import { decodeSnapshot, encodeState, parseServerControl, serializeControl } from '@wobble/shared/protocol/index';
import { Anim, NET_SEND_HZ, PLAYER, PROTOCOL_VERSION } from '@wobble/shared/constants';
import type { AnimValue, CourseDef } from '@wobble/shared/types';
import type { Counters, Histogram } from './metrics.ts';
import { createPathFollower } from './path.ts';
import type { PathFollower, PathState } from './path.ts';

export interface BotOptions {
  url: string;
  name: string;
  /** 'new' for the first bot of a room, then the room code */
  room: string;
  /** m/s along the course line; kept under the run speed */
  speed: number;
  counters: Counters;
  /** snapshot inter-arrival times, shared by the swarm */
  gaps: Histogram;
  onWelcome(code: string, id: number): void;
  onCountdown(startAt: number): void;
  onDone(): void;
}

export interface Bot {
  readonly id: number;
  readonly welcomed: boolean;
  readonly done: boolean;
  start(): void;
  /** called by the swarm's single timer at NET_SEND_HZ */
  tick(now: number): void;
  close(): void;
}

function courseFor(id: string): CourseDef {
  const pack = resolveBuiltin(id);
  return pack?.kind === 'course' ? assembleCourse(pack.data) : structuredClone(fixtureCourse);
}

const noop = () => {};

export function createBot(o: BotOptions): Bot {
  const c = o.counters;
  const t0 = performance.now();
  const ws = new WebSocket(o.url);
  ws.binaryType = 'arraybuffer';
  const frame = new Uint8Array(15);
  const state: PathState & { pos: [number, number, number] } = { pos: [0, 0, 0], yaw: 0, finished: false };
  const wire = { pos: state.pos, yaw: 0, anim: Anim.RUN as AnimValue, grounded: true, finished: false };
  let id = -1;
  let startAt = 0;
  let seq = 0;
  let lastSnap = 0;
  let follower: PathFollower | null = null;
  let welcomed = false;
  let done = false;
  let opened = false;
  let sentFinished = 0;

  const send = (msg: Parameters<typeof serializeControl>[0]) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(serializeControl(msg));
  };

  function finish() {
    if (done) return;
    done = true;
    o.onDone();
  }

  ws.onopen = () => {
    opened = true;
    send({
      t: 'hello',
      v: PROTOCOL_VERSION,
      name: o.name,
      clientId: `bot-${o.name}-${Math.random().toString(36).slice(2, 10)}`,
      room: o.room,
    });
  };
  ws.onerror = () => {
    if (!opened) {
      c.failed++;
      finish();
    }
  };
  ws.onclose = () => {
    if (opened && !done) c.disconnects++;
    finish();
  };

  const visit = noop;
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') {
      const bytes = new Uint8Array(ev.data as ArrayBuffer);
      if (decodeSnapshot(bytes, visit) === null) return;
      const now = performance.now();
      if (lastSnap) o.gaps.add(now - lastSnap);
      lastSnap = now;
      c.snapshots++;
      c.snapshotBytes += bytes.length;
      return;
    }
    const msg = parseServerControl(ev.data);
    if (!msg) return;
    c.controlIn++;
    switch (msg.t) {
      case 'welcome':
        id = msg.playerId;
        welcomed = true;
        c.connected++;
        c.joinMs.add(performance.now() - t0);
        o.onWelcome(msg.room.code, id);
        break;
      case 'matchConfig': {
        const me = msg.players.find((p) => p.id === id);
        if (!me) break;
        follower = createPathFollower(courseFor(msg.courseId), me.slot, {
          speed: o.speed,
          lateral: 0.4,
          phase: me.slot,
        });
        send({ t: 'loaded' });
        break;
      }
      case 'countdown':
        startAt = msg.startAt;
        o.onCountdown(msg.startAt);
        break;
      case 'correct':
        c.corrections++;
        break;
      case 'finished':
        if (msg.id === id) {
          c.finished++;
          c.finishMs.add(msg.timeMs);
        }
        break;
      case 'raceEnd':
        finish();
        break;
      case 'error':
        // a `loaded` that lands after the 90 % quorum already started the countdown is answered with
        // bad_phase; that is expected for the slowest loaders, not a failure
        if (msg.code === 'bad_phase' && startAt) break;
        c.errors++;
        if (process.env.LOADTEST_DEBUG) console.error('server error', msg.code, msg.msg);
        break;
      default:
        break;
    }
  };

  return {
    get id() {
      return id;
    },
    get welcomed() {
      return welcomed;
    },
    get done() {
      return done;
    },
    start() {
      send({ t: 'start' });
    },
    tick(now) {
      if (!follower || !startAt || done || ws.readyState !== WebSocket.OPEN) return;
      const t = (now - startAt) / 1000;
      if (t < 0) return;
      follower.at(t, state);
      wire.yaw = state.yaw;
      wire.finished = state.finished;
      wire.anim = state.finished ? Anim.CELEBRATE : Anim.RUN;
      if (state.finished && ++sentFinished > 3) return;
      encodeState(wire, seq++, Math.round(now - startAt), frame);
      ws.send(frame);
      c.stateSent++;
      c.stateBytes += frame.length;
    },
    close() {
      done = true;
      ws.close();
    },
  };
}

/** Honest speed: comfortably below what the server accepts. */
export const BOT_SPEED = PLAYER.runSpeed * 0.8;
export const TICK_MS = 1000 / NET_SEND_HZ;
