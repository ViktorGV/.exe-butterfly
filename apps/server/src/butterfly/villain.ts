// The villain boss (#84), server side. Once a player enters the final section the villain appears and
// throws obstacles at MARKED players only (the ones who pushed twice, see ./index.ts).
// Everyone else is never a target and never gets a `hit`, so a player who did not push is safe.
//
// Each round the villain throws a VOLLEY at every marked player: one ball where they stand, one aimed a little
// ahead of where they are running, and the rest scattered around them, landing a beat apart. Every throw is
// announced to the room (`throw`: a red circle, landing THROW_WARN_MS later). When a ball lands, the target is
// hit only if it is still inside that circle (`hit`, to it alone), so a quick player can dodge. A player who was
// just knocked down is not hit again until they are back on their feet. Positions stay owned by each client;
// this only relays the effect.
import { BUTTERFLY } from '@wobble/shared/constants';
import { throwIntervalMs } from '@wobble/shared/butterfly/index';
import type { ServerMessage, Vec3 } from '@wobble/shared/types';

/** Rounds come this much faster than throwIntervalMs(storm): 3 s calm down to 1 s at a full storm. */
export const ROUND_SPEEDUP = 0.5;
/** Balls per marked player per round: VOLLEY_MIN, plus one for every VOLLEY_STORM_STEP storm levels. */
export const VOLLEY_MIN = 2;
export const VOLLEY_MAX = 4;
export const VOLLEY_STORM_STEP = 7;
/** Later balls of a volley land this much after the previous one, ms. */
export const STAGGER_MS = 300;
/** Scattered balls land this far from the target (xz, metres), so there is always room to dodge. */
export const SCATTER_MIN_M = 2.6;
export const SCATTER_MAX_M = 5;
/** The led ball lands where the target would be after this share of THROW_WARN_MS at their current speed. */
const LEAD = 0.9;
/** Below this speed (m/s) a player counts as standing still and nothing is led. */
const MIN_LEAD_SPEED = 1;

export interface VillainOptions {
  /** Ids of the players in the match. */
  playerIds(): readonly number[];
  /** Latest known position of a player; false when unknown. */
  getPosition(id: number, out: Vec3): boolean;
  /** Is this player marked (see createButterfly)? */
  isMarked(id: number): boolean;
  /** Current storm level, 0..STORM_MAX: the higher, the faster the throws and the bigger the volleys. */
  storm(): number;
  /** A player that is connected and still racing (not finished). Only these are thrown at. */
  isTargetable(id: number): boolean;
  /** To one player. */
  send(id: number, msg: ServerMessage): void;
  /** To the whole room. */
  publish(msg: ServerMessage): void;
  /** Uniform [0, 1); injectable for tests. */
  random?: () => number;
}

interface Pending {
  n: number;
  target: number;
  x: number;
  z: number;
  landAt: number;
}

/** Balls per marked player per round at a storm level. */
export function volleySize(storm: number): number {
  return Math.min(VOLLEY_MAX, VOLLEY_MIN + Math.floor(Math.max(0, storm) / VOLLEY_STORM_STEP));
}

