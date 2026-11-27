// Deterministic test/bench harness: scripted bots driving a race session at SNAPSHOT_HZ.
import { Anim, POS_SCALE, SNAPSHOT_HZ, WIRE } from '@wobble/shared/constants';
import { fixtureCourse } from '@wobble/shared/fixtures/index';
import type { CourseDef, IncomingState, RaceEvent, Vec3 } from '@wobble/shared/types';
import { gridPoint } from './geometry.ts';
import { createRaceSession } from './index.ts';

export const STEP_MS = 1000 / SNAPSHOT_HZ;

export interface Bot {
  id: number;
  slot: number;
  /** m/s toward -Z */
  speed: number;
  /** seconds between hops (0 = never jump) */
  hopEvery: number;
  start: Vec3;
}

export interface HarnessOptions {
  count: number;
  course?: CourseDef;
  seed?: number;
  qualifyCount?: number;
  timeLimitMs?: number;
  onSnapshot?(to: number, data: Uint8Array): void;
}

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createHarness(opts: HarnessOptions) {
  const course = opts.course ?? fixtureCourse;
  const rand = rng(opts.seed ?? 1);
  const bots: Bot[] = [];
  for (let s = 0; s < opts.count; s++) {
    const start: Vec3 = [0, 0, 0];
    gridPoint(course.spawn, s, start);
    bots.push({ id: 1000 + s, slot: s, speed: 6 + rand() * 1.5, hopEvery: rand() < 0.5 ? 0 : 0.6 + rand(), start });
  }
  const events: RaceEvent[] = [];
  const text: { to: number; msg: Record<string, unknown> }[] = [];
  let snapshotBytes = 0;
  const session = createRaceSession({
    course,
    players: bots.map((b) => ({ id: b.id, slot: b.slot })),
    config: { qualifyCount: opts.qualifyCount ?? opts.count, timeLimitMs: opts.timeLimitMs ?? 120_000 },
    send(to, data) {
      if (typeof data === 'string') text.push({ to, msg: JSON.parse(data) as Record<string, unknown> });
      else {
        snapshotBytes += data.byteLength;
        opts.onSnapshot?.(to, data);
      }
    },
    onEvent: (e) => events.push(e),
  });
  const seq = new Map<number, number>();
  const startAt = 3000;
  let now = 0;

  /** The honest bot's state at race time t (seconds); y follows a hop parabola. */
  function stateOf(b: Bot, t: number): IncomingState {
    const z = b.start[2] - b.speed * Math.max(0, t);
    let y = 0.5;
    if (b.hopEvery > 0 && t > 0) {
      const ph = t % b.hopEvery;
      const air = 0.6;
      if (ph < air) y += 9.5 * ph - 13 * ph * ph; // jumpVelocity, gravity / 2
      y = Math.max(0.5, y);
    }
    const n = (seq.get(b.id) ?? 0) + 1;
    seq.set(b.id, n);
    return {
      seq: n & 0xffff,
      raceTimeMs: Math.max(0, Math.round(t * 1000)),
      pos: [b.start[0], y, z],
      vel: [0, 0, -b.speed],
      yaw: 0,
      anim: Anim.RUN,
      grounded: y <= 0.5,
      checkpoint: -1,
      finished: false,
    };
  }

  session.start(startAt);
  return {
    session,
    bots,
    events,
    text,
    startAt,
    get now() {
      return now;
    },
    get snapshotBytes() {
      return snapshotBytes;
    },
    /** One server step: every honest bot (except `skip`) sends a state, then the session ticks. */
    step(skip?: Set<number>) {
      now += STEP_MS;
      const t = (now - startAt) / 1000;
      for (const b of bots) if (!skip?.has(b.id)) session.handleState(b.id, stateOf(b, t));
      session.tick(now);
    },
    nextSeq(id: number) {
      const n = (seq.get(id) ?? 0) + 1;
      seq.set(id, n);
      return n;
    },
  };
}

/** Decodes a SNAPSHOT frame into player ids (and positions when `pos` is given). */
export function decodeSnapshotIds(data: Uint8Array, pos?: Map<number, Vec3>): number[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (dv.getUint8(0) !== WIRE.MSG_SNAPSHOT) throw new Error('not a snapshot');
  const count = dv.getUint16(5, true);
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const o = WIRE.SNAPSHOT_HEADER_BYTES + k * WIRE.SNAPSHOT_RECORD_BYTES;
    const id = dv.getUint16(o, true);
    out.push(id);
    pos?.set(id, [
      dv.getInt16(o + 2, true) / POS_SCALE,
      dv.getInt16(o + 4, true) / POS_SCALE,
      dv.getInt16(o + 6, true) / POS_SCALE,
    ]);
  }
  return out;
}
