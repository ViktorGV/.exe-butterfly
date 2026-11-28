// Race session (#19): validation, checkpoints, finish order and interest-managed snapshots.
// The room code (#18) creates sessions only through createRaceSession(). Socket-free: driven by
// handleState() with decoded states and tick() with the server clock; frames go out through send().
import { WIRE } from '@wobble/shared/constants';
import type { IncomingState, RaceResult, RaceSession, RaceSessionOptions, Vec3 } from '@wobble/shared/types';
import { distToVolume, gridPoint, inGrid, sweepVolume } from './geometry.ts';
import {
  BOUNDS_MARGIN_M,
  CORRECT_RESEND_MS,
  deriveLimits,
  GRID_MARGIN_M,
  GRID_UP_M,
  KICK_STRIKES,
  MAX_STATES_PER_SEC,
  SAVE_RADIUS_M,
  SAVE_TTL_MS,
  SPEED_SLACK_M,
  SPEED_WINDOW_MS,
  STALE_DISCONNECT_MS,
  TIME_AHEAD_MS,
  TIME_BEHIND_MS,
} from './limits.ts';
import { createSnapshotBuilder } from './snapshot.ts';

export { deriveLimits } from './limits.ts';

/** Speed-window samples kept per player (≥ MAX_STATES_PER_SEC). */
const WIN = 32;

/** Extra hooks for the butterfly effect (#84) on top of the RaceSession contract. */
export interface RaceSessionExt extends RaceSession {
  /** Latest accepted feet position of a player; false when unknown. */
  getPosition(playerId: number, out: Vec3): boolean;
  /** Latest accepted facing (yaw, radians; 0 faces −Z) of a player; NaN when unknown. */
  getYaw(playerId: number): number;
  /** Lets the next state of `playerId` jump to within SAVE_RADIUS_M of `pos` (an approved save). */
  approveSave(playerId: number, pos: Vec3, nowMs: number): void;
}

/**
 * Events (onEvent): checkpoint{id,index} · finished{id,place,timeMs} · respawn{id,checkpoint,pos,save}
 * · correct{id,reason} · kick{id,reason,strikes} · raceEnd{results}.
 * Frames sent here: SNAPSHOT (binary), checkpoint / correct to the player, finished to everyone.
 * raceEnd is only an event; the room broadcasts it and changes phase.
 */