export function createVillain(opts: VillainOptions) {
  const random = opts.random ?? Math.random;
  let active = false;
  let nextRoundAt = 0;
  let counter = 0;
  const pending: Pending[] = [];
  const p: Vec3 = [0, 0, 0];
  /** Smoothed horizontal velocity (m/s) of marked players, from successive ticks. */
  const vel = new Map<number, { x: number; z: number; vx: number; vz: number; t: number }>();
  /** When each target was last hit: a hit knocks them down, so they cannot be hit again until they are up. */
  const lastHitAt = new Map<number, number>();
  const LOCKOUT_MS = BUTTERFLY.KNOCKED_MS + BUTTERFLY.GETUP_MS;

  function track(id: number, now: number) {
    if (!opts.getPosition(id, p)) return;
    const v = vel.get(id);
    if (!v) {
      vel.set(id, { x: p[0], z: p[2], vx: 0, vz: 0, t: now });
      return;
    }
    const dt = (now - v.t) / 1000;
    if (dt > 0.02) {
      v.vx += ((p[0] - v.x) / dt - v.vx) * 0.35;
      v.vz += ((p[2] - v.z) / dt - v.vz) * 0.35;
      v.x = p[0];
      v.z = p[2];
      v.t = now;
    }
  }

  function throwBall(target: number, x: number, z: number, landAt: number) {
    const item: Pending = { n: counter++, target, x, z, landAt };
    pending.push(item);
    opts.publish({ t: 'throw', n: item.n, target, pos: [x, z], landAt });
  }

  /** One volley at `target`: where they stand, ahead of them, then scattered around them. */
  function volley(target: number, now: number) {
    if (!opts.getPosition(target, p)) return;
    const x = p[0];
    const z = p[2];
    const size = volleySize(opts.storm());
    const landAt = now + BUTTERFLY.THROW_WARN_MS;
    throwBall(target, x, z, landAt);
    const v = vel.get(target);
    const speed = v ? Math.hypot(v.vx, v.vz) : 0;
    let k = 1;
    if (v && speed >= MIN_LEAD_SPEED && k < size) {
      // ahead of a runner: where they will be by the time it lands
      const ahead = (BUTTERFLY.THROW_WARN_MS / 1000) * LEAD;
      throwBall(target, x + v.vx * ahead, z + v.vz * ahead, landAt + k * STAGGER_MS);
      k++;
    }
    for (; k < size; k++) {
      const angle = random() * Math.PI * 2;
      const r = SCATTER_MIN_M + random() * (SCATTER_MAX_M - SCATTER_MIN_M);
      throwBall(target, x + Math.cos(angle) * r, z + Math.sin(angle) * r, landAt + k * STAGGER_MS);
    }
  }

  function land(item: Pending, now: number) {
    // Still a legitimate target when it lands: finishing or leaving in the meantime saves the player.
    if (!opts.isTargetable(item.target) || !opts.isMarked(item.target)) return;
    const last = lastHitAt.get(item.target);
    if (last !== undefined && now - last < LOCKOUT_MS) return; // still down or getting up
    if (!opts.getPosition(item.target, p)) return;
    const dx = p[0] - item.x;
    const dz = p[2] - item.z;
    const dist = Math.hypot(dx, dz);
    if (dist > BUTTERFLY.THROW_RADIUS_M) return; // walked out of the circle
    // Knock back away from the impact; dead centre falls back to straight ahead (-Z).
    const dir: [number, number] = dist > 1e-6 ? [dx / dist, dz / dist] : [0, -1];
    lastHitAt.set(item.target, now);
    opts.send(item.target, { t: 'hit', n: item.n, dir });
  }

  return {
    /** The villain appears: a player entered the final section. Idempotent. */
    activate(now: number) {
      if (active) return;
      active = true;
      nextRoundAt = now + BUTTERFLY.THROW_WARN_MS; // a short beat after the villain shows up
    },
    /** Call every server tick during the race. */
    tick(now: number) {
      if (active) {
        for (const id of opts.playerIds()) if (opts.isMarked(id) && opts.isTargetable(id)) track(id, now);
      }
      for (let i = pending.length - 1; i >= 0; i--) {
        const item = pending[i]!;
        if (now >= item.landAt) {
          land(item, now);
          pending.splice(i, 1);
        }
      }
      if (!active || now < nextRoundAt) return;
      for (const id of opts.playerIds()) {
        if (opts.isMarked(id) && opts.isTargetable(id)) volley(id, now);
      }
      nextRoundAt = now + throwIntervalMs(opts.storm()) * ROUND_SPEEDUP;
    },
    get active() {
      return active;
    },
    get pendingCount() {
      return pending.length;
    },
  };
}

export type Villain = ReturnType<typeof createVillain>;