export function createRaceSession({ course, players, config, send, onEvent }: RaceSessionOptions): RaceSessionExt {
  const n = players.length;
  const limits = deriveLimits(course);
  const lastCp = course.checkpoints.length - 1;
  const index = new Map<number, number>();
  const ids = new Uint16Array(n);
  const slots = new Int32Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const yaw = new Float64Array(n);
  const animFlags = new Uint8Array(n);
  const visible = new Uint8Array(n);
  const receives = new Uint8Array(n);
  const connected = new Uint8Array(n).fill(1);
  const disconnectedAt = new Float64Array(n);
  const checkpoint = new Int32Array(n).fill(-1);
  const finishMs = new Float64Array(n).fill(-1);
  const place = new Int32Array(n);
  const kicked = new Uint8Array(n);
  const strikes = new Int32Array(n);
  const hasSeq = new Uint8Array(n);
  const lastSeq = new Uint16Array(n);
  const rateStart = new Float64Array(n);
  const rateCount = new Int32Array(n);
  const wasRacing = new Uint8Array(n);
  const fixPending = new Uint8Array(n);
  const lastCorrectAt = new Float64Array(n);
  const lastT = new Float64Array(n);
  // speed window ring buffers
  const wx = new Float64Array(n * WIN);
  const wy = new Float64Array(n * WIN);
  const wz = new Float64Array(n * WIN);
  const wt = new Float64Array(n * WIN);
  const wHead = new Int32Array(n);
  const wLen = new Int32Array(n);
  // approved saves (#84)
  const saveX = new Float64Array(n);
  const saveY = new Float64Array(n);
  const saveZ = new Float64Array(n);
  const saveUntil = new Float64Array(n).fill(-Infinity);

  const p: Vec3 = [0, 0, 0];
  players.forEach((pl, i) => {
    index.set(pl.id, i);
    ids[i] = pl.id;
    slots[i] = pl.slot;
    gridPoint(course.spawn, pl.slot, p);
    x[i] = p[0];
    y[i] = p[1];
    z[i] = p[2];
    yaw[i] = course.spawn.yaw;
    pushSample(i, p[0], p[1], p[2], 0, true);
  });

  const snap = createSnapshotBuilder(Math.max(1, n));
  const sendSnap = (i: number, data: Uint8Array) => send(ids[i], data);
  let startAt = Infinity;
  let now = 0;
  let finishedCount = 0;
  let over = false;

  function pushSample(i: number, px: number, py: number, pz: number, t: number, reset = false) {
    if (reset) wLen[i] = 0;
    const h = (wHead[i] + 1) % WIN;
    wHead[i] = h;
    const k = i * WIN + h;
    wx[k] = px;
    wy[k] = py;
    wz[k] = pz;
    wt[k] = t;
    if (wLen[i] < WIN) wLen[i]++;
    lastT[i] = t;
  }

  /** True when moving to (px,py,pz) at race time t is within the speed limits over the window. */
  function speedOk(i: number, px: number, py: number, pz: number, t: number): boolean {
    if (t < lastT[i]) return false;
    const base = i * WIN;
    let k = base + wHead[i];
    // oldest sample still inside the window; the newest one if all are older
    for (let c = 1; c < wLen[i]; c++) {
      const kk = base + ((wHead[i] - c + WIN) % WIN);
      if (wt[kk] < t - SPEED_WINDOW_MS) break;
      k = kk;
    }
    const span = Math.max(t - wt[k], 1000 / 15) / 1000;
    const dh = Math.hypot(px - wx[k], pz - wz[k]);
    const dv = Math.abs(py - wy[k]);
    return dh <= limits.maxSpeedH * span + SPEED_SLACK_M && dv <= limits.maxSpeedV * span + SPEED_SLACK_M;
  }

  function strike(i: number, reason: string) {
    if (kicked[i]) return;
    if (++strikes[i] >= KICK_STRIKES) {
      kicked[i] = 1;
      onEvent({ type: 'kick', id: ids[i], reason, strikes: strikes[i] });
    }
  }

  function sendCorrect(i: number) {
    lastCorrectAt[i] = now;
    send(ids[i], JSON.stringify({ t: 'correct', pos: [x[i], y[i], z[i]], checkpoint: checkpoint[i] }));
  }

  function violate(i: number, reason: string) {
    if (fixPending[i]) {
      if (now - lastCorrectAt[i] >= CORRECT_RESEND_MS) sendCorrect(i);
      return;
    }
    fixPending[i] = 1;
    onEvent({ type: 'correct', id: ids[i], reason });
    sendCorrect(i);
    pushSample(i, x[i], y[i], z[i], lastT[i], true);
    strike(i, reason);
  }

  function inBounds(px: number, py: number, pz: number) {
    const b = course.bounds;
    const m = BOUNDS_MARGIN_M;
    return (
      px >= b.min[0] - m &&
      px <= b.max[0] + m &&
      py >= b.min[1] - m &&
      py <= b.max[1] + m &&
      pz >= b.min[2] - m &&
      pz <= b.max[2] + m
    );
  }

  function finishPlayer(i: number, t: number) {
    finishMs[i] = Math.round(t);
    place[i] = ++finishedCount;
    const msg = JSON.stringify({ t: 'finished', id: ids[i], place: place[i], timeMs: finishMs[i] });
    for (let j = 0; j < n; j++) if (connected[j]) send(ids[j], msg);
    onEvent({ type: 'finished', id: ids[i], place: place[i], timeMs: finishMs[i] });
  }

  /** Swept progress from the stored position to (px,py,pz). Returns false on an early finish. */
  function progress(i: number, px: number, py: number, pz: number, t0: number, t1: number): boolean {
    while (checkpoint[i] < lastCp) {
      const next = checkpoint[i] + 1;
      if (sweepVolume(course.checkpoints[next].volume, x[i], y[i], z[i], px, py, pz) < 0) break;
      checkpoint[i] = next;
      send(ids[i], JSON.stringify({ t: 'checkpoint', index: next }));
      onEvent({ type: 'checkpoint', id: ids[i], index: next });
    }
    if (checkpoint[i] !== lastCp) return true;
    const f = sweepVolume(course.finish, x[i], y[i], z[i], px, py, pz);
    if (f < 0) return true;
    const ft = t0 + f * (t1 - t0);
    if (ft < limits.minFinishMs) return false;
    finishPlayer(i, ft);
    return true;
  }

  function accept(i: number, s: IncomingState, t: number, reset: boolean) {
    x[i] = s.pos[0];
    y[i] = s.pos[1];
    z[i] = s.pos[2];
    yaw[i] = s.yaw;
    animFlags[i] =
      (s.anim & WIRE.ANIM_MASK) |
      (s.grounded ? WIRE.FLAG_GROUNDED : 0) |
      (finishMs[i] >= 0 ? WIRE.FLAG_FINISHED : 0) |
      (s.respawned ? WIRE.FLAG_RESPAWNED : 0);
    fixPending[i] = 0;
    pushSample(i, x[i], y[i], z[i], t, reset);
  }

  function handleState(playerId: number, s: IncomingState) {
    const i = index.get(playerId);
    if (i === undefined || over || kicked[i] || finishMs[i] >= 0 || !s || !s.pos) return;
    if (config.qualifyCount > 0 && finishedCount >= config.qualifyCount) return;
    // rate limit over a 1 s window of server time
    if (now - rateStart[i] >= 1000) {
      rateStart[i] = now;
      rateCount[i] = 0;
    }
    if (++rateCount[i] > MAX_STATES_PER_SEC) return strike(i, 'flood');
    const d = (s.seq - lastSeq[i]) & 0xffff;
    if (hasSeq[i] && (d === 0 || d >= 0x8000)) return strike(i, 'seq');
    hasSeq[i] = 1;
    lastSeq[i] = s.seq & 0xffff;

    const px = s.pos[0];
    const py = s.pos[1];
    const pz = s.pos[2];
    if (!Number.isFinite(px + py + pz + s.yaw + s.raceTimeMs)) return violate(i, 'nan');
    if (!inBounds(px, py, pz)) return violate(i, 'bounds');

    const racing = now >= startAt;
    if (!racing) {
      if (!inGrid(course.spawn, px, py, pz, GRID_MARGIN_M, GRID_UP_M)) return violate(i, 'spawn');
      return accept(i, s, 0, true);
    }
    const serverRace = now - startAt;
    const t = s.raceTimeMs;
    if (t > serverRace + TIME_AHEAD_MS || t < serverRace - TIME_BEHIND_MS) return violate(i, 'clock');
    if (!wasRacing[i]) {
      wasRacing[i] = 1;
      pushSample(i, x[i], y[i], z[i], 0, true);
    }

    if (s.respawned) {
      const grid = checkpoint[i] >= 0 ? course.checkpoints[checkpoint[i]].respawn : course.spawn;
      if (!inGrid(grid, px, py, pz, GRID_MARGIN_M, GRID_UP_M)) return violate(i, 'respawn');
      accept(i, s, t, true);
      onEvent({ type: 'respawn', id: playerId, checkpoint: checkpoint[i], pos: [px, py, pz], save: false });
      return;
    }
    if (now <= saveUntil[i] && Math.hypot(px - saveX[i], py - saveY[i], pz - saveZ[i]) <= SAVE_RADIUS_M) {
      saveUntil[i] = -Infinity;
      accept(i, s, t, true);
      onEvent({ type: 'respawn', id: playerId, checkpoint: checkpoint[i], pos: [px, py, pz], save: true });
      return;
    }
    if (!speedOk(i, px, py, pz, t)) return violate(i, 'speed');
    const t0 = lastT[i];
    if (!progress(i, px, py, pz, t0, t)) return violate(i, 'earlyFinish');
    if (s.finished && finishMs[i] < 0) {
      accept(i, s, t, false);
      return violate(i, 'finishClaim');
    }
    accept(i, s, t, false);
  }

  function results(): RaceResult[] {
    const order = [...players.keys()];
    const next = (i: number) => (checkpoint[i] < lastCp ? course.checkpoints[checkpoint[i] + 1].volume : course.finish);
    order.sort((a, b) => {
      const fa = finishMs[a] >= 0;
      const fb = finishMs[b] >= 0;
      if (fa !== fb) return fa ? -1 : 1;
      if (fa) return finishMs[a] - finishMs[b] || place[a] - place[b];
      if (checkpoint[a] !== checkpoint[b]) return checkpoint[b] - checkpoint[a];
      return distToVolume(next(a), x[a], z[a]) - distToVolume(next(b), x[b], z[b]) || slots[a] - slots[b];
    });
    return order.map((i, k) => ({
      id: ids[i],
      place: k + 1,
      timeMs: finishMs[i] >= 0 ? finishMs[i] : null,
      checkpoint: checkpoint[i],
    }));
  }

  function tick(nowMs: number) {
    if (over) return;
    now = nowMs;
    for (let i = 0; i < n; i++) {
      receives[i] = connected[i] && !kicked[i] ? 1 : 0;
      visible[i] = !kicked[i] && (connected[i] || nowMs - disconnectedAt[i] < STALE_DISCONNECT_MS) ? 1 : 0;
    }
    snap.build({ count: n, ids, x, y, z, yaw, animFlags, visible, receives }, nowMs, sendSnap);
    if (nowMs < startAt) return;
    let allDone = true;
    for (let i = 0; i < n; i++) if (connected[i] && !kicked[i] && finishMs[i] < 0) allDone = false;
    const qualified = config.qualifyCount > 0 && finishedCount >= config.qualifyCount;
    if (qualified || allDone || nowMs - startAt >= config.timeLimitMs) {
      over = true;
      onEvent({ type: 'raceEnd', results: results() });
    }
  }

  return {
    start(startAtMs) {
      startAt = startAtMs;
    },
    handleState,
    setConnected(playerId, isConnected) {
      const i = index.get(playerId);
      if (i === undefined) return;
      if (connected[i] && !isConnected) disconnectedAt[i] = now;
      connected[i] = isConnected ? 1 : 0;
    },
    tick,
    get finished() {
      return over;
    },
    results,
    getPosition(playerId, out) {
      const i = index.get(playerId);
      if (i === undefined) return false;
      out[0] = x[i];
      out[1] = y[i];
      out[2] = z[i];
      return true;
    },
    getYaw(playerId) {
      const i = index.get(playerId);
      return i === undefined ? NaN : yaw[i]!;
    },
    approveSave(playerId, pos, nowMs) {
      const i = index.get(playerId);
      if (i === undefined) return;
      saveX[i] = pos[0];
      saveY[i] = pos[1];
      saveZ[i] = pos[2];
      saveUntil[i] = nowMs + SAVE_TTL_MS;
    },
  };
}
